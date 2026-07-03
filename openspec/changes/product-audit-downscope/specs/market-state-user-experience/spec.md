## MODIFIED Requirements

### Requirement: Daily Report Has A Stable User-Facing Shape

OpenCandle SHALL generate daily reports with a predictable content contract and SHALL present report generation as an on-demand digest until background scheduling and channel delivery exist.

#### Scenario: Watchlist daily report includes expected sections

- **WHEN** OpenCandle generates a V1 watchlist daily report
- **THEN** the report includes generated timestamp, target watchlist, quote freshness, major movers, recent alert summary, and data gaps
- **AND** sections whose builders are not implemented (such as a technical snapshot) are omitted entirely rather than rendered as placeholder text

#### Scenario: No internal scaffolding language reaches users

- **WHEN** a report section cannot be generated
- **THEN** the report either omits the section or states the concrete data gap in user language
- **AND** implementation phrases such as "deferred unless … a later section builder" never appear in report text

#### Scenario: Data gaps are explicit

- **WHEN** quote, indicator, or alert data is unavailable during report generation
- **THEN** the report includes the gap
- **AND** it does not silently omit missing evidence that changes interpretation

#### Scenario: Manual report run is visible after generation

- **WHEN** a user generates a daily watchlist report from the GUI or TUI
- **THEN** the result is shown immediately in that surface
- **AND** the Reports page and later TUI report history can show the saved report run status and summary metadata

#### Scenario: Report surface presents as on-demand digest

- **WHEN** a user views the Reports surface before background scheduling and channel delivery ship
- **THEN** the primary action is generating a digest now, with run history
- **AND** cadence or run-time pickers are not presented as active scheduling controls

### Requirement: Chat And Pages Stay In Sync For Users

OpenCandle SHALL make chat-originated and page-originated market-state actions converge on the same visible state.

#### Scenario: Chat action appears on page

- **WHEN** a user asks chat to add a resolved instrument to a watchlist or portfolio
- **THEN** the durable page for that domain shows the new row from SQLite

#### Scenario: Page action is visible to chat

- **WHEN** a user changes watchlist, portfolio, alert, or report state through the GUI
- **THEN** the change is persisted in SQLite
- **AND** a later chat turn can reference the current saved state
