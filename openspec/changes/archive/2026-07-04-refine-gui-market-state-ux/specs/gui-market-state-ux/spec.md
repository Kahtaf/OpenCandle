## ADDED Requirements

### Requirement: Market-State UX Overhaul Preserves Existing Runtime Contracts

OpenCandle SHALL implement this market-state UX overhaul without changing non-UI runtime contracts.

#### Scenario: Persistence and provider behavior stay unchanged

- **WHEN** the UI overhaul is implemented
- **THEN** it does not add or alter SQLite schema, migrations, provider APIs, instrument resolution semantics, import adapters, or broker/platform sync behavior
- **AND** it reads and mutates market state only through existing GUI/server/tool paths available to the current market-state features

#### Scenario: Alert and report semantics stay unchanged

- **WHEN** Alerts or Reports pages are redesigned
- **THEN** the redesign does not introduce new alert lifecycle semantics, runner semantics, notification semantics, report cadences, hosted scheduling, or report persistence behavior
- **AND** any new alert/report behavior requires a separate non-UI OpenSpec change

#### Scenario: TUI and docs changes are out of scope

- **WHEN** this UI overhaul is implemented
- **THEN** it does not change TUI behavior, TUI command names, docs/static-site design system, docs build output, or GitHub Pages behavior
- **AND** docs/app design-system unification remains deferred

### Requirement: OpenCandle Owns The GUI Component System

OpenCandle SHALL use its local GUI primitives and design tokens as the implementation source of truth for the market-state UI overhaul.

#### Scenario: Efferd is used as reference only

- **WHEN** an implementer uses Efferd app-shell or dashboard blocks for inspiration
- **THEN** they translate the pattern into OpenCandle-owned components and tokens
- **AND** they do not add Efferd registry files, shadcn registry configuration, or Efferd runtime dependencies solely for this UI overhaul

#### Scenario: llmchat guides product shape without becoming a dependency

- **WHEN** an implementer works on the Today/chat surface or shared shell
- **THEN** they use llmchat as interaction and layout inspiration
- **AND** they do not copy llmchat source files or persistence/runtime assumptions into OpenCandle

### Requirement: GUI Shell Stays Consistent Across Chat And Market-State Pages

OpenCandle SHALL present chat and market-state pages inside one coherent local app shell.

#### Scenario: Market-state pages use shared navigation

- **WHEN** a user opens Watchlists, Portfolios, Alerts, Reports, or Predictions
- **THEN** the shared navigation/session shell remains available
- **AND** the page does not require separate top tabs to move between those market-state routes

#### Scenario: Desktop shell supports context without hiding the primary task

- **WHEN** a desktop user views a market-state page
- **THEN** the primary saved-state surface remains central
- **AND** optional context, row details, or evidence can appear in a right-side panel without replacing the main page

#### Scenario: Mobile shell keeps navigation accessible

- **WHEN** a mobile user views any market-state page
- **THEN** app navigation remains reachable from the top app bar or drawer
- **AND** the page chrome does not create horizontal overflow

### Requirement: Today Remains Chat-First

OpenCandle SHALL keep the Today page as the primary chat/research surface rather than a broker-style dashboard.

#### Scenario: Market state appears as chat context

- **WHEN** a user asks for a morning report, alert explanation, or portfolio-aware market question from Today
- **THEN** watchlist, portfolio, alert, and report state can appear as source cards, context cards, or evidence trace entries
- **AND** CRUD-heavy management controls remain on dedicated market-state pages

#### Scenario: Today uses llmchat-inspired layout

- **WHEN** the Today page is rendered on desktop
- **THEN** it uses a left navigation/session rail, central answer or report canvas, visible composer, and optional right-side market context/evidence trace
- **AND** saved-state summaries appear as answer context, source cards, or evidence trace entries rather than standalone KPI tiles above the conversation

### Requirement: Market-State Pages Use A State-First Management Template

OpenCandle SHALL prioritize saved state and page context before creation forms on market-state pages.

#### Scenario: Page header is consistent

- **WHEN** a user opens a market-state page
- **THEN** the page header shows the title, one concise subtitle or state summary, last refresh or stale status when available, and one primary action
- **AND** secondary actions are grouped in a compact toolbar or menu

#### Scenario: Saved state precedes creation forms

- **WHEN** a user opens Watchlists, Portfolios, Alerts, Reports, or Predictions
- **THEN** the main saved-state table, list, or empty state is visible without scrolling past permanent add/update forms
- **AND** create/update controls open from explicit actions

#### Scenario: Refresh prices is explicit

- **WHEN** a market-state page exposes quote refresh
- **THEN** the UI labels the action as `Refresh prices` or equivalent explicit copy
- **AND** it does not use ambiguous labels such as `Quotes`

#### Scenario: Search and filters operate on visible state

- **WHEN** a market-state page exposes search or filter controls
- **THEN** those controls are positioned with the toolbar for the saved-state surface they affect
- **AND** they filter or search the currently visible table, list, or row-card surface

