## Context

OpenCandle is a local single-user app with multiple surfaces over the same Pi/OpenCandle session state: TUI, GUI server processes, and one or more browser tabs. The current implementation uses writer/follower roles to avoid concurrent writes to the same session, but those roles leak into the user experience as disabled controls and read-only messaging.

The safety constraint remains valid: only one authoritative local writer should append to a given Pi session at a time. The product problem is that users should not need to know which local process holds that authority. Any local surface should accept a supported session action, then the runtime should execute it directly, proxy it to the active coordinator, reconnect, or report a neutral unavailable state without exposing ownership terminology.

Claude review showed that heartbeat-only stale recovery plus fencing claims were not implementable against the current file-based lock and Pi-owned streaming writes. This revision therefore uses conservative recovery: do not steal from a live owner PID merely because heartbeat is delayed, and do not claim to fence Pi internal stream writes unless an implementation spike finds a real write chokepoint.

## Goals / Non-Goals

**Goals:**

- Preserve single-writer session safety internally.
- Make GUI processes, browser tabs, and TUI chat surfaces feel writable by default for supported session actions.
- Remove user-visible writer/follower/read-only/takeover terminology from normal UX.
- Route session write intents through a local session coordinator when the current process does not own the target session.
- Recover stale owners only when ownership is safely recoverable, such as when the owner process is no longer alive or the lock is otherwise definitively abandoned.
- Use session-scoped, idempotent action IDs so retry/proxy/reconnect does not duplicate prompts, tool invocations, run controls, or `ask_user` answers.
- Authenticate forwarded local write intents against browser-origin forgery and accidental cross-process misuse.
- Verify cross-surface behavior with GUI, TUI, Browser, and multiple automated clients.

**Non-Goals:**

- Hosted multi-user collaboration or cross-machine synchronization.
- Same-user malware defense. A same-user process that can read local OpenCandle state and inject local traffic is outside this local-app threat model.
- Simultaneous independent writers appending to the same Pi session.
- Queued same-session chat prompts beyond the existing single-active-run behavior.
- Global model/provider setup coordination. Setup UX language may be cleaned up, but proxying global setup actions is deferred.
- Market-state mutation coordination. Saved-state proxying and SQLite/transcript reconciliation are deferred to a follow-up OpenSpec change.
- SQLite schema changes unless implementation discovers they are required for action-id metadata.
- Redesigning the GUI layout beyond replacing internal-role language with neutral connection states.

## Decisions

### Decision: Keep the Lock, Hide It Behind a Coordinator

The existing writer lock should remain the low-level safety primitive, but UI and client APIs should interact with a `LocalSessionCoordinator` abstraction. A process that owns the target session executes session actions directly. A process that does not own the target session attempts to forward the action to the owner endpoint recorded in lock metadata. If forwarding fails and the owner process is still alive, the surface reports syncing/reconnecting instead of stealing the lock. If the owner process is definitively gone, the process may recover the lock and retry the action.

Alternative considered: remove the lock entirely because OpenCandle is local and single-user. Rejected because local process races still occur during restarts, multiple tabs, GUI/TUI overlap, and long-running streams.

### Decision: Use Per-Session Ownership and Conservative Recovery

Coordinator ownership is per canonical Pi session identity, not per process. A GUI process may own session A, proxy session B, and read session C at the same time.

Lock metadata should include:

- canonical session identity or startup fallback scope;
- owner process id plus a process identity discriminator such as process start time, boot id, or another available token that distinguishes a reused PID from the original owner;
- heartbeat timestamp;
- local coordinator endpoint;
- coordinator protocol version.

Recovery must require a definitive abandonment signal. In phase one that means the recorded owner process identity is no longer alive or a future implementation provides an equivalent authoritative owner-dead signal. A stale heartbeat from a still-live matching process is treated as temporarily unreachable, not recoverable, because Pi may still be streaming or appending internally. If process identity cannot be verified because of PID reuse, corrupted metadata, or platform limits, OpenCandle should expose a neutral manual recovery path such as "Restart local session connection" rather than forcing users to understand lock ownership.

For not-yet-persisted sessions, the current session-directory fallback remains a startup-only scope. Once a session has a persisted file/id, the coordinator key must move to that canonical session identity before other surfaces can target it independently. The migration must be serialized so there is not a window where two owners independently hold the fallback key and the canonical key for the same session.

Alternative considered: recover purely on heartbeat expiration with fencing generations. Rejected for this phase because the current Pi runtime does not expose a proven enforcement chokepoint for all internal stream writes.

### Decision: Refresh Heartbeat Throughout Active Runs

