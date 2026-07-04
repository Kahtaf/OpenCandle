## ADDED Requirements

### Requirement: Session-Scoped Transcript Scrolling

The GUI SHALL preserve transcript scroll state by visible route session and reader intent during streamed responses, route changes, and session restores.

#### Scenario: Session route loads with skeleton

- **WHEN** the GUI is loading session data for a chat route
- **THEN** the chat route renders a transcript skeleton
- **AND** it does not briefly show the home prompt or a previous session's conversation as the target session

#### Scenario: New user turn anchors the stream

- **WHEN** the user submits a prompt in session A
- **THEN** the submitted user turn is treated as the active scroll anchor for session A
- **AND** the viewport positions that turn near the top of the visible transcript when the transcript has enough scrollable height
- **AND** streamed assistant content for that turn appears below the anchor without reusing scroll state from another session

#### Scenario: Auto-follow respects reader intent

- **WHEN** session A is streaming a response
- **AND** the reader is at the live edge of session A, defined as the bottom sentinel being visible or the scroll offset being within a small bottom threshold of the transcript end
- **THEN** the transcript follows the streamed content
- **WHEN** the reader scrolls away, uses wheel, touch, keyboard, or mouse interaction in the transcript, or opens the tool/research drawer
- **THEN** the transcript stops auto-following for session A
- **AND** newly streamed content may arrive offscreen without moving the reader's viewport

#### Scenario: New content marker returns to latest

- **WHEN** session A receives new transcript content while the reader is not at the live edge
- **THEN** the GUI shows a session A jump-to-latest or new-content control
- **AND** activating that control scrolls session A until the bottom sentinel is visible
- **AND** the control does not react to new content from session B while session A is visible

#### Scenario: Saved session restores to a meaningful turn

- **WHEN** the user opens an existing session route
- **AND** the route does not include an explicit message, research, synthesis, or scroll anchor
- **THEN** the transcript restores to the most recent user message when available
- **AND** the transcript does not always force the reader to the absolute bottom

#### Scenario: Explicit transcript anchor overrides default restore

- **WHEN** the user opens a session through a link that targets a specific message, synthesis result, research entry, or scroll anchor
- **THEN** the transcript scrolls to that explicit anchor rather than the default restore target
- **AND** the explicit anchor belongs to the route session before it can update the visible transcript position

## MODIFIED Requirements

### Requirement: Canonical Chat Event Stream

The system SHALL expose a canonical chat event stream for GUI rendering and replay, covering run lifecycle, message lifecycle, tool lifecycle, errors, and session updates. Every live and replayed chat event SHALL include the target session ID. Live run lifecycle events and live events observed during a run SHALL include the run ID when the runtime has one; historical replay events are not required to synthesize run IDs that were never persisted.

#### Scenario: Run starts

- **WHEN** a user sends a prompt from a session route in the GUI
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
