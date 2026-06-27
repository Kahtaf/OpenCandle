# Design - `gui-concurrent-session-runtime`

## 1. Current Failure Mode

The GUI has a single mutable active session concept shared by routing, session loading, sending, and event projection. That is too broad. Route focus is a browser concern; writer ownership and run execution are per-session runtime concerns.

When a user clicks between sessions, async work started for the old selection can still finish after the new route is visible. If the response is not scoped and checked against the route session id, the old data can overwrite the new page. The same race affects new-session creation, historical session loading, and send validation.

The fix is to make session identity explicit at every boundary.

## 2. Runtime Shape

Introduce a GUI session runtime registry, or refactor the existing runtime into equivalent behavior:

```text
GuiServer
  SessionRuntimeRegistry
    sessionId A -> GuiSessionRuntime
    sessionId B -> GuiSessionRuntime
    sessionId C -> GuiSessionRuntime
```

Each `GuiSessionRuntime` owns only one Pi/OpenCandle session and is responsible for:

- opening or creating the canonical Pi session through existing session APIs;
- acquiring or observing the canonical writer lock for that session;
- serializing runs for that session;
- replaying historical entries into chat events for that session;
- appending user prompts and agent/tool entries only when it holds that session's writer role;
- publishing session-scoped events.

The registry may lazily create runtimes on first route load or send. It should remove idle runtimes only after no run is active and no clients are subscribed.

The lock key must be derived from the canonical Pi session identity, not the process-wide session directory alone. Use the persisted session file path when one exists. For a not-yet-persisted in-memory session, use the session directory only as a startup fallback until the session has a file. Rename and delete operations must release or refresh the old lock scope so stale lock files do not make an unrelated session read-only.

Each runtime that holds a writer role owns that session's lock heartbeat. It releases the lock when the runtime is disposed, when the session is deleted, or after idle eviction once no run is active and no client remains subscribed. A GUI process may hold locks for multiple sessions, but never more than one active writer lock for the same session.

## 3. Identity And Correlation

Every route load, WebSocket action, HTTP fallback request, mutation acknowledgement, snapshot, and chat event should include the target `sessionId`. Mutating requests should also include a `requestId`; run events should include a `runId`.

Acknowledgements and errors for mutating requests must echo `sessionId` and `requestId`. Client reducers must apply an incoming payload only when its `sessionId` matches the route or subscribed session it is updating. Pending-request handling must settle only the matching `requestId`. When a stale response arrives for an older route, the client ignores it and leaves the current route untouched.

The active browser session remains useful as UI focus:

- highlighted sidebar item;
- current route;
- default composer target;
- financial context projection for the visible transcript.

It must not be the server's implicit write target.

## 4. Send Semantics

Sending a prompt from `/sessions/:sessionId` targets that `sessionId` explicitly. The HTTP shape should be `POST /api/sessions/:sessionId/runs` or an equivalent WebSocket action with the same identity fields. The current global `/api/chat/run` behavior must be removed or reduced to a non-mutating compatibility error before this change is considered complete.

Rules:

- If the GUI writer process holds the writer role for that session and no run is active in that session, the send starts a new run.
- If another run is already active in the same session, the send is rejected with a same-session busy outcome. It is not appended or queued.
- If another surface holds that session's writer lock, the send is rejected with follower/read-only state and the UI offers the existing takeover flow.
- If a different session has an active run, this send is still allowed.

This preserves Pi's "one writer per session" safety while removing the GUI process-wide bottleneck.

## 5. HTTP And WebSocket Contract

WebSocket actions can remain the primary live path, but direct route loads must not depend on WebSocket ordering. The server should expose session-addressed HTTP reads for at least:

- session metadata/history bootstrap;
- session transcript replay;
- current run state for that session.

The WebSocket layer should support session-scoped subscriptions and mutations. Broadcasts must include `sessionId`, and the client should route each event to the matching session store.

If the implementation keeps a single WebSocket connection, the protocol still needs per-message session identity. Multiple sockets are not required.

Multiple browser tabs or windows are local clients of the same GUI server. Each client has independent route focus. Server broadcasts may still be shared, but the client must keep focus and subscriptions session-scoped so a snapshot for session A cannot replace the visible route for a tab currently showing session B.

Direct session routes should be able to load `/sessions/:sessionId` through HTTP before any `session.open` or WebSocket activation message is sent. Opening an existing session through the sidebar should navigate to the route id and populate the visible transcript from session-addressed bootstrap. Viewing history must be allowed even when another surface owns the writer lock; only transcript-affecting mutations require writer ownership.

## 6. Session-Scoped Mutations Beyond Chat

The session runtime must own every transcript mutation for its target session, not only normal chat prompts.

That includes:

- `ask_user.answer` and `ask_user.cancel`;
- direct `tool.invoke` from catalog or market-state pages;
- setup or provider actions that append user-visible transcript entries;
- stop/cancel, retry, and regenerate controls;
- branch/fork operations when exposed by the surface.

Each of these requests must include `sessionId`; requests that can be outstanding concurrently must include `requestId`. `ask_user` prompts should also carry enough identity for the answer to route to the owning session runtime even when the browser is currently viewing another session.

## 7. Client State

The browser should keep route-visible state separate from per-session state:

- transcripts/events by `sessionId`;
- live events by `sessionId` and `runId`;
- run state by `sessionId`;
- abort/retry handles by `sessionId` and `runId`;
- pending `ask_user` prompts by `sessionId` and prompt id;
- pending mutation acknowledgements by `sessionId` and `requestId`.

The visible route selects from those stores. A run in session A must not put the session B composer into a global streaming state, and stopping session B must not abort session A.

