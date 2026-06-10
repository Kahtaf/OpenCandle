## ADDED Requirements

### Requirement: Market-State Pages Provide Actionable Empty States

OpenCandle SHALL guide new users through the first useful action for each durable market-state page.

#### Scenario: Empty watchlist invites first ticker

- **WHEN** the default watchlist has no items
- **THEN** the Watchlists page shows an empty state with an Add Ticker action
- **AND** the add flow uses provider-backed instrument resolution before saving

#### Scenario: Empty portfolio does not block watchlist-only use

- **WHEN** the default portfolio has no lots
- **THEN** the Portfolios page offers Add Holding and Skip For Now actions
- **AND** the rest of the app remains usable without a portfolio

#### Scenario: Empty alerts clarify manual checking

- **WHEN** no alert rules exist
- **THEN** the Alerts page explains that V1 alerts are checked manually
- **AND** it offers Create Alert and Run Check Now actions

#### Scenario: Empty reports explain the default report

- **WHEN** no report template exists
- **THEN** the Reports page offers Generate Today's Watchlist Report and Configure Morning Report actions

### Requirement: Watchlist Page Behaves Like A Working List

OpenCandle SHALL make saved watchlists usable as a daily working surface.

#### Scenario: Watchlist row shows useful trading context

- **WHEN** a watchlist item has quote data available
- **THEN** the row shows symbol, display name when available, latest quote/change, quote freshness, target/stop metadata, notes/thesis/tags, and alert status when available

#### Scenario: Alert status on watchlist row is explicit

- **WHEN** a watchlist row has related alert rules
- **THEN** the row distinguishes never checked, manually checked, triggered, paused, stale, and unavailable states where applicable
- **AND** it does not imply continuous monitoring for V1 manual-only alerts

#### Scenario: Watchlist supports row-level actions

- **WHEN** a user works with a watchlist row
- **THEN** they can edit notes/thesis/tags and target/stop metadata
- **AND** they can remove the row, refresh quote data, and start creating an alert for that instrument

#### Scenario: Target and stop fields do not imply automation

- **WHEN** a watchlist row has target or stop metadata but no corresponding alert rule
- **THEN** the GUI and TUI present those fields as watchlist context or manual-check inputs
- **AND** they do not imply that OpenCandle is continuously monitoring those levels

#### Scenario: Row alert shortcut requires a target

- **WHEN** a watchlist row has no target price
- **THEN** the GUI row action does not create a price alert with an implicit zero threshold
- **AND** the user must enter or save an explicit threshold before an alert rule is persisted

#### Scenario: Watchlist prevents accidental invalid symbols

- **WHEN** a user enters misspelled or ambiguous input
- **THEN** the Watchlists page requires selecting a resolved candidate
- **AND** it does not save the raw unresolved input

### Requirement: Portfolio Page Shows Portfolio-Level Meaning

OpenCandle SHALL make saved portfolios useful beyond raw lot entry.

#### Scenario: Portfolio row shows holding context

- **WHEN** a portfolio lot has quote data available
- **THEN** the row shows symbol, quantity, average cost, lot currency, current value, unrealized P&L, and quote freshness

#### Scenario: Portfolio summary aggregates holdings

- **WHEN** the portfolio has one or more lots
- **THEN** the page shows total value when quotes are available
- **AND** it shows allocation by holding or equivalent summary context

#### Scenario: Mixed-currency portfolio rows are not silently aggregated

- **WHEN** a portfolio contains lots whose lot currency or quote currency differs from the portfolio base currency
- **THEN** OpenCandle shows row-level currency context for those holdings
- **AND** it excludes unsupported mixed-currency rows from base-currency totals unless an explicit FX conversion source is available
- **AND** the portfolio summary discloses which rows were excluded or need FX support

#### Scenario: Quote currency mismatch does not fabricate row P&L

- **WHEN** a portfolio lot's quote currency differs from the lot currency and no FX conversion source is available
- **THEN** OpenCandle does not calculate row-level value or P&L by subtracting unlike currencies
- **AND** the row shows the data gap or FX requirement instead of a fabricated same-currency result

