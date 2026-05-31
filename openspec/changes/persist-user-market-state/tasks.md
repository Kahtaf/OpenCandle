## 1. Spec and Schema Planning

- [ ] 1.1 Confirm the additive SQLite schema version and initialization path for `state.db`, including updates to the schema reset/drop path.
- [ ] 1.2 Define typed domain models for instruments, aliases, watchlists, portfolios/lots, predictions, alerts, reports, and imports.
- [ ] 1.3 Remove JSON-backed market-state ownership; no legacy JSON migration path is required before release.
- [ ] 1.4 Define foreign-key cascade/restrict behavior and one-default uniqueness constraints.
- [ ] 1.5 Define SQLite transaction and busy-timeout behavior for concurrent TUI/GUI market-state writes.
- [ ] 1.6 Add schema-upgrade tests proving additive migrations preserve user-authored market-state rows.

## 2. Durable User Market State

- [ ] 2.1 Add SQLite tables for instruments and instrument aliases.
- [ ] 2.2 Add SQLite tables for watchlists and watchlist items with one lazily-created default watchlist.
- [ ] 2.3 Add SQLite tables for portfolios and portfolio lots with one lazily-created default portfolio.
- [ ] 2.4 Add SQLite tables for prediction records.
- [ ] 2.5 Implement a shared market-state service used outside GUI-specific code.
- [ ] 2.6 Add unit coverage for create/read/update/delete behavior and uniqueness constraints.

## 3. JSON Removal And Initialization

- [ ] 3.1 Remove reads and writes of `watchlist.json`, `portfolio.json`, and `predictions.json`.
- [ ] 3.2 Ensure state initialization creates required SQLite tables and lazily creates default watchlist/portfolio rows.
- [ ] 3.3 Add tests proving JSON files are ignored as state sources.
- [ ] 3.4 Ensure default watchlist/portfolio creation is concurrency-safe and cannot create duplicate defaults.
- [ ] 3.5 Update configuration/runtime-state docs to describe SQLite ownership and JSON-file disposition.

## 4. Search and Resolve

- [ ] 4.1 Define the instrument search/resolve contract for exact symbols, aliases, provider search results, ambiguous matches, misspellings, and provider failures.
- [ ] 4.2 Wire watchlist add and portfolio add flows through instrument resolution.
- [ ] 4.3 Use the existing Yahoo Finance search endpoint/tool behavior as the initial provider-backed resolver.
- [ ] 4.4 Add tests for exchange-prefixed aliases, ambiguous search results, no-result searches, and misspelled ticker-like input such as `APL` for Apple.
- [ ] 4.5 Add tests proving zero-filled Yahoo chart/quote responses are rejected as invalid instruments before insertion.
- [ ] 4.6 Define non-interactive behavior for ambiguous candidate results, returning structured candidates instead of mutating state.

## 5. TUI and GUI Parity

- [ ] 5.1 Move `manage_watchlist` onto the shared market-state service.
- [ ] 5.2 Move `track_portfolio` onto the shared market-state service.
- [ ] 5.3 Move `track_prediction` onto the shared market-state service.
- [ ] 5.4 Add GUI read/action endpoints that call the same service as tools.
- [ ] 5.5 Add persistent GUI navigation entries for Watchlists, Portfolios, Alerts, Reports, and Predictions.
- [ ] 5.6 Add high-level GUI pages for managing default watchlist, default portfolio, alert rules/events, report templates/runs, and prediction records.
- [ ] 5.7 Ensure dashboard rows deep-link to durable pages where applicable.
- [ ] 5.8 Expose equivalent TUI/agent flows for watchlist, portfolio, alerts, reports, predictions, and instrument candidate selection.
- [ ] 5.9 Append session-visible state-change/tool-result entries for GUI-originated mutations.
- [ ] 5.10 Add parity tests proving TUI/tool mutations and GUI mutations produce the same persisted rows.
- [ ] 5.11 Add parity tests for prediction records, not only watchlists and portfolios.
- [ ] 5.12 Define follower-mode GUI mutation behavior: disable, take over writer, or route append through the writer before allowing audited mutations.
- [ ] 5.13 Verify GUI mutations append session-visible entries with domain, action, instrument id, target id, and `source: "ui"`.
- [ ] 5.14 Verify TUI/agent mutations append compatible session-visible entries or tool results for parity.
- [ ] 5.15 Verify open GUI pages refresh or invalidate stale market-state rows after TUI mutations without requiring restart.
- [ ] 5.16 Verify concurrent same-row edits return/refetch the final committed SQLite row and do not leave either surface showing stale saved state.
- [ ] 5.17 Verify deferred workflows requested from TUI, such as imports or minute monitoring, do not create GUI-invisible partial state.