Reducers that combine events from more than one session must scope message IDs, tool-call IDs, run IDs, and sequence numbers by `sessionId`. Persisted replay events do not need a synthetic `runId` when the run id was never stored; live run lifecycle events and live tool/message events from an active run must carry `runId`.

## 8. Transcript Scroll Behavior

The transcript scroller should be treated as a session-scoped runtime surface, not as incidental overflow behavior. Long OpenCandle runs can stream assistant text, append grouped tool cards, open a tool timeline drawer, and change layout heights while the user is reading earlier financial evidence. The GUI should preserve the reader's intent while still making live progress visible.

Rules:

- user turns are scroll anchors by default;
- when the user submits a prompt, the new user turn anchors within the first quarter of the visible transcript viewport when there is enough scrollable height, and the assistant response streams below it;
- auto-follow happens only while the reader is already at the live edge, meaning a bottom sentinel is visible or the scroll position is within a small bottom threshold;
- scrolling away, selecting text, keyboard navigation, opening links, opening command/search UI, or opening the tool/research drawer stops auto-follow for that transcript until the user explicitly returns to latest;
- when new content arrives offscreen, the GUI shows an unobtrusive jump-to-latest/new-content control for the visible session;
- saved session routes without an explicit anchor reopen at the last meaningful turn when available, using a stored reader anchor first and otherwise the most recent user message, not blindly at the absolute bottom;
- explicit message, synthesis, research, or scroll anchors in links override the default saved-session restore target and must belong to the route session before changing scroll position;
- prepending history, completing markdown, rendering rich cards, opening the inline tool drawer, and receiving streamed tool results preserve the visible reader position;
- scroll state is keyed by route session id so navigating between sessions does not reuse another transcript's anchor, live-edge state, or unread marker.

This can be implemented with a headless message-scroller primitive or a local hook. The implementation should not replace OpenCandle's existing message components, finance result cards, or grouped tool-run cards unless a smaller follow-up explicitly chooses that visual migration.

## 9. Current-Thread Auxiliary Panels

Auxiliary panels that summarize or expand chat evidence must derive from the route session, not from the last opened panel object. The current bug is that the research/tool timeline panel can remain open while the user navigates to another chat, but still show tool calls from the old thread.

The panel state should therefore include the owning `sessionId` for any selected run, tool group, source list, or research card. It must not match panel content across sessions by unscoped message id, run id, tool-call id, row id, title, or array index. On route change, the client must either:

- bind the panel to an explicit selection in the new route session whose identity includes that new session id; or
- clear/close the panel when its selected content belongs to a different session.

The drawer body should render from the selected route session's grouped rows or session store, not from an unscoped object captured before navigation. Pending auto-open behavior must also be session-scoped: a tool run in session A must not auto-open or update the drawer while the browser is viewing session B unless the drawer explicitly belongs to session A and the route still allows viewing that session's panel.

This same rule should apply to any future transcript outline, source panel, or research summary panel: if it claims to describe "this thread," its inputs must be selected from the visible route session.

## 10. TUI And Pi Parity

The TUI can keep a single focused session because that matches terminal UX. The parity requirement is semantic and storage-backed:

- GUI and TUI read and write the same Pi/OpenCandle session entries;
- a GUI-created session can be resumed in TUI;
- a TUI-created session can be resumed in GUI;
- explicit resume by session path/id and continue-recent behavior remain well-defined for GUI-created sessions;
- writer/follower lock behavior is per session in both surfaces;
- the same prompt/tool/result/custom-entry model is used for persistence and replay;
- branch context and OpenCandle custom entries remain available to later turns in both surfaces.

The GUI runtime may run multiple session actors in one process, but each actor must behave like a normal Pi session writer for its specific session.

## 11. Verification Strategy

Implementation should prove the old races are gone with targeted tests:

- unit tests for request/session correlation and stale snapshot rejection;
- unit tests for `ChatEvent` typing, live/replay adapter session identity, and reducer filtering by `(sessionId, seq)`;
- GUI server tests for concurrent runs in different sessions and single-run enforcement within one session;
- GUI server tests for `ask_user` and direct `tool.invoke` routing to the owning session while another route is visible;
- browser tests that start a long response in session A, switch to session B, send a message there, and verify both transcripts remain separated;
- browser tests that stop/retry a run in one session without affecting another active run;
- browser tests for direct navigation to an old session URL with and without an already-open WebSocket;
- browser tests for transcript scroll behavior during a long streaming response: anchor the submitted user turn, follow only at live edge, stop following when the reader scrolls away, show a jump-to-latest control, and preserve position when tool cards/drawers change layout;
- browser tests that navigate from session A to session B while the tool/research drawer is open and verify the panel closes, clears, or shows only session B tool calls;
- screenshot evidence from browser validation uploaded to the PR for the transcript scroller states and current-thread panel synchronization; local screenshots may be deleted after upload;
- parity smoke that a GUI-created session is readable from TUI/Pi session APIs and a TUI-created session is readable from GUI APIs;
- parity smoke that GUI and TUI respect the same per-session writer lock;
- parity smoke that branch context, OpenCandle custom entries, direct tool results, and setup custom messages survive GUI-to-TUI and TUI-to-GUI round trips.

## 12. Rollout

Implement the new session-addressed read and write path first, update the browser to use it, then remove the old active-session mutation path. Avoid leaving two send paths because that recreates ambiguous ownership.

Transcript scroll behavior and auxiliary-panel scoping should land after the browser has reliable per-session stores. That keeps the scroller and drawer logic keyed to stable route/session state instead of patching around the current global active-session assumptions.
