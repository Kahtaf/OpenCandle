## 1. Runtime And API

- [x] Audit current GUI session routing, WebSocket actions, HTTP endpoints, and send path for implicit active-session dependencies.
- [ ] Introduce a session-runtime registry or equivalent actor map keyed by canonical Pi session id/path.
- [x] Define a canonical per-session writer-lock key/path and update GUI and TUI to acquire, refresh, observe, and release that lock for the session they write.
- [ ] Specify and implement per-session lock lifecycle for dynamic GUI runtimes: heartbeat start/stop, idle eviction, rename/delete cleanup, and read-only replay while another writer owns the lock.
- [ ] Move writer-lock acquisition, replay, prompt append, direct tool invocation, ask-user routing, run execution, and run-state tracking into per-session runtime ownership.
- [x] Add session-addressed HTTP bootstrap/replay/run-state endpoints, including direct route bootstrap for `/sessions/:sessionId`.
- [x] Replace `/api/chat/run` with `POST /api/sessions/:sessionId/runs` or an equivalent session-addressed WebSocket action for browser chat sends.
- [ ] Add or update WebSocket actions so every request and response carries `sessionId`; mutating requests also carry `requestId`, and acknowledgements/errors echo both.
- [ ] Add session-scoped actions for `ask_user.answer`, `ask_user.cancel`, direct `tool.invoke`, stop/cancel, retry, and regenerate.
- [ ] Remove the old active-session mutation path after the explicit session-addressed path is in use.

## 2. Browser Routing

- [x] Make `/sessions/:sessionId` the authoritative source for the visible transcript target.
- [x] Treat active session state as UI focus only: sidebar selection, route, default composer target, and context projection.
- [x] Store transcript events, live events, run state, abort handles, and retry metadata by `sessionId`.
- [ ] Store pending prompts and pending request acknowledgements by `sessionId`.
- [x] Store transcript scroll anchors, live-edge state, unread/new-content markers, and saved restore targets by `sessionId`.
- [x] Scope research/tool timeline drawer selection by `sessionId` and clear, close, or rebind it when the route session changes.
- [x] Ignore snapshots, chat events, and run-control results whose `sessionId` does not match the route or subscribed session store being updated.
- [ ] Ignore or settle mutation acknowledgements only by matching `sessionId` and `requestId`.
- [x] Ensure creating a new session navigates only after the server acknowledges the created session id.
- [x] Ensure opening an existing session either waits for an acknowledgement or uses route-addressed bootstrap so stale `session.open` responses cannot overwrite the visible route.
- [x] Ensure direct navigation to an existing session never falls back to the home page while that session exists.
- [ ] Verify independent browser-tab focus when two browser clients view different sessions.

## 2.5 Transcript And Panel UX

- [x] Wrap or replace the plain transcript overflow container with a session-scoped scroller behavior layer.
- [x] Anchor submitted user turns near the top of the transcript while streaming the assistant response below.
- [x] Auto-follow streamed content only while the reader is already at the live edge.
- [x] Stop auto-follow when the reader scrolls away, selects text, uses keyboard navigation, opens transcript links, opens search/command UI, or opens the tool/research drawer.
- [x] Show a jump-to-latest/new-content control when the visible session receives content while the reader is not at the live edge.
- [x] Restore saved sessions to the last meaningful turn or stored reader anchor instead of blindly forcing the absolute bottom.
- [ ] Preserve reader position when history is prepended, markdown completes, tool cards render, tool results stream, or the inline tool/research drawer changes layout.
- [x] Keep existing OpenCandle message, grouped tool-run, and finance-result card visuals unless a separate UI redesign change is created.
- [x] Ensure the research/tool timeline panel renders from the current route session's grouped rows or session store, not from a stale unscoped run object.
- [x] Prevent pending tool runs in a background session from auto-opening or updating the visible route session's panel.

## 3. Concurrency

