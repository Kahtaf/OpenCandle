## ADDED Requirements

### Requirement: Session-Addressed GUI Chat Routes

The GUI SHALL treat `/sessions/<session-id>` as the authoritative visible chat target for session-route reads and chat sends that occur from that route.

#### Scenario: Direct historical route resolves by id

- **WHEN** the user opens `/sessions/<existing-session-id>` directly
- **THEN** the GUI loads that session by id from Pi/OpenCandle session storage
- **AND** it does not require a previous active-session selection or WebSocket activation message

#### Scenario: Existing session open is correlated

- **WHEN** the user opens an existing session from the sidebar
- **THEN** the route target is the selected session id
- **AND** the visible transcript is populated from a session-addressed bootstrap or a correlated acknowledgement for that id
- **AND** a late acknowledgement or snapshot for a different route does not replace the visible transcript

#### Scenario: New session waits for acknowledged identity

- **WHEN** the user starts a new conversation from the GUI
- **THEN** the GUI waits for the server to acknowledge the created session id before navigating to the session route
- **AND** no old session transcript is shown as the new conversation's canonical transcript
- **AND** creation failure leaves the current visible route unchanged except for an error state

#### Scenario: Session route chat send carries expected session

- **WHEN** the browser route is `/sessions/<session-id>` and the user submits a prompt
- **THEN** the browser sends the chat run to a session-addressed run endpoint for `<session-id>`
- **AND** the request body carries the same expected session id

#### Scenario: Session mismatch is rejected

- **WHEN** a session-addressed run request route and body name different session ids
- **THEN** the GUI server rejects the request with HTTP 409
- **AND** the error payload includes code `session_changed`
- **AND** the browser treats that response as a stale-session conflict instead of appending the prompt to the wrong transcript

### Requirement: Concurrent Route Sessions

The GUI SHALL permit independent chat runs in different route sessions while preserving one active run per individual session.

#### Scenario: Send in another session while one runs

- **WHEN** session A has an active assistant run
- **AND** the user navigates to session B
- **AND** the GUI can write to session B
- **THEN** the user can submit a prompt in session B without waiting for session A to complete

#### Scenario: Same-session overlapping run is rejected

- **WHEN** session A already has an active run
- **AND** the user submits another prompt to session A
- **THEN** the GUI rejects the second prompt with an explicit same-session busy state
- **AND** it does not append a second concurrent user prompt to session A
- **AND** it does not queue the second prompt unless a separate queueing requirement is added

#### Scenario: Run state remains route-scoped

- **WHEN** session A has an active run
- **THEN** session A's route shows the active run state
- **AND** session B's route does not become disabled solely because session A is running

### Requirement: Current-Route Auxiliary Panels

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

## MODIFIED Requirements

### Requirement: Financial Context Projection

The GUI SHALL derive the financial context panel from the visible route session history, tool events, and current run state rather than from independent browser-only state.

#### Scenario: Quote tool updates context

- **WHEN** a stock quote tool result appears in the visible route session
- **THEN** the financial context panel reflects the visible route session's active symbol and latest quote data from that result

#### Scenario: Reconnect rebuilds context

- **WHEN** the browser reconnects or reloads during an existing route session
- **THEN** the financial context panel is rebuilt from canonical state for that route session
