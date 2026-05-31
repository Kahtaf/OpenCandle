## Why

OpenCandle currently has stateful portfolio, watchlist, and prediction tools implemented against separate JSON files under `~/.opencandle/`. Because this code has not shipped to users yet, there is no legacy migration requirement; the implementation should replace those files with SQLite-backed state before release.

1. **TUI and GUI need one source of truth.** The local GUI already projects session activity, while the TUI and agent tools mutate JSON files directly. A user-visible watchlist or portfolio should not differ depending on which surface last touched it.
2. **Alerts and morning reports need queryable state.** Heartbeat-style checks need to find due rules, evaluate quote/indicator conditions, record trigger history, and avoid repeated notifications. Flat files make that awkward and fragile.
3. **Imports need provenance.** TradingView, Interactive Brokers, broker CSVs, and future provider syncs all need alias mapping, row-level import status, and source metadata so imported symbols and lots can be audited or re-imported safely.
4. **Predictions should follow the same model.** Predictions are part of the same durable market state domain, not a special file.

This change makes SQLite `state.db` the durable home for OpenCandle user market state while preserving the existing local-first model and leaving provider APIs, router policies, and financial analysis behavior intact.

## What Changes

- Add a durable SQLite-backed user market state domain for instruments, watchlists, portfolios, positions/lots, and prediction records.
- Remove JSON-backed market-state ownership before release; `watchlist.json`, `portfolio.json`, and `predictions.json` are not supported state sources.
- Keep a default watchlist and default portfolio, while designing IDs and constraints so multiple watchlists/portfolios can be added later without schema replacement.
- Route all state mutations through shared services used by both TUI tools and GUI endpoints.
- Add search/resolve primitives for adding instruments to watchlists and portfolios without requiring the user to know the provider-specific symbol form.
- Add an alert/report data model that supports V1 manual checks and morning reports, and V2+ heartbeat/background evaluation.
- Add import provenance tables that can represent TradingView-style watchlist imports, broker portfolio imports, and later account sync without implementing import adapters in this change.

## Capabilities

### New Capabilities

- **`user-market-state`**: SQLite-backed instruments, aliases, watchlists, portfolios, positions/lots, and prediction records under `~/.opencandle/state.db`.
- **`stateful-market-surfaces`**: TUI and GUI parity rules for reading and mutating user market state through one shared path.
- **`market-state-user-experience`**: user journeys, empty states, page behavior, status language, and chat/page synchronization for the new durable market-state features.
- **`market-alerts-and-reports`**: Durable alert-rule, alert-event, report-template, and report-run model for manual checks, future heartbeat evaluation, and daily morning reports.
- **`market-state-imports`**: Import batch, import row, and source alias/provenance model for future TradingView, Interactive Brokers, and broker CSV imports. Import adapters and import UI are deferred.

### Related Existing Capabilities

- **`agent-planning-layer`**: Stateful tracking turns continue to use the existing `stateful_tracking_update` task family. This change does not require a planner behavior change; it changes the persistence owner underneath the selected tools.
- **`local-gui` / `pi-synced-gui`**: GUI dashboard watchlist/portfolio state should read durable user market state where applicable, not only quote-derived session projection state.

## Impact

- **Storage:** `~/.opencandle/state.db` gains new tables for durable market state. Existing memory/workflow tables remain in the same database.
- **Storage initialization:** Startup initializes the SQLite market-state schema and default rows as needed. No JSON migration path is required for unreleased state.
- **Tools:** `manage_watchlist`, `track_portfolio`, and `track_prediction` keep their user-facing purpose but read/write the SQLite-backed service.
- **GUI:** watchlist and portfolio views read from the same service as tools. GUI mutations append session-visible state-change/tool-result entries so the TUI/agent transcript remains coherent.
- **Alerts:** V1 stores alert/report configuration and supports explicit/manual checks and reports. Continuous background monitoring is designed for V2+ and must be separately gated.
- **Imports:** Import tables and provenance fields are included now so future imports fit the data model; actual platform-specific import adapters and reconciliation UI are deferred.

## Non-Goals

- No broker trading, order placement, or executable target/stop behavior in V1.
- No hosted multi-user mode.
- No account credential storage or automatic Interactive Brokers sync in this change.
- No import adapters or import reconciliation UI in V1.
- No hard dependency on a new market data provider for alerts. Indicator alerts should compute from available quote/OHLCV providers where feasible.
- No guarantee of broker-grade real-time monitoring. Minute-level alerts are best-effort local monitoring.
