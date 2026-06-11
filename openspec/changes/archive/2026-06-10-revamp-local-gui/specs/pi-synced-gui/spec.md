## ADDED Requirements

### Requirement: Peer GUI Surface
The system SHALL provide a local GUI as a peer surface to the TUI, using Pi/OpenCandle session primitives as the canonical source of chat history, tool events, and resume state.

#### Scenario: GUI resumes TUI-created session
- **WHEN** a user opens the GUI after creating a session in the TUI
- **THEN** the GUI lists that session and can resume it without copying history into a browser-owned store

#### Scenario: TUI resumes GUI-created session
- **WHEN** a user creates or continues a session in the GUI and later opens the TUI
- **THEN** the TUI can read the same Pi/OpenCandle session history and continue the thread

### Requirement: Canonical Browser State Boundary
The GUI SHALL NOT treat IndexedDB, localStorage, TanStack Query cache, or any browser-local persistence as canonical chat history.

#### Scenario: Browser cache is cleared
- **WHEN** a user clears browser storage and reloads the GUI
- **THEN** previous sessions and messages remain available from Pi/OpenCandle session storage

#### Scenario: Browser caches UI preferences
- **WHEN** the GUI stores layout preferences, selected panel state, or draft UI state in browser storage
- **THEN** those preferences do not replace or fork canonical session history

### Requirement: Chat-First Layout
The GUI SHALL present chat as the primary first-screen workflow, with financial context available without displacing the main conversation.

#### Scenario: Desktop layout
- **WHEN** the GUI is opened on a desktop viewport
- **THEN** the main chat occupies the central workspace and a right-side financial context panel is visible or one click away

#### Scenario: Mobile layout
- **WHEN** the GUI is opened on a mobile viewport
- **THEN** chat remains the primary view and session history plus financial context are accessible through mobile-appropriate drawers, tabs, or panels

### Requirement: Session History and Resume
The GUI SHALL provide visible session history and resume controls on both desktop and mobile.

#### Scenario: Desktop session history
- **WHEN** a user opens the desktop GUI
- **THEN** prior sessions are available from the main shell without requiring a direct URL or terminal command

#### Scenario: Mobile session history
- **WHEN** a user opens the mobile GUI
- **THEN** prior sessions are reachable through a mobile control and can be resumed

### Requirement: Financial Context Projection
The GUI SHALL derive the financial context panel from active session history, tool events, and current run state rather than from independent browser-only state.

#### Scenario: Quote tool updates context
- **WHEN** a stock quote tool result appears in the active session
- **THEN** the financial context panel reflects the active symbol and latest quote data from that result

#### Scenario: Reconnect rebuilds context
- **WHEN** the browser reconnects or reloads during an existing session
- **THEN** the financial context panel is rebuilt from canonical session state

### Requirement: Writer and Follower Safety
The GUI SHALL preserve the existing writer/follower safety model so only one surface drives agent execution for a session at a time.

#### Scenario: Session is held by another writer
- **WHEN** the GUI opens a session currently held by another writer surface
- **THEN** the GUI indicates follower/read-only state and does not start a competing agent run

#### Scenario: Writer is available
- **WHEN** the GUI opens a session with no active writer
- **THEN** the GUI can acquire the writer role before sending a user prompt

### Requirement: Local GUI Boundary
The GUI SHALL remain local and single-user for this change.

#### Scenario: GUI starts locally
- **WHEN** the user runs the GUI command
- **THEN** the GUI serves a local browser app backed by the local OpenCandle runtime

#### Scenario: Hosted behavior is requested
- **WHEN** hosted multi-user sharing or cloud sync is needed
- **THEN** that behavior is deferred to a separate change

### Requirement: First-Run Provider Onboarding
The GUI SHALL provide actionable first-run onboarding when the required model or provider API key is not configured.

#### Scenario: No model API key is configured
- **WHEN** a first-time user opens the GUI without a configured model API key
- **THEN** the chat surface shows setup actions and does not remain indefinitely in a connecting state

#### Scenario: API key is added
- **WHEN** the user adds or tests an API key through GUI onboarding
- **THEN** the GUI updates provider/model readiness and returns the user to the pending chat workflow

### Requirement: Distinct Runtime States
The GUI SHALL distinguish onboarding, connecting, streaming, follower/read-only, failed, and ready states.

#### Scenario: Agent stream is connecting
- **WHEN** a prompt has been submitted and the run is waiting for the stream to begin
- **THEN** the GUI labels the state as connecting and keeps setup/follower states visually distinct

#### Scenario: Session is follower-only
- **WHEN** the active session is held by another writer
- **THEN** the composer indicates read-only/follower mode rather than presenting a broken send state

### Requirement: Accessible Shell Interactions
The GUI SHALL make primary shell interactions keyboard accessible and screen-reader legible.

#### Scenario: Command palette
- **WHEN** the user opens the command palette from the keyboard
- **THEN** focus moves into the palette and the user can select an action without a pointer

#### Scenario: Mobile drawer
- **WHEN** a mobile session or context drawer is opened
- **THEN** focus is contained within the drawer until it is closed