- [x] Permit session B to send while session A has an active run in the same GUI process.
- [x] Reject overlapping sends within the same session with a clear in-session busy state; do not append or queue the second prompt.
- [ ] Preserve follower/read-only behavior when another TUI or GUI process owns the target session writer lock.
- [ ] Keep stop/cancel controls scoped to the session and run they target.
- [ ] Keep retry/regenerate controls scoped to the original session and blocked by same-session run exclusion.
- [ ] Keep direct tool invocations scoped to the target session and blocked by follower/read-only state for that session.
- [ ] Route `ask_user` answers and cancellations to the session runtime that created the prompt, even if another session is currently visible.

## 4. Parity

- [ ] Verify GUI-created sessions can be resumed by the TUI through canonical Pi/OpenCandle session storage.
- [ ] Verify TUI-created sessions can be resumed by the GUI without browser-local history.
- [ ] Verify GUI and TUI use the same per-session writer lock and surface follower/read-only state when the other surface owns that session.
- [ ] Preserve canonical prompt, assistant, tool-call, tool-result, error, interruption, and OpenCandle custom-entry formats.
- [ ] Preserve Pi branch context across GUI-created and TUI-created sessions.
- [ ] Verify GUI direct tool results and setup-created custom messages round-trip through TUI/Pi and back into GUI route bootstrap.
- [ ] Define exact TUI resume expectations for GUI-created sessions: exact path/id resume vs continue-recent.
- [ ] Confirm no SQLite schema migration or Pi session format change is required.

## 5. Tests And Validation

- [x] Add unit tests for stale snapshot/event rejection by `sessionId`.
- [ ] Add unit tests for request acknowledgement correlation by `sessionId` and `requestId`, including out-of-order acknowledgements.
- [x] Add unit tests for `ChatEvent` type migration so all live and replayed events include `sessionId`, and run-scoped events include `runId`.
- [x] Add reducer tests for idempotence keyed by `(sessionId, seq)`.
- [ ] Add GUI server tests for concurrent different-session runs and same-session run exclusion.
- [ ] Add GUI server tests for per-session writer locks and TUI/GUI follower detection.
- [ ] Add GUI server tests for session-scoped `ask_user` answers/cancels and direct `tool.invoke`.
- [ ] Add browser tests for switching from a running session to another session and sending there.
- [ ] Add browser tests for new-session creation and direct old-session navigation.
- [ ] Add browser tests for stop/retry controls affecting only the targeted session/run.
- [ ] Add browser tests for long streamed transcript scroll behavior: user-turn anchoring, live-edge auto-follow, reader-intent freeze, jump-to-latest, saved restore, and layout-change position preservation.
- [ ] Add browser tests proving explicit message, research, synthesis, or scroll-anchor links override default saved-session restore only when the anchor belongs to the route session.
- [x] Add browser tests for navigating between sessions with the research/tool timeline panel open, verifying it closes, clears, rebinds, or displays only the new route session's tool calls.
- [ ] Capture browser screenshots for PR evidence covering: anchored streaming turn, reader-intent freeze with jump-to-latest visible, restored saved session position, explicit research/synthesis anchor navigation, and route-switch behavior with the research/tool panel no longer showing the previous thread's tool calls.
- [ ] Upload the browser validation screenshots to the PR before deleting local screenshot files.
- [ ] Add a Pi/TUI parity smoke test or documented harness check covering GUI-to-TUI resume, TUI-to-GUI resume, writer-lock participation, branch context, custom entries, and tool-result persistence.
- [x] Run focused GUI server/web tests.
- [ ] Run browser verification on the local GUI. Unchecked 2026-07-03: these were ticked mid-flight while implementation was incomplete; change is being re-baselined, see `gui-session-scoped-action-cleanup`.
- [ ] Run `openspec validate gui-concurrent-session-runtime --strict`. Unchecked 2026-07-03: these were ticked mid-flight while implementation was incomplete; change is being re-baselined, see `gui-session-scoped-action-cleanup`.
- [ ] Run `npm test`. Unchecked 2026-07-03: these were ticked mid-flight while implementation was incomplete; change is being re-baselined, see `gui-session-scoped-action-cleanup`.
