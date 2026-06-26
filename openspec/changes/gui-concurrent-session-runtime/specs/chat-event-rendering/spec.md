## MODIFIED Requirements

### Requirement: Canonical Chat Event Stream

The system SHALL expose a canonical chat event stream for GUI rendering and replay, covering run lifecycle, message lifecycle, tool lifecycle, errors, and session updates. Every live and replayed chat event SHALL include the target session ID. Live run lifecycle events and live events observed during a run SHALL include the run ID when the runtime has one; historical replay events are not required to synthesize run IDs that were never persisted.

#### Scenario: Run starts

- **WHEN** a user sends a prompt from the GUI
- **THEN** the stream emits a `run.started` event with a run ID, session ID, and sequence number

#### Scenario: Run completes

- **WHEN** the agent finishes a prompt successfully
- **THEN** the stream emits `run.completed` after all message and tool completion events for that run
- **AND** the completion event includes the same session ID and run ID as the started event

#### Scenario: Run fails

- **WHEN** the agent run fails
- **THEN** the stream emits `run.failed` with the same session ID and run ID as the started event

#### Scenario: Event for another session arrives

- **WHEN** the GUI is rendering session A
- **AND** a live or replayed event for session B arrives on the same connection
- **THEN** the GUI routes that event only to session B state
- **AND** the visible session A transcript and run state are unchanged

### Requirement: Ordered and Idempotent Events

Every chat event SHALL include a monotonic sequence number within its session. The GUI SHALL evaluate ordering and idempotence by the pair of session ID and sequence number, so concurrent sessions can reuse local sequence ranges without colliding. When a reducer combines events from multiple sessions, message IDs, tool-call IDs, and run IDs SHALL also be scoped by session ID.

#### Scenario: Duplicate event arrives

- **WHEN** the GUI receives an event whose session ID and sequence number have already been applied
- **THEN** the GUI ignores that duplicate without rendering another message or tool card

#### Scenario: Replay rebuilds state

- **WHEN** the GUI rebuilds a chat from historical events for a target session
- **THEN** applying that session's event sequence produces the same rendered message/tool state as the live stream

#### Scenario: Same sequence in another session

- **WHEN** session A and session B both emit an event with sequence number 1
- **THEN** the GUI treats those events as distinct because their session IDs differ

#### Scenario: Same message id in another session

- **WHEN** session A and session B contain replayed or live events with the same message id or tool-call id
- **THEN** the GUI stores and renders those items independently by session
- **AND** completing the item in session A does not mutate the item in session B

### Requirement: Stream Controls

The GUI SHALL provide controls for stopping an active stream and retrying or regenerating after a failed or completed run when the target session has writer permission. Stop, retry, and regenerate requests SHALL include the target session ID and run ID where applicable.

#### Scenario: Stop active stream

- **WHEN** an assistant response is streaming in session A and the user activates stop for that run
- **THEN** the GUI requests cancellation for session A's targeted run
- **AND** active or ready runs in other sessions are unaffected

#### Scenario: Retry failed run

- **WHEN** a run fails in session A
- **THEN** the GUI exposes a retry action for session A
- **AND** retry starts a new run in session A only when that session has writer permission and no active same-session run

### Requirement: Session-Scoped Mutation Acknowledgements

Mutating GUI requests SHALL include session ID and request ID when the request can be outstanding concurrently. Acknowledgements and errors SHALL echo both values so the GUI can settle the correct pending request.

#### Scenario: Out-of-order acknowledgement arrives

- **WHEN** the GUI sends mutation request A for session A and mutation request B for session B
- **AND** request B's acknowledgement arrives before request A's acknowledgement
- **THEN** the GUI settles only request B's pending state
- **AND** the visible route is not changed unless request B targets that route

#### Scenario: Stale acknowledgement arrives

- **WHEN** an acknowledgement for session A arrives after the browser has navigated to session B
- **THEN** the GUI applies the acknowledgement only to session A state
- **AND** it does not replace session B's transcript, run state, or route