### Requirement: Create And Edit Flows Are Contextual

OpenCandle SHALL move market-state create and edit work into contextual surfaces that preserve the user's place.

#### Scenario: Desktop create flow uses a contextual surface

- **WHEN** a desktop user selects Add ticker, Add holding, Create alert, Configure report, or Record thesis
- **THEN** OpenCandle opens a sheet, drawer, inline detail panel, or focused editor
- **AND** the current saved-state list remains understandable in the background or adjacent surface

#### Scenario: Mobile create flow uses a mobile-appropriate surface

- **WHEN** a mobile user starts a create or edit flow
- **THEN** OpenCandle opens a bottom sheet, full-height drawer, or route-level editor with clear close/back behavior
- **AND** focus moves into the new surface and returns after closing

#### Scenario: Ticker input remains provider-backed

- **WHEN** a create or edit flow asks for a ticker or instrument
- **THEN** the first field uses provider-backed search/autocomplete
- **AND** unresolved raw input is not saved as a valid instrument

#### Scenario: Follower mode keeps state readable

- **WHEN** the GUI is in follower or read-only mode
- **THEN** saved market-state tables, lists, summaries, and detail panels remain readable
- **AND** create, edit, delete, refresh-mutation, and acknowledgement actions are disabled or hidden with text explaining the read-only state
- **AND** the disabled state is not communicated by color alone

### Requirement: Watchlists Page Behaves Like A Working List

OpenCandle SHALL make the Watchlists page read as a saved ticker workspace.

#### Scenario: Watchlist toolbar supports common work

- **WHEN** a user views the Watchlists page
- **THEN** they can search/filter saved symbols, add a ticker, and refresh prices from the page toolbar

#### Scenario: Watchlist row opens details

- **WHEN** a user selects a watchlist row
- **THEN** they can inspect or edit thesis, notes, tags, target/stop metadata, quote freshness, and linked alert status in a detail surface

#### Scenario: Empty watchlist teaches the first action

- **WHEN** the default watchlist has no items
- **THEN** the empty state explains the page purpose
- **AND** it exposes Add ticker as the primary next action

### Requirement: Portfolios Page Shows Portfolio Meaning First

OpenCandle SHALL make the Portfolios page lead with portfolio-level context before lot editing.

#### Scenario: Portfolio summary appears before holdings

- **WHEN** a portfolio has holdings
- **THEN** the page shows summary context such as total value, P&L, allocation coverage, and stale quote count before the holdings surface

#### Scenario: Holdings table is primary

- **WHEN** a user views the Portfolios page
- **THEN** the holdings table or mobile row list is the primary surface
- **AND** Add holding and Update holding are contextual actions, not permanent stacked forms

#### Scenario: Empty portfolio remains non-blocking

- **WHEN** the portfolio has no holdings
- **THEN** the page offers Add holding as the primary action
- **AND** it makes clear the rest of OpenCandle remains usable with only watchlists

### Requirement: Alerts Page Separates Rules From Monitoring History

OpenCandle SHALL make alert authoring, monitoring state, events, check runs, and notifications visually distinct.

#### Scenario: Alerts page summarizes monitoring state

- **WHEN** a user opens Alerts
- **THEN** the page shows the current monitoring mode, runner/owner status when available, last check status, and notification count or status

#### Scenario: Alert rule builder previews semantics

- **WHEN** a user creates an alert
- **THEN** the rule builder shows instrument or scope, condition family, condition fields, existing cooldown field where supported, and read-only evaluation-mode summary
- **AND** it previews a plain-English rule summary before saving
- **AND** it does not introduce new repeat modes, re-arm behavior, runner behavior, or alert lifecycle semantics

#### Scenario: Alert history is not confused with rule configuration

- **WHEN** alert events, check runs, or notifications exist
- **THEN** they are shown in sections distinct from active rule configuration

#### Scenario: Empty alerts teach the first action

- **WHEN** no alert rules exist
- **THEN** the Alerts page explains what alert rules do and which monitoring mode is currently available
- **AND** it exposes Create alert as the primary next action

### Requirement: Reports Page Manages Scheduled Outputs

OpenCandle SHALL present Reports as report-output and schedule management rather than a raw tool panel.

#### Scenario: Reports use existing state and actions

- **WHEN** Reports is redesigned
- **THEN** it re-presents existing report templates, report runs, report notifications, and `daily_watchlist_report` run/configure/history behavior
- **AND** it does not add new cadences, hosted scheduling, report artifact persistence, import behavior, or notification semantics

#### Scenario: Reports page highlights next and last report

- **WHEN** a user opens Reports
- **THEN** the page shows next scheduled report information when configured
- **AND** it shows last report/run status when available

#### Scenario: Generate today is primary

- **WHEN** a user views the default morning report controls
- **THEN** Generate today is the primary action
- **AND** schedule configuration is a secondary action

