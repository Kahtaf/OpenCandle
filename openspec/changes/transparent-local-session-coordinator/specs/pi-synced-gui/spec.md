## MODIFIED Requirements

### Requirement: Writer and Follower Safety
The GUI SHALL preserve single-writer session safety internally while presenting local GUI, browser, and TUI chat surfaces as normal clients that route supported session actions through the local session coordinator.

#### Scenario: Session is coordinated by another live local surface
- **WHEN** the GUI opens a session currently coordinated by another local OpenCandle surface
- **THEN** the GUI can read the session and submit supported session write intents through that coordinator
- **AND** it does not present the session as follower/read-only during normal operation

#### Scenario: Coordinator is available
- **WHEN** the GUI submits a session prompt and a live coordinator is available
- **THEN** the action is executed by the coordinator or proxied to it
- **AND** transcript updates are broadcast back to connected local surfaces

#### Scenario: Session state replaces process-wide role
- **WHEN** the GUI switches between sessions with different local coordinator owners
- **THEN** the GUI evaluates readiness, syncing, busy, or unavailable state for the selected target session
- **AND** it does not reuse one process-wide writer/follower role to enable or disable every session action

#### Scenario: Coordinator owner is alive but delayed
- **WHEN** the GUI submits a write intent and the recorded coordinator PID is still alive but heartbeat is late
- **THEN** the GUI shows a neutral syncing or reconnecting state
- **AND** it does not attempt a user-facing takeover or create a competing writer

### Requirement: Distinct Runtime States
The GUI SHALL distinguish onboarding, connecting, syncing, reconnecting, streaming, failed, and ready states without exposing internal writer/follower ownership as a normal user-facing mode.

#### Scenario: Agent stream is connecting
- **WHEN** a prompt has been submitted and the run is waiting for the stream to begin
- **THEN** the GUI labels the state as connecting and keeps setup states visually distinct

#### Scenario: Local coordinator is syncing
- **WHEN** the active browser tab is routing a write intent through another local coordinator or waiting for a live owner to reconnect
- **THEN** the relevant submitting control shows transient syncing or reconnecting feedback
- **AND** the GUI does not describe the tab as follower-only or read-only follower mode

#### Scenario: Coordination fails
- **WHEN** the GUI cannot reach a live coordinator and recovery is unsafe or fails
- **THEN** the GUI shows a retryable unavailable state
- **AND** any disabled write controls use neutral connection language rather than writer/follower terminology

#### Scenario: Deferred non-session mutation is unavailable
- **WHEN** setup or market-state mutation coordination is outside the current session coordinator scope
- **THEN** the GUI may disable the relevant mutation controls in that window
- **AND** the disabled state uses neutral availability language rather than implying session write proxying exists
