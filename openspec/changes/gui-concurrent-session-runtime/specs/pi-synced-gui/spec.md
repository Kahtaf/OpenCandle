## ADDED Requirements

### Requirement: Session-Addressed GUI Runtime

The GUI SHALL address session reads, writes, replay, run state, and writer ownership by explicit Pi/OpenCandle session identity rather than by a process-global active session.

#### Scenario: Active browser focus is not the write target

- **WHEN** the browser route is `/sessions/<session-id>` and the user submits a prompt
- **THEN** the send request targets `<session-id>` explicitly
- **AND** the server does not infer the target from a mutable global active-session value
- **AND** the mutation uses a session-addressed run endpoint or WebSocket action rather than a process-global chat run target

#### Scenario: Stale session response is ignored

- **WHEN** a session load or snapshot request for session A resolves after the browser has navigated to session B
- **THEN** the GUI ignores the session A payload for the visible session B route
- **AND** session B's transcript is not replaced, cleared, or redirected to the home page
- **AND** any acknowledgement or error for session A settles only the pending request identified by session A's `sessionId` and `requestId`

#### Scenario: New session waits for acknowledged identity

- **WHEN** the user starts a new conversation
- **THEN** the GUI waits for the server to acknowledge the created session id before treating the route as writable
- **AND** no old session transcript is shown as the new conversation's canonical transcript
- **AND** creation failure leaves the current visible route unchanged except for an error state

#### Scenario: Direct historical route resolves by id

- **WHEN** the user opens `/sessions/<existing-session-id>` directly
- **THEN** the GUI loads that session by id from Pi/OpenCandle session storage
- **AND** it does not require a previous active-session selection or WebSocket activation message
- **AND** it can replay the transcript read-only when another surface currently owns that session's writer lock

#### Scenario: Existing session open is correlated

- **WHEN** the user opens an existing session from the sidebar
- **THEN** the route target is the selected session id
- **AND** the visible transcript is populated from a session-addressed bootstrap or a correlated acknowledgement for that id
- **AND** a late acknowledgement or snapshot for a different route does not replace the visible transcript

#### Scenario: Browser clients keep independent focus

- **WHEN** browser tab A is viewing session A
- **AND** browser tab B is viewing session B
- **AND** the GUI server broadcasts a snapshot or run event for session A
- **THEN** browser tab B stores the payload under session A state only
- **AND** browser tab B continues rendering session B

### Requirement: Session-Scoped GUI Mutations

The GUI SHALL route every transcript-affecting mutation to an explicit session runtime using session identity and request correlation instead of process-global controllers.

#### Scenario: Direct tool invocation targets a session

- **WHEN** the user invokes a catalog or market-state tool from a GUI surface
- **THEN** the request includes the target session id
- **AND** the assistant tool-call entry and tool-result entry are appended only to that target session
- **AND** the request is rejected when that target session is follower/read-only

#### Scenario: Ask-user answer targets prompt owner

- **WHEN** session A has a pending `ask_user` prompt
- **AND** the browser is currently viewing session B
- **AND** the user answers or cancels the session A prompt
- **THEN** the answer or cancellation is routed to session A's runtime
- **AND** session B's run state and transcript are unchanged

#### Scenario: Setup transcript mutation targets a session

- **WHEN** a setup or provider action creates a user-visible transcript entry
- **THEN** that entry is appended to the explicitly targeted session
- **AND** the action does not append to whichever session is currently focused in the browser

### Requirement: Current-Thread Auxiliary Panels

The GUI SHALL keep chat-adjacent panels that display tool calls, research evidence, sources, or run timelines scoped to the currently visible route session.

#### Scenario: Panel selection identity includes session

- **WHEN** the GUI stores a selected run, tool group, source list, research card, or transcript outline item for an auxiliary panel
- **THEN** that selection identity includes the owning `sessionId`
- **AND** the GUI does not match panel content across sessions by unscoped message id, run id, tool-call id, grouped-row id, title, or index

#### Scenario: Tool panel closes or clears on session change

- **WHEN** the research/tool timeline panel is open for a tool run in session A
- **AND** the user navigates to session B
- **THEN** the panel no longer displays session A tool calls as if they belonged to session B
- **AND** the GUI either closes the panel, clears the panel selection, or binds it only to an explicit session B selection whose identity includes session B

#### Scenario: Open panel updates from the current route session

- **WHEN** the research/tool timeline panel is open while viewing session A
- **AND** additional tool-call or tool-result events arrive for session A
- **THEN** the panel updates from session A's current grouped rows or session store
- **AND** late events from session B do not mutate the visible panel while session A remains the route session

#### Scenario: Auto-open is session-scoped

- **WHEN** session A starts or streams a tool run
- **AND** the browser is currently viewing session B
- **THEN** session A's tool run does not auto-open the research/tool panel over session B
- **AND** session B's panel state is changed only by session B content or by an explicit user action in session B

### Requirement: Concurrent GUI Sessions Preserve Per-Session Writer Safety

The GUI SHALL permit concurrent runs in different sessions owned by the same GUI process while preserving one writer and one active run per individual session.

#### Scenario: Send in another session while one runs

