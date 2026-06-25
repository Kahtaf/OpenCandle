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

#### Scenario: Direct historical route resolves by id

- **WHEN** the user opens `/sessions/<existing-session-id>` directly
- **THEN** the GUI loads that session by id from Pi/OpenCandle session storage
- **AND** it does not require a previous active-session selection or WebSocket activation message

#### Scenario: Existing session open is correlated

- **WHEN** the user opens an existing session from the sidebar
- **THEN** the open request includes the target session id and request id
- **AND** the acknowledgement or error echoes the same session id and request id
- **AND** a late acknowledgement for a different route does not replace the visible transcript

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

#### Scenario: GUI observes TUI writer

- **WHEN** the TUI owns the writer lock for session A
- **THEN** the GUI renders session A as follower/read-only
- **AND** GUI writer-only actions for session A are rejected without appending entries

#### Scenario: TUI observes GUI writer

- **WHEN** the GUI owns the writer lock for session A
- **THEN** the TUI does not start a competing writer for session A
- **AND** the TUI either enters follower/read-only mode or clearly rejects the write attempt

#### Scenario: Per-session lock does not block unrelated session

- **WHEN** the TUI owns the writer lock for session A
- **AND** no writer owns session B
- **THEN** the GUI can acquire the writer lock for session B
- **AND** the GUI can run session B without taking over session A

### Requirement: GUI And TUI Share Session Semantics

The GUI SHALL preserve semantic parity with the TUI and Pi by using canonical Pi/OpenCandle session entries, writer locks, and resume behavior for every session actor.

#### Scenario: GUI-created session resumes in TUI

- **WHEN** a session is created and written through the GUI
- **THEN** the TUI can resume that session from canonical Pi/OpenCandle storage
- **AND** the transcript contains the same user, assistant, tool-call, tool-result, error, and interruption entries expected by Pi session readers
- **AND** OpenCandle custom entries and branch context remain available to later TUI turns

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