#### Scenario: Missing quote data is visible

- **WHEN** current quote data is unavailable or stale for a holding
- **THEN** the page marks that row as stale or unavailable
- **AND** summary calculations disclose excluded or stale rows

### Requirement: Alerts Explain Monitoring Semantics

OpenCandle SHALL make it clear whether an alert is manually checked, checked while OC is open, or scheduled externally.

#### Scenario: V1 alert is labeled manual

- **WHEN** a user views a V1 alert rule
- **THEN** the UI labels it as manually checked
- **AND** it does not imply that OpenCandle is continuously watching the market

#### Scenario: Alert detail explains current status

- **WHEN** a user opens an alert rule
- **THEN** the UI shows condition configuration, enabled status, last checked time, last observed value, latest event, and data/error status when available

#### Scenario: Alert creation previews evaluation needs

- **WHEN** a user creates a price, SMA, RSI, volume, or other supported V1 alert
- **THEN** the GUI form and TUI prompt show the instrument or watchlist scope, timeframe, condition, cooldown, and whether the rule is manually checked
- **AND** saving the rule requires enough provider-backed data requirements to evaluate it later

#### Scenario: Minute monitoring is not offered as active V1 behavior

- **WHEN** a user looks for every-minute or continuous alert monitoring in V1
- **THEN** the GUI and TUI do not present it as an active capability unless a runner has been implemented and enabled
- **AND** they may explain that minute monitoring is deferred while still allowing manual alert checks

### Requirement: Daily Report Has A Stable User-Facing Shape

OpenCandle SHALL generate daily reports with a predictable content contract.

#### Scenario: Watchlist daily report includes expected sections

- **WHEN** OpenCandle generates a V1 watchlist daily report
- **THEN** the report includes generated timestamp, target watchlist, quote freshness, major movers, recent alert summary, technical snapshot when available, and data gaps

#### Scenario: Data gaps are explicit

- **WHEN** quote, indicator, or alert data is unavailable during report generation
- **THEN** the report includes the gap
- **AND** it does not silently omit missing evidence that changes interpretation

#### Scenario: Manual report run is visible after generation

- **WHEN** a user generates a daily watchlist report from the GUI or TUI
- **THEN** the result is shown immediately in that surface
- **AND** the Reports page and later TUI report history can show the saved report run status and summary metadata

### Requirement: Chat And Pages Stay In Sync For Users

OpenCandle SHALL make chat-originated and page-originated market-state actions converge on the same visible state.

#### Scenario: Chat action appears on page

- **WHEN** a user asks chat to add a resolved instrument to a watchlist or portfolio
- **THEN** the durable page for that domain shows the new row from SQLite

#### Scenario: Page action is visible to chat

- **WHEN** a user changes watchlist, portfolio, alert, report, or prediction state through the GUI
- **THEN** the change is persisted in SQLite
- **AND** a later chat turn can reference the current saved state

### Requirement: Import UX Is Deferred

OpenCandle SHALL preserve import-ready data modeling while deferring end-user import workflows.

#### Scenario: No V1 import workflow is promised

- **WHEN** a user looks for import functionality in V1
- **THEN** OpenCandle does not present a broken or partial importer
- **AND** any visible import/source affordance clearly marks import adapters as future work

### Requirement: Multiple Collection UX Is Deferred In V1

OpenCandle SHALL keep the V1 user experience focused on the default watchlist and default portfolio while preserving schema readiness for multiple collections.

#### Scenario: V1 does not expose incomplete collection management

- **WHEN** a user works in the Watchlists or Portfolios page in V1
- **THEN** OpenCandle presents the default collection as the editable collection
- **AND** it does not show create, rename, switch-default, copy, or move collection controls unless those flows are implemented across both GUI and TUI

#### Scenario: Future collection references remain understandable

- **WHEN** import provenance, report templates, or alerts contain collection ids created by future multi-collection support
- **THEN** the UI can display the referenced collection label when available
- **AND** it does not collapse all future collection-specific state into the current default collection