- **WHEN** session A has an active assistant run
- **AND** the user navigates to session B
- **AND** the GUI process holds or can acquire the writer role for session B
- **THEN** the user can submit a prompt in session B without waiting for session A to complete

#### Scenario: Same-session overlapping run is rejected

- **WHEN** session A already has an active run
- **AND** the user submits another prompt to session A
- **THEN** the GUI rejects the second prompt with an explicit same-session busy state
- **AND** it does not append a second concurrent user prompt to session A
- **AND** it does not queue the second prompt unless a separate queueing requirement is added

#### Scenario: Follower lock remains per session

- **WHEN** another TUI or GUI process holds the writer lock for session A
- **THEN** the GUI treats session A as follower/read-only
- **AND** that follower state does not prevent the GUI from writing to session B when session B's writer role is available

#### Scenario: Run state remains per session

- **WHEN** session A has an active run
- **THEN** session A's composer and run controls show the active run state
- **AND** session B's composer does not become disabled solely because session A is running
- **AND** stop, retry, and regenerate controls affect only their targeted session and run

### Requirement: TUI And GUI Share Per-Session Writer Locks

OpenCandle SHALL use a canonical per-session writer lock for both TUI and GUI writers so cross-surface writer/follower state is based on the same session identity.

#### Scenario: Persisted file path is the canonical lock key

- **WHEN** a session has a persisted Pi session file
- **THEN** GUI and TUI derive the writer lock from that file path
- **AND** they do not derive the lock solely from the process-wide session directory

#### Scenario: Runtime releases idle lock

- **WHEN** a GUI session runtime has no active run and no subscribed browser clients
- **THEN** the runtime may be evicted
- **AND** any writer lock and heartbeat for that session are released before eviction completes

#### Scenario: GUI observes TUI writer

- **WHEN** the TUI owns the writer lock for session A
- **THEN** the GUI renders session A as follower/read-only
- **AND** GUI writer-only actions for session A are rejected without appending entries

#### Scenario: TUI observes GUI writer

- **WHEN** the GUI owns the writer lock for session A
- **THEN** the TUI does not start a competing writer for session A
- **AND** the TUI either enters follower/read-only mode or clearly rejects the write attempt
- **AND** the rejection does not prevent the TUI from opening a different unlocked session when that flow is available

#### Scenario: Per-session lock does not block unrelated session

- **WHEN** the TUI owns the writer lock for session A
- **AND** no writer owns session B
- **THEN** the GUI can acquire the writer lock for session B
- **AND** the GUI can run session B without taking over session A

### Requirement: GUI And TUI Share Session Semantics

The GUI SHALL preserve semantic parity with the TUI and Pi by using canonical Pi/OpenCandle session entries, writer locks, and resume behavior for every session actor.

#### Scenario: GUI-created session resumes in TUI

- **WHEN** a session is created and written through the GUI
- **THEN** the TUI can resume that session from canonical Pi/OpenCandle storage by supported exact-session or recent-session flow
- **AND** the transcript contains the same user, assistant, tool-call, tool-result, error, and interruption entries expected by Pi session readers
- **AND** OpenCandle custom entries and branch context remain available to later TUI turns

#### Scenario: Direct tool and setup entries round trip

- **WHEN** a GUI-created session contains direct tool invocation results and setup-created OpenCandle custom messages
- **THEN** those entries are persisted in canonical Pi/OpenCandle session format
- **AND** the TUI can replay or continue the session without losing those entries
- **AND** a later GUI route bootstrap can replay the same entries after a TUI turn

#### Scenario: TUI-created session runs in GUI

- **WHEN** a session is created in the TUI
- **AND** no other surface owns that session's writer lock
- **THEN** the GUI can open the session by id and submit a prompt without copying history into browser-owned storage
- **AND** OpenCandle custom entries and branch context remain available to GUI replay and later GUI turns

#### Scenario: TUI focus remains singleton

- **WHEN** the TUI presents one focused session at a time
- **THEN** that terminal UX remains valid
- **AND** it does not justify a GUI process-global write target because GUI windows can route and subscribe to multiple sessions

## MODIFIED Requirements

### Requirement: Financial Context Projection

The GUI SHALL derive the financial context panel from the visible route session history, tool events, and current run state rather than from independent browser-only state or a process-global active session.

#### Scenario: Quote tool updates context

- **WHEN** a stock quote tool result appears in the visible route session
- **THEN** the financial context panel reflects the visible route session's active symbol and latest quote data from that result

#### Scenario: Reconnect rebuilds context

- **WHEN** the browser reconnects or reloads during an existing route session
- **THEN** the financial context panel is rebuilt from canonical state for that route session

### Requirement: Distinct Runtime States

The GUI SHALL distinguish onboarding, connecting, streaming, follower/read-only, failed, and ready states per target session.

#### Scenario: Agent stream is connecting

- **WHEN** a prompt has been submitted in session A and the run is waiting for the stream to begin
- **THEN** session A labels the state as connecting
- **AND** setup/follower states for other sessions remain visually distinct

#### Scenario: Session is follower-only

- **WHEN** the visible route session is held by another writer
- **THEN** the composer indicates read-only/follower mode rather than presenting a broken send state