#### Scenario: Report run history exposes readable output

- **WHEN** a report run exists
- **THEN** the user can reach a human-readable report summary or artifact from the run history

#### Scenario: Empty reports teach the first action

- **WHEN** no report template or report run exists
- **THEN** the Reports page explains the morning report purpose
- **AND** it exposes Generate today as the primary next action
- **AND** schedule configuration remains secondary

### Requirement: Predictions UI Is Framed As Thesis Tracking

OpenCandle SHALL frame prediction records as a thesis-tracking workflow in the GUI.

#### Scenario: UI label clarifies purpose

- **WHEN** a user opens the predictions route
- **THEN** the page title, empty state, and primary action use `Thesis Tracker` or thesis-tracking language
- **AND** the `/predictions` route, tool names, stored record names, prompt terminology, and report terminology remain unchanged in this UI-only change

#### Scenario: Thesis tracker shows open and resolved states

- **WHEN** thesis records exist
- **THEN** the page distinguishes open, due-soon, resolved, and cancelled records where available
- **AND** selected rows can expose thesis details and linked market-state context

#### Scenario: Empty thesis tracker teaches the first action

- **WHEN** no thesis records exist
- **THEN** the Thesis Tracker page explains that theses are saved research expectations to revisit later
- **AND** it exposes Record thesis as the primary next action

### Requirement: Product Motion Is Restrained And Purposeful

OpenCandle SHALL use motion only to clarify state changes in the GUI.

#### Scenario: Context surfaces reveal with restrained motion

- **WHEN** a sheet, drawer, panel, or menu opens
- **THEN** the transition may use a transitions.dev-inspired panel reveal, menu dropdown, or modal open/close pattern
- **AND** the transition SHOULD complete in roughly 150-250 ms unless a platform primitive requires a different duration

#### Scenario: Validation motion is limited to user errors

- **WHEN** a user submits an invalid create/edit form
- **THEN** the UI may use a restrained error-state shake on the invalid control
- **AND** the error is also communicated with text

#### Scenario: Reduced motion is respected

- **WHEN** the user has requested reduced motion
- **THEN** OpenCandle disables or shortens non-essential transitions
- **AND** no financial, alert, or report state depends on animation alone

### Requirement: Browser Verification Covers Affected Pages

OpenCandle SHALL verify the UI overhaul in the real local GUI.

#### Scenario: Desktop browser pass covers all affected routes

- **WHEN** the UI overhaul is implemented
- **THEN** `/`, `/watchlists`, `/portfolios`, `/alerts`, `/reports`, and `/predictions` are opened in a desktop browser viewport of at least 1440x960
- **AND** screenshots are captured to a temporary path for review

#### Scenario: Mobile browser pass covers all affected routes

- **WHEN** the UI overhaul is implemented
- **THEN** `/`, `/watchlists`, `/portfolios`, `/alerts`, `/reports`, and `/predictions` are opened in a mobile browser viewport of 390x844 and, when feasible, a narrow 320px-width viewport
- **AND** navigation, primary actions, and page chrome remain usable without horizontal overflow

#### Scenario: Browser pass checks accessible interactions

- **WHEN** create/edit surfaces, menus, drawers, or dialogs are present
- **THEN** the browser pass verifies they open, close, and manage keyboard focus coherently

#### Scenario: Browser pass checks follower mode

- **WHEN** the UI overhaul is implemented
- **THEN** the browser pass verifies follower or read-only mode on Watchlists and Alerts
- **AND** saved state remains readable, mutation actions cannot fire, and explanatory text is visible without relying on color alone

### Requirement: UI React Changes Maintain React Doctor Quality

OpenCandle SHALL use React Doctor as a quality gate for GUI React changes.

#### Scenario: Autoreview includes React Doctor evidence

- **WHEN** an autoreview target includes changed React source files under `gui/web/src`
- **THEN** autoreview runs React Doctor against the changed GUI React files
- **AND** it includes the React Doctor summary and top diagnostics in the review bundle

#### Scenario: React Doctor errors block UI merge

- **WHEN** React Doctor reports error-severity diagnostics for changed GUI React files
- **THEN** the UI change is not considered merge-ready
- **AND** the diagnostics are fixed or explicitly removed from the changed-file scope before merge

#### Scenario: React Doctor warnings are handled deliberately

- **WHEN** React Doctor reports warning-severity diagnostics for changed GUI React files
- **THEN** implementation review treats state/effects, accessibility, security, and performance warnings as actionable by default
- **AND** any deferred warnings are documented as pre-existing, low-value, or out of scope

#### Scenario: GUI score stays high

- **WHEN** a larger UI overhaul or release-prep review runs a full React Doctor GUI scan
- **THEN** OpenCandle compares the result to a full-GUI React Doctor baseline captured from `main` or from the start of the UI-overhaul branch
- **AND** the resulting score is greater than or equal to the captured baseline unless the user explicitly approves an exception outside this spec
