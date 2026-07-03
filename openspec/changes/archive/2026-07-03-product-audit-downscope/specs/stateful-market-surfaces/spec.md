## MODIFIED Requirements

### Requirement: GUI Provides Durable Market-State Navigation

OpenCandle's GUI SHALL expose durable market-state domains through persistent navigation and dedicated management pages.

#### Scenario: Navigation exposes market-state domains

- **WHEN** the GUI is open
- **THEN** the user can navigate to Watchlists, Portfolios, Alerts, and Reports areas
- **AND** those areas read from SQLite-backed market state rather than session-only projection state
- **AND** no Predictions area is present in navigation or routes

#### Scenario: Watchlists page manages saved watchlists

- **WHEN** the user opens the Watchlists page
- **THEN** the page shows the default watchlist in V1
- **AND** supports adding, removing, and updating items through the shared resolver and market-state service

#### Scenario: Portfolios page manages saved portfolio lots

- **WHEN** the user opens the Portfolios page
- **THEN** the page shows the default portfolio in V1
- **AND** supports adding, removing, and updating lots through the shared resolver and market-state service

#### Scenario: Portfolio row removal targets one lot

- **WHEN** the user removes a visible portfolio row from the GUI
- **THEN** OpenCandle removes the selected `portfolio_lot.id`
- **AND** it does not remove other lots for the same symbol unless the user chose an explicit remove-all-symbol action

#### Scenario: Alerts and reports pages manage durable automation state

- **WHEN** the user opens Alerts or Reports
- **THEN** the GUI can list durable rules/templates and prior events/runs
- **AND** V1 supports explicit/manual checks or report generation without requiring a background scheduler

#### Scenario: Dashboard links to durable pages

- **WHEN** the dashboard displays watchlist, portfolio, alert, or report summary data
- **THEN** relevant rows link to the durable management page for that domain
- **AND** dashboard projection is not the only editing surface

### Requirement: TUI Provides Equivalent Market-State Workflows

OpenCandle's TUI SHALL expose workflows equivalent to the GUI market-state pages through tools, commands, or prompts.

#### Scenario: TUI covers core market-state domains

- **WHEN** a user works only in the TUI
- **THEN** they can list, add, remove, update, and check watchlist and portfolio state where supported by V1
- **AND** they can run manual alert checks and daily reports where supported by V1

#### Scenario: TUI can address a specific portfolio lot

- **WHEN** a portfolio contains multiple lots for the same symbol
- **THEN** the TUI or agent tool can remove or update a single selected lot by lot id
- **AND** symbol-level removal is treated as an explicit bulk action rather than the default row action

#### Scenario: Portfolio update requires a lot id

- **WHEN** the user updates a portfolio lot's quantity, cost, currency, or notes
- **THEN** OpenCandle requires the target `portfolio_lot.id`
- **AND** a symbol-only update does not rewrite every same-symbol lot

#### Scenario: TUI parity is semantic rather than visual

- **WHEN** GUI and TUI flows differ in layout
- **THEN** both surfaces still call the same market-state service
- **AND** tests can verify equivalent persisted rows and compatible response shapes

#### Scenario: TUI exposes deferred capability honestly

- **WHEN** a TUI user asks for minute monitoring, imports, or multiple named collections before those features are implemented
- **THEN** OpenCandle explains that the data model is ready but the workflow is deferred
- **AND** it does not create hidden partial state that the GUI cannot manage

### Requirement: GUI Mutations Remain Session Visible

OpenCandle SHALL record GUI-originated market-state mutations in the active session transcript as structured state-change or synthetic tool-result entries.

#### Scenario: GUI watchlist mutation is visible to the next agent turn

- **WHEN** the GUI adds a symbol to a watchlist
- **THEN** OpenCandle persists the row in SQLite
- **AND** appends a session-visible entry containing the domain, action, instrument id, target id, and source `ui`
- **AND** a subsequent agent turn can see the recent action in session context

#### Scenario: Follower GUI does not silently mutate without transcript visibility

- **WHEN** the GUI is in follower mode and cannot append session-visible entries
- **THEN** mutation controls are disabled, prompt for writer takeover, or route the mutation through a writer-owned append path
- **AND** OpenCandle does not silently persist GUI changes that the active session transcript cannot observe

#### Scenario: TUI mutation remains transcript visible

- **WHEN** a TUI or agent-tool flow mutates market state
- **THEN** the mutation is visible through the normal tool result or structured state-change entry
- **AND** GUI and later chat turns can reconcile the persisted row with the conversation history

#### Scenario: Transcript does not become source of truth

- **WHEN** session entries and SQLite market state disagree
- **THEN** SQLite market state is authoritative for saved watchlists, portfolios, alerts, and report configuration
- **AND** the transcript is treated as conversation and audit context only

### Requirement: Existing Stateful Tracking Route Remains Valid

OpenCandle SHALL preserve the stateful tracking planner behavior while changing the persistence implementation.

#### Scenario: Watchlist update still uses stateful tracking

- **WHEN** a user asks OpenCandle to add, remove, or check a watchlist item
- **THEN** the planner may continue to select the stateful tracking task family
- **AND** the selected tool persists via SQLite-backed market state

#### Scenario: Stateful tracking covers watchlist, portfolio, alert, and report state only

- **WHEN** a user asks OpenCandle to record or check a prediction
- **THEN** the stateful tracking route does not offer a prediction tool
- **AND** OpenCandle explains that prediction tracking is not a supported feature rather than fabricating a tracking result