The coordinator must refresh heartbeat while it is alive and should continue refreshing during long-running streams, tool calls, and synthesis. Heartbeat freshness is an availability signal for other surfaces, not sole authority to steal from a live PID. If heartbeat refresh stops while the PID remains alive, the UI may show reconnecting/syncing and avoid starting a competing writer.

Alternative considered: heartbeat-only lease recovery. Rejected because a blocked but live owner could be incorrectly stolen.

### Decision: Replace Process-Wide Role State With Per-Session Coordination State

The current GUI server computes a single startup writer/follower role and sends it to clients as boot state. This proposal requires replacing that process-wide role with per-session coordination state. A process can be the direct owner for one session, proxy writes for another, and read a third. GUI server controllers and browser state should therefore ask the coordinator about the target session when handling a session action instead of relying on one global role captured at startup.

Browser-facing state should describe whether the current session is ready, syncing, reconnecting, busy, or unavailable. Internal ownership metadata can still exist in diagnostics, logs, and lock files, but normal controls should be driven by the target session's coordinator state.

Alternative considered: keep one process-wide role and hide it with copy changes. Rejected because it cannot support opening or switching among sessions with different local owners.

### Decision: Add Explicit TUI Coordinator Participation

TUI participation is not just a UI copy change. If a TUI owns a session and a GUI wants to write to that session, the TUI process must expose a local coordinator listener or Pi-native IPC endpoint that can accept authenticated forwarded session actions. If the TUI is a non-owner surface, it must subscribe to, poll, or otherwise tail the same session transcript so writes accepted by the GUI owner become visible in the TUI.

The initial implementation uses authenticated loopback HTTP for GUI-owned and TUI-owned coordinator forwarding: writer lock metadata publishes the owner endpoint and a local coordinator capability, non-owner surfaces forward supported session actions to that endpoint, and the owner rejects calls that do not include the capability. TUI-owned sessions expose a loopback `/api/local-coordinator/chat-run` endpoint. GUI-owned sessions can be joined by an interactive TUI only when the writer lock includes coordinator metadata and stdin is a TTY; that follower proxy forwards prompts through the owner and polls the persisted session file for transcript updates. Non-interactive non-owner TUI runs fail closed with neutral syncing language. The full TUI+GUI verification task remains open until WP7 validates this concrete topology.

Alternative considered: verify only GUI-to-GUI coordination and leave TUI to manual use. Rejected because the user-facing problem includes local TUI/GUI overlap.

### Decision: Authenticate the Local Coordinator Endpoint Within the Local-App Threat Model

Forwarded writes are powerful: they can submit prompts, invoke tools, answer prompts, and control runs. The coordinator endpoint must be loopback-only or socket-local and require a trusted local capability that is not exposed to arbitrary browser pages. WebSocket/HTTP trusted-session checks remain in force for browser-originated requests before a GUI server forwards anything to the coordinator.

This does not defend against same-user malware that can read local OpenCandle files or process memory. The goal is to prevent browser-origin forgery, accidental unauthenticated local calls, and cross-user access on shared machines.

Alternative considered: rely on loopback as sufficient trust. Rejected because malicious browser pages can target local HTTP endpoints even if they cannot read local secrets.

### Decision: Use Session-Scoped Idempotent Actions

Every supported session-mutating request should carry:

- `actionId`: stable only for retries of the same user action;
- `sessionId`: canonical target session identity;
- `actionType`;
- payload;
- source surface.

The same logical action must reuse its action id across retry/proxy/reconnect. A deliberate repeat by the user must mint a fresh action id. The coordinator stores accepted action IDs for at least the maximum retry/recovery horizon so a late retry cannot duplicate a prompt or session action.

Action dedupe must survive any recovery path that can retry a previously accepted but unacknowledged action. The implementation may persist action IDs in transcript metadata, use a small per-session durable store, or prove by tests that a recovered owner cannot replay an already-accepted action. If no cross-owner durable dedupe exists, dead-owner recovery must not automatically retry actions whose acceptance status is unknown.

In scope: chat prompts, direct tool invocations for a session, `ask_user` answers/cancels, and run controls. Out of scope: global setup mutations and market-state mutations.

Alternative considered: include global setup actions in the same envelope. Rejected because global setup is not per-session and needs a separate global coordination model.

### Decision: Use Neutral User-Facing Connection States

The browser and TUI should not show "writer", "follower", "take over", or "read-only follower" during normal operation. They should show short neutral states only when needed:

- "Syncing..."
- "Reconnecting..."
- "OpenCandle is restarting..."
- "Could not connect. Retry"

Controls stay available while the system can route or recover an action. During an in-flight action, the specific submitting control may show a pending/syncing state to prevent accidental double submit. Controls become disabled only when no coordinator can be reached and recovery is not safe or fails.

