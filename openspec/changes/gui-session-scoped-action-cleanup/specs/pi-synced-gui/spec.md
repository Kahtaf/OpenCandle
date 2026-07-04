## ADDED Requirements

### Requirement: GUI Mutations Use Explicit Session Actions

The GUI SHALL send every transcript-affecting mutation to an explicit target session and SHALL use the coordinator `actionId` envelope defined by the `local-session-coordination` capability for supported local session actions.

#### Scenario: Legacy active-session mutation path is unavailable

- **WHEN** a GUI server route would mutate chat or transcript state without an explicit target `sessionId`
- **THEN** the route is removed or returns HTTP 410
- **AND** the server does not resolve the mutable current active session as the target for that mutation

#### Scenario: Client mutation calls carry session identity

- **WHEN** the browser sends a chat run, stop, retry/regenerate, `ask_user` answer, `ask_user` cancellation, or direct `tool.invoke` request
- **THEN** the request includes the target `sessionId`
- **AND** the request is rejected before mutation if the target session cannot be identified

#### Scenario: Coordinator action id envelope is used

- **WHEN** a supported GUI mutation is submitted
- **THEN** it flows through the coordinator's `actionId` envelope for that target session
- **AND** transport retries reuse the same `actionId`
- **AND** a deliberate repeated user action mints a fresh `actionId`

#### Scenario: No implicit active-session mutation remains

- **WHEN** maintainers inspect GUI server mutation routes and browser mutation call sites
- **THEN** grep-level proof or a route-table snapshot shows no chat run, stop, retry/regenerate, `ask_user`, or direct `tool.invoke` mutation resolves the active session implicitly
- **AND** read-only bootstrap, listing, and navigation paths are the only code paths allowed to consult active browser focus without creating a transcript mutation

### Requirement: Cross-Session Action Concurrency

The GUI SHALL allow independent sessions to run concurrently while preserving one active run and one action target per session.

#### Scenario: Different sessions can run concurrently

- **WHEN** session A has an active run
- **AND** the browser submits a prompt to session B with a distinct `sessionId`
- **THEN** session B can start and stream without waiting for session A
- **AND** session A and session B maintain independent run state

#### Scenario: Same session remains single active run

- **WHEN** session A already has an active run
- **AND** another prompt targets session A
- **THEN** OpenCandle rejects the second prompt with a neutral same-session busy or retryable state
- **AND** it does not queue the prompt silently
- **AND** it does not start a competing same-session run

#### Scenario: Stop or cancel targets only one session

- **WHEN** session A and session B both have active or pending work
- **AND** the browser sends stop or cancel for session A
- **THEN** only session A's targeted run or pending action is affected
- **AND** session B continues unchanged

#### Scenario: Retry or regenerate stays with the original session

- **WHEN** a failed or completed run in session A exposes retry or regenerate
- **AND** the browser focus has moved to session B
- **THEN** activating that control targets session A
- **AND** the action is blocked by session A's same-session run exclusion if session A is already active
- **AND** session B's transcript and run state are unchanged

#### Scenario: Ask-user answer targets prompt owner

- **WHEN** session A has a pending `ask_user` prompt
- **AND** the browser is currently focused on session B
- **AND** the user answers or cancels the session A prompt
- **THEN** the answer or cancellation is routed to session A's coordinator action
- **AND** session B's run state and transcript are unchanged

### Requirement: GUI-Created Sessions Remain TUI-Continuable

OpenCandle SHALL preserve TUI parity for GUI-created sessions through the current shared Pi/OpenCandle session storage behavior without requiring a schema or session-format change.

#### Scenario: GUI session appears in shared session continuation

- **WHEN** a session is created and written through the GUI
- **THEN** the session appears in the shared Pi/OpenCandle session list or recent-session continuation flow for the same project/session directory
- **AND** the TUI can continue that session through the supported list or recent-session flow
- **AND** the transcript contains the same user, assistant, tool-call, tool-result, error, interruption, and OpenCandle custom entries expected by Pi session readers

#### Scenario: Parity confirmation is scripted

- **WHEN** implementation validation runs for this change
- **THEN** a scripted check creates or identifies a GUI-created session and confirms the TUI/Pi continuation behavior above
- **AND** the result is recorded as implementation evidence

#### Scenario: No storage migration is introduced

- **WHEN** this cleanup is implemented
- **THEN** it does not require a SQLite schema migration
- **AND** it does not require a Pi session format change
