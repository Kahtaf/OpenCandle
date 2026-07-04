## Why

The GUI currently treats "active session" as both the browser focus and the backend write target. That coupling explains the routing failures we have seen:

- switching conversations can flicker between the old and new session because late snapshots from the previous active session still update the chat surface;
- creating a new conversation can show an old transcript because session creation and route activation race each other;
- opening an old conversation can fall back to the home page because session resolution depends on mutable active-session state instead of the route identity;
- sending can fail with "active session changed before your message was sent" because the send path validates against a global active session rather than the session the user submitted from.

The bigger product issue is that one global active writer target also prevents a user from continuing session B while session A is waiting on a long response. Pi and the TUI already model sessions as durable, addressable transcripts with per-session writer safety. The GUI should keep that parity: focus can move between sessions, but writes must target an explicit session.

## What Changes

- Replace backend-global active-session write targeting with explicit session-addressed operations.
- Treat browser "active session" as UI focus only: selected row, route, context panel, and default composer target.
- Allow one active run per session while permitting concurrent runs across different sessions owned by the same GUI writer process.
- Move writer/follower ownership to a canonical per-session lock shared by GUI and TUI so neither surface competes with another writer for the same session.
- Replace the global chat mutation path with a session-addressed run endpoint or equivalent WebSocket action.
- Route chat prompts, `ask_user` answers/cancels, direct tool invocations, stop/cancel, retry, and setup-driven transcript mutations to explicit target sessions.
- Correlate session snapshots, route transitions, send acknowledgements, and run events by `sessionId`, `requestId`, and `runId` so stale events cannot update the wrong route.
- Make direct session routes and historical session loads independent of WebSocket ordering.
- Make transcript scrolling session-aware and reader-intent-aware: anchored user turns, live-edge-only auto-follow, jump-to-latest controls, saved-thread restore, and position preservation during streaming/tool-card layout changes.
- Keep auxiliary chat panels, including the research/tool timeline drawer, derived from the current route session so navigating to another chat cannot leave a panel showing tool calls from the previous thread.
- Preserve canonical Pi/OpenCandle session storage, branch context, custom entries, and chat event rendering semantics.

## Capabilities

### Modified Capabilities

- **`pi-synced-gui`**: Defines the session-addressed GUI runtime, per-session writer ownership, route identity, and TUI/Pi parity expectations.
- **`chat-event-rendering`**: Tightens the event stream contract so every live and replayed event is scoped to the target session and run.
- **`stateful-market-surfaces`**: Replaces process-global active-session wording for GUI-originated market-state mutations with explicit target-session transcript visibility.

## Impact

- **GUI server:** Introduces a session-runtime registry or equivalent actor map keyed by Pi session id/path instead of a singleton active runtime.
- **GUI web app:** Makes route params, composer sends, direct tool invocations, `ask_user` responses, run controls, and live run state target explicit session ids; stale responses are ignored rather than rendered.
- **Transcript UX:** Adds a session-scoped scroll behavior contract for long streaming finance workflows without replacing OpenCandle's finance-specific message and tool cards.
- **Auxiliary panels:** Keeps the tool/research timeline drawer and any current-thread summaries synchronized with the visible route session, closing stale-panel leakage when switching chats.
- **Session concurrency:** Allows independent sessions to run concurrently in the same GUI process, while rejecting overlapping runs in the same session.
- **TUI/Pi parity:** Reuses Pi session storage and branch/read APIs while adding shared per-session writer-lock participation for TUI and GUI. TUI behavior remains singleton-focused because the terminal has one visible session, but durable session semantics and write safety stay shared.
- **No storage migration:** This change does not require a SQLite schema migration or Pi session format change.
- **No hosted multi-user scope:** The GUI remains local and single-user; concurrent sessions are local process concurrency, not cloud sync.

## Non-Goals

- Do not allow simultaneous writers to append to the same Pi session.
- Do not fork or modify Pi session storage format.
- Do not add cross-machine session sync.
- Do not redesign the transcript visual language, financial cards, or market-state pages; this change may add transcript behavior and session-scoped panel synchronization needed for correctness.
- Do not keep compatibility shims for the current active-session mutation path once the replacement endpoint and WebSocket actions are in place.
- Do not add queued same-session prompts; same-session overlap is rejected until a separate queueing change defines that behavior.