Setup and market-state surfaces are different because their write coordination is deferred. Their visible language should still avoid internal ownership terms, but they must remain honestly disabled when the current process cannot safely perform the mutation. For example, they may say that changes are unavailable in this window until OpenCandle reconnects, but they must not imply that setup or saved-state writes will be proxied by this change.

Alternative considered: keep read-only language and add a "take over" button. Rejected because it asks users to manage an implementation detail.

### Decision: Return Busy Instead of Queueing Concurrent Runs

The coordinator serializes admission to a session. It does not introduce a prompt queue in this proposal. If one session run is already active and another client submits a second prompt or incompatible run action, the coordinator should return a neutral busy/retry state instead of silently queueing or starting a competing run. The client may preserve the draft or show retry feedback, but a fresh user action is required to resubmit unless existing run-control semantics already allow the action.

Alternative considered: queue prompts from multiple surfaces. Rejected because it expands the session contract beyond the current single-active-run model.

### Decision: Defer Global Setup and Market-State Coordination

Global setup and market-state pages may need language cleanup, but their write-routing semantics are not part of this change. Global setup needs a global coordination contract; market-state mutations need a SQLite/transcript design. Both are follow-ups after session coordination is proven.

## Risks / Trade-offs

- **Risk: Live owner becomes unreachable but still has the PID alive** -> Do not steal ownership; show syncing/reconnecting until the owner recovers or exits.
- **Risk: PID reuse makes a dead owner look alive** -> Record a process identity discriminator when possible and provide a neutral manual recovery path when abandonment cannot be proven automatically.
- **Risk: No Pi stream-write fencing chokepoint exists** -> Limit this change to run admission, proxy admission, and OpenCandle-controlled writes; do not claim to fence already-admitted Pi internal stream writes.
- **Risk: Forged browser-origin local write requests** -> Require trusted browser-session checks before forwarding and require a local coordinator capability unavailable to browser pages.
- **Risk: Duplicate prompts after retry** -> Require action ids with explicit retry-vs-repeat semantics and dedupe retention at least as long as the retry/recovery horizon.
- **Risk: Duplicate prompts across owner recovery** -> Persist action IDs with the transcript or another durable per-session store before enabling automatic retry after recovery.
- **Risk: Temporary socket errors feel like ignored clicks** -> Keep controls interactive where possible, show per-action syncing feedback, and surface a retryable error only after routing/recovery fails.
- **Risk: Scope creep into global setup and market state** -> Defer those semantics to follow-up proposals.

## Migration Plan

1. Introduce per-session coordinator metadata and heartbeat around the existing writer lock without changing UI behavior.
2. Replace process-wide role decisions with per-session coordinator state in server controllers and browser boot/session state.
3. Change stale recovery to avoid recovering from a live matching owner process solely because heartbeat is late.
4. Add session-scoped action IDs and dedupe for chat prompts, direct tool invocation, run controls, and `ask_user` answers, with durable handling for recovery retry.
5. Add an authenticated local coordinator endpoint or socket for session action forwarding.
6. Add owner discovery and forwarding for GUI server surfaces.
7. Add TUI coordinator listener and transcript subscription/tail behavior after GUI proxying is stable.
8. Replace visible writer/follower UI language with neutral connection and retry states, while leaving deferred setup and market-state writes honestly unavailable when they cannot be routed.
9. Add browser and TUI verification coverage, including multiple clients/agents sending messages and observing synchronized transcripts.

Rollback is straightforward while the existing lock remains intact: disable proxy/recovery and fall back to direct-owner writes plus neutral unavailable states.

## Open Questions

- Does Pi expose any enforceable stream-write/run-continuation hook that could support stronger fencing in a future change?

## Resolution of Open Questions

- **Heartbeat, stale grace, and action dedupe retention:** resolved as implemented. Writer lock stale grace is `DEFAULT_STALE_GRACE_MS = 15_000` in `src/pi/session-writer-lock.ts`. GUI and TUI writer-lock heartbeats refresh every 5,000 ms during active ownership and transient acquired locks. Coordinator accepted-action dedupe retention is 10 minutes (`DEFAULT_DEDUPE_RETENTION_MS = 10 * 60 * 1000` in `gui/server/local-session-coordinator.ts`, mirrored by the TUI coordinator). The invariant is that dedupe retention must be greater than or equal to the retry/recovery horizon. Because automatic retry across owner recovery remains disabled in v1, the current 10-minute retention is sufficient for in-owner reconnect/proxy retries and same-owner duplicate suppression.
- **Future fencing hook:** unresolved for a future change. No stronger Pi stream-write fencing is claimed by this change.