## 6. Alerts and Reports

- [ ] 6.1 Add SQLite tables for alert rules and alert events.
- [ ] 6.2 Add SQLite tables for report templates and report runs.
- [ ] 6.3 Define condition JSON shapes for price, SMA, RSI, and volume-spike rules.
- [ ] 6.4 Define V1 alert scope and timeframe vocabularies.
- [ ] 6.5 Include condition versioning for alert rules.
- [ ] 6.6 Implement explicit/manual alert evaluation against current quote/history providers for V1.
- [ ] 6.7 Implement explicit/manual daily watchlist report generation for V1 using `targets.default_watchlist = true`, timezone, and intended local run time.
- [ ] 6.8 Defer background heartbeat execution to V2 or separately gate it.
- [ ] 6.9 Add tests for invalid/stale/zero-filled provider data during alert evaluation.
- [ ] 6.10 Add tests for cooldown suppression and duplicate manual-check suppression.
- [ ] 6.11 Verify minute-cadence metadata is not presented as active monitoring unless a runner is enabled.
- [ ] 6.12 Verify alert creation UX captures scope, timeframe, condition, cooldown, and manual-check status for price/SMA/RSI-style rules.
- [ ] 6.13 Add tests for canonical V1 condition JSON shapes and unsupported condition-version rejection.
- [ ] 6.14 Add tests that report templates preserve timezone/local-time metadata for future scheduled execution.

## 7. Imports and Provenance

- [ ] 7.1 Add SQLite tables for import batches and import rows.
- [ ] 7.2 Add source/provenance fields to watchlist items and portfolio lots.
- [ ] 7.3 Define instrument alias identity using source-native stable ids or exchange/asset-type disambiguators, not source symbol alone.
- [ ] 7.4 Add tests showing TradingView-style symbols and broker/account rows can be represented without implementing adapters.
- [ ] 7.5 Define schema/index readiness for future source-row upserts without implementing importer behavior.
- [ ] 7.6 Keep import adapters and import reconciliation UI deferred to the future roadmap.

## 8. User Experience

- [ ] 8.1 Add empty states for Watchlists, Portfolios, Alerts, Reports, and Predictions with primary next actions.
- [ ] 8.2 Implement watchlist working-table behavior: add/remove/update, notes/thesis/tags, target/stop metadata, current quote/freshness when available, and create-alert affordance.
- [ ] 8.3 Implement portfolio working-table behavior: add/remove/update lots, quantity/cost/currency, current value/P&L when quotes are available, allocation summary, and stale/unavailable quote states.
- [ ] 8.4 Label V1 alert rules as manually checked and show last checked, last observed value, latest event, and data/error status.
- [ ] 8.5 Define the V1 daily report content contract: generated timestamp, target watchlist, quote freshness, major movers, alert summary, technical snapshot when available, and data gaps.
- [ ] 8.6 Verify chat-created actions appear on durable pages and page-created actions are visible to later chat turns.
- [ ] 8.7 Define where quote freshness comes from for watchlist and portfolio pages, and ensure stale/unavailable rows are visible.
- [ ] 8.8 Label watchlist target/stop fields as metadata unless an explicit alert rule exists.
- [ ] 8.9 Ensure manual report generation shows the result immediately and stores a report-run history row visible from GUI and TUI.
- [ ] 8.10 Keep V1 collection management scoped to default watchlist/portfolio unless create/rename/switch/copy/move flows are implemented with GUI/TUI parity.
- [ ] 8.11 Verify mixed-currency portfolio rows are disclosed and excluded from base-currency totals unless FX conversion is explicitly available.

## 9. Verification

- [ ] 9.1 Run `npm test`.
- [ ] 9.2 Run the TUI locally and add/check at least one watchlist item, portfolio lot, and prediction record.
- [ ] 9.3 Run `npm run gui` locally and exercise the same mutation types from the GUI.
- [ ] 9.4 Verify a TUI-created row appears in GUI from SQLite without requiring a quote-derived session projection.
- [ ] 9.5 Verify a GUI-created row appears in TUI/tool reads from the same `state.db`.
- [ ] 9.6 Verify GUI-originated mutations produce session-visible state-change/tool-result entries with `source: "ui"`.
