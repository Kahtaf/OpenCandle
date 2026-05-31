# Design — `persist-user-market-state`

## 1. Core Direction

OpenCandle should treat user market state as a first-class local domain in `~/.opencandle/state.db`, not as tool-local JSON blobs.

The design keeps the product local-first:

```text
                 ┌─────────────────────────────┐
                 │ ~/.opencandle/state.db       │
                 │                             │
                 │ instruments / aliases        │
                 │ watchlists / items           │
                 │ portfolios / lots            │
                 │ predictions                  │
                 │ alerts / reports             │
                 │ imports / provenance         │
                 └──────────────┬──────────────┘
                                │
                  shared market-state service
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
  TUI / agent tools        GUI API/actions       future heartbeat
  manage_watchlist         same service          due-rule evaluator
  track_portfolio          session-visible       report generator
  track_prediction         state changes
```

The database is the truth. Session entries remain the conversation/audit surface. GUI projection remains useful, but it should no longer be the only source for the user's saved watchlist.

## 2. Storage Boundaries

Existing OpenCandle state boundaries stay intact:

- Pi session/config state remains in `.pi/` and `~/.pi/agent/`.
- OpenCandle user state remains under `~/.opencandle/`.
- Credentials/provider config remains in `config.json` and environment variables.
- User market state moves into `state.db`.

`state.db` already exists for memory/preferences/workflow state. This change should add the market-state schema to that database rather than creating a second market-state database. That keeps backup, test setup, and local state discovery simple.

## 3. Proposed Logical Model

The exact SQL can be refined during implementation, but the model should preserve these entities:

```text
instruments
  id, symbol, asset_type, name, exchange, currency,
  provider, provider_metadata_json, last_resolved_at

instrument_aliases
  id, instrument_id, source, source_symbol, source_exchange,
  source_asset_type, source_id, raw_json
  UNIQUE(source, source_id) when source_id is present, otherwise equivalent
  source-specific uniqueness over symbol/exchange/asset type

watchlists
  id, name, is_default, created_at, updated_at

watchlist_items
  id, watchlist_id, instrument_id,
  thesis, notes, tags_json,
  target_price, stop_price, price_currency,
  source, source_row_id, source_metadata_json,
  created_at, updated_at,
  UNIQUE(watchlist_id, instrument_id)

portfolios
  id, name, base_currency, is_default, created_at, updated_at

portfolio_lots
  id, portfolio_id, instrument_id,
  quantity, avg_cost, currency, opened_at, notes,
  source, source_account_ref, source_lot_id, source_row_id, source_metadata_json,
  created_at, updated_at

prediction_records
  id, instrument_id, direction, conviction,
  entry_price, target_price, opened_at, expires_at,
  status, resolved_at, result_json,
  created_at, updated_at
```

Default watchlist/portfolio rows should be created lazily. The schema should not assume there will only ever be one watchlist or one portfolio.

The implementation should enforce at most one default watchlist and at most one default portfolio, for example with partial unique indexes over `is_default = 1`.

Alias uniqueness must not rely on `(source, source_symbol)` alone. The identity should use a source-native stable id when present, or otherwise include disambiguators such as exchange and asset type. A bare ticker can map to multiple securities across exchanges or asset classes.

Watchlists intentionally hold at most one row per instrument per watchlist in V1. Multiple theses for the same instrument should be represented with notes, thesis text, and tags rather than duplicate rows.

Foreign-key behavior should be explicit:

- deleting a watchlist cascades to its watchlist items;
- deleting a portfolio cascades to its portfolio lots;
- deleting an alert rule cascades to its alert events;
- deleting instruments is restricted while referenced by saved state or alert history.

Closed lots, realized P&L, tax lots, and account history are deferred.

Portfolio summaries should avoid inventing FX conversions in V1. If a lot's quote
currency differs from the lot currency, row-level current value and P&L should be
unavailable or explicitly split by currency until an FX conversion source exists.
If the lot currency matches the quote currency but differs from the portfolio
`base_currency`, OpenCandle can show row-level value/P&L in the lot currency but
must exclude that row from base-currency totals. Summary UI should disclose excluded
mixed-currency rows rather than silently aggregating unlike currencies.

## 4. Search and Add Flow

Adding to a watchlist or portfolio should not require users to know exactly how a provider expects the symbol. The shared service should expose a resolution flow:

```text
user input
  "Apple", "AAPL", "NASDAQ:AAPL", "VTI", "BTC"
      │
      ▼
instrument search / resolve
      │
      ├─ exact symbol hit
      ├─ alias hit from prior imports
      ├─ provider search hit
      └─ ambiguous result requiring choice
      │
      ▼
instrument row + alias row
      │
      ▼
watchlist item or portfolio lot
```

This resolution layer is the right home for imported symbols too. TradingView may use exchange-prefixed symbols; broker exports may use CUSIP/ISIN/conid/internal IDs. Those should map into `instrument_aliases`, not leak across the rest of the data model.

Normal add flows should use provider-backed resolution before mutating state. A user-entered symbol or name should become a saved instrument only after it maps to a selected search result or validated exact symbol. Name searches, ambiguous inputs, misspellings, and provider failures should not silently create unresolved instruments. GUI autocomplete failures should resolve to a controlled empty-candidate/error response so the request completes and the UI can continue accepting input.

The initial resolver can build on the existing Yahoo Finance search endpoint already used by `search_ticker`: `query1.finance.yahoo.com/v1/finance/search`. Search results provide symbol, name, quote type, exchange, and score, which are enough for GUI autocomplete and TUI candidate selection. Exact-symbol validation must preserve provider currency when available and leave currency unknown when it is not available; portfolio add flows must require explicit lot currency rather than defaulting unknown instruments to USD. Exact-symbol validation must also reject Yahoo chart responses that are effectively zero-result payloads, such as a quote with zero price, zero volume, and missing 52-week range. Those responses should not be treated as valid instruments.

## 5. Alerts

Alerting has two separate concerns:

1. Durable rule/event state.
2. A runner that decides when to evaluate rules.

The schema should support both, but V1 does not need to run a background daemon.

```text
alert_rules
  id, scope_type, scope_id, instrument_id,
  condition_type, condition_version, condition_json, timeframe,
  enabled,
  check_interval_seconds, next_check_at, last_checked_at,
  last_observed_json,
  cooldown_seconds, last_triggered_at,
  created_at, updated_at

alert_events
  id, alert_rule_id, instrument_id,
  observed_value_json, triggered_at,
  status, message
```

Condition examples:

- `price_crosses_above`: `{"threshold": 250, "field": "last_price"}`
- `price_crosses_below`: `{"threshold": 180, "field": "last_price"}`
- `percent_move`: `{"direction": "up", "percent": 5, "window": "1d"}`
- `price_crosses_sma`: `{"period": 50, "direction": "above", "price_field": "close"}`
- `sma_cross`: `{"fast_period": 20, "slow_period": 50, "direction": "above"}`
- `rsi_threshold`: `{"period": 14, "threshold": 30, "direction": "below"}`
- `volume_spike`: `{"lookback_period": 20, "multiplier": 2}`

These shapes are examples of the V1 contract, not provider payloads. The evaluator
should version them with `condition_version` and reject unsupported versions rather
than guessing semantics.

V1 alert scopes should use a small vocabulary:

- `instrument`: evaluate one instrument;
- `watchlist`: evaluate the instruments in one watchlist;
- `portfolio`: reserved for portfolio-level rules, not required for V1 evaluation unless implemented.

Creating an instrument-scoped alert should resolve and persist the canonical `instruments` row directly. It must not add the symbol to the default watchlist merely to obtain an `instrument_id`; watchlist membership is a user-visible collection choice, not an alerting prerequisite.

V1 timeframes should be finite and provider-feasible, initially `quote`, `1d`, and common daily-bar windows needed for SMA/RSI conditions.

Indicator alerts should compute locally from quote/OHLCV bars when possible. A provider that returns current quotes and history is enough for many SMA/RSI conditions. Provider-native indicator APIs can be useful, but should not be required by the data model.

Crossing-style alerts require `last_observed_json`; otherwise OC will keep firing every check while the condition remains true. Manual or future heartbeat evaluation should persist a check result transactionally: event creation should be conditional on the stored `last_observed_json` and `last_triggered_at` still matching the observation used to decide the crossing, then update check metadata and the latest observation in the same transaction.

Unavailable, stale, or invalid provider data should still leave a durable check trail. The evaluator should update `last_checked_at` and record an `alert_events.status = "unavailable"` event carrying the reason, while preserving the previous valid `last_observed_json`.

Target and stop prices on watchlist items are V1 display/manual-check metadata. They are not background executable alerts until a V2 rule-authoring flow explicitly creates corresponding `alert_rules`.

## 6. Runner Modes

OpenCandle should support three evaluation modes over time:

```text
V1: explicit/manual
  opencandle alerts check
  opencandle report daily

V2: in-process heartbeat
  GUI/TUI writer process checks due rules while app is running
  only the current writer evaluates to avoid duplicate events

V3: external scheduler
  cron/launchd/systemd/Codex automation invokes a check-due command
  suitable for daily morning reports or user-configured background monitoring
```

The writer/follower model matters. GUI and TUI should not both run the same heartbeat for the same local state. If a process is read-only follower, it can display state and events but should not evaluate due rules.

## 7. Daily Reports

Daily morning reports should be represented as durable templates and runs:

```text
report_templates
  id, name, report_type, cadence, timezone, local_time, config_json,
  enabled, last_run_at, next_run_at,
  created_at, updated_at

report_runs
  id, template_id, started_at, completed_at,
  status, artifact_path, summary_json, errors_json
```

The default morning report should target the default watchlist. The config should allow future expansion to multiple watchlists, portfolios, alert summaries, earnings calendars, and provider-specific news without changing table shape.

At minimum, `config_json` should include explicit report targets. V1 should use `targets.default_watchlist = true` for the morning watchlist report so the report follows the user's current default watchlist. Future reports that target named collections should use fixed `watchlist_ids` or `portfolio_ids`.

Report cadence should be expressed in user-local terms even when V1 only runs reports
manually. Templates should preserve timezone and intended local run time so a later
heartbeat or external scheduler can run "morning report" consistently across daylight
saving time and machine restarts.

## 8. Imports and Provenance

Imports need to be auditable and repeatable even before actual adapters exist:

```text
import_batches
  id, source, source_label, imported_at, status, raw_metadata_json

import_rows
  id, batch_id, row_type, source_symbol,
  normalized_instrument_id, status, error, raw_json
```

Rows imported into watchlists or portfolios should retain `source`, `source_row_id`, and `source_metadata_json`. Broker/account imports should additionally retain a non-secret `source_account_ref` when available.

This supports:

- TradingView watchlist text import/export style.
- Interactive Brokers positions once an adapter exists.
- Broker CSV exports from multiple accounts.
- Manual CSV imports where source columns differ.

The model intentionally does not store broker credentials or account tokens.

Re-import should have a deterministic upsert identity where the source provides stable row identity. For watchlist items and portfolio lots created from imports, `(source, source_row_id)` should map back to the same saved-state row when available; otherwise the importer should fall back to source-specific documented keys.

## 9. Surface Parity

TUI and GUI must call the same service for reads and writes:

```text
                 ┌──────────────┐
                 │ state service │
                 └──────┬───────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
  AgentTool execute()              GUI action endpoint
  manage_watchlist                 add/remove/update item
  track_portfolio                  add/remove/update lot
  track_prediction                 record/check prediction
```

GUI changes should land in the transcript as synthetic tool/state-change entries tagged with source metadata. The transcript is not the truth, but it should explain what changed and allow the next agent turn to see recent user actions.

Normal market-state writes should not require holding the Pi session writer lock. The shared market-state service should use SQLite transactions for atomicity and rely on SQLite write serialization for concurrent TUI/GUI mutations. The session writer/follower lock only governs agent/session append ownership and future background runners that could duplicate work.

## 10. GUI and TUI Information Architecture

The GUI should expose durable market state as first-class navigation, not only as chat cards or dashboard projections. The exact React components and visual details can follow the existing GUI design system, but agents implementing this change need a stable high-level layout target:

```text
GUI app
  ├─ Chat / Dashboard
  ├─ Watchlists
  ├─ Portfolios
  ├─ Alerts
  ├─ Reports
  ├─ Predictions
  └─ Settings / Sources metadata (optional V1; import UI deferred)
```

Page responsibilities:

- **Watchlists:** default watchlist view in V1, symbol search/autocomplete, add/remove/update item, target/stop metadata, notes/thesis/tags, current quote/last checked fields when available.
- **Portfolios:** default portfolio view in V1, add/remove/update lot, quantity/cost/currency fields, current value/P&L summary when quotes are available, provenance/source metadata when present. Row-level remove/update actions should target the selected `portfolio_lot.id`; symbol-level removal is a bulk operation and must be explicit so one same-symbol lot is not accidentally treated as every lot for that instrument.
- **Alerts:** list durable alert rules and events, create/edit manual-checkable price/indicator rules, enable/disable rules, run an explicit check. Background heartbeat controls remain V2+.
- **Reports:** configure the default watchlist morning report, run a report manually, show report-run history and latest summaries.
- **Predictions:** list tracked predictions, record new predictions, check/update outcomes.
- **Sources metadata:** import provenance exists in the data model for future work. V1 does not need an import page or adapter. If the GUI exposes this area, it should be clearly marked as deferred rather than offering a non-functional import flow.

The existing dashboard can summarize these pages, but it should not be the only place to manage them. Dashboard rows should deep-link to the durable page for the underlying watchlist, portfolio, alert, report, or prediction where applicable.

TUI parity does not require identical layout. It should expose equivalent workflows through agent tools, commands, or select/text prompts:

- list/add/remove/update/check watchlist items;
- list/add/remove/update/view portfolio lots;
- list/create/enable/disable/check alerts;
- run/configure daily reports;
- record/check predictions;
- select instrument candidates when resolution is ambiguous.

Both surfaces should use the same service methods and return compatible state shapes so tests can assert parity at the service/API boundary rather than by matching UI markup.

## 11. V1 UX Journey

The V1 user experience should make the durable state features usable without requiring users to think in tables or tools.

First-use empty states should guide the user toward real actions:

- Watchlists: "Add your first ticker" with symbol search/autocomplete.
- Portfolios: "Add a holding" and "Skip for now" so a watchlist-only user is not blocked.
- Alerts: explain that V1 rules are checked manually, then offer "Create alert" and "Run check now."
- Reports: offer "Generate today's watchlist report" and "Configure morning report."
- Predictions: offer "Record prediction."

Watchlist and portfolio pages should be dense working tables with clear status:

- Watchlists should support add/remove/update, notes/thesis/tags, target/stop metadata, current quote when available, data freshness, and a row action to create an alert.
- Portfolios should support add/remove/update lots, quantity/cost/currency, current value and unrealized P&L when quotes are available, allocation summary, and stale/unavailable quote states. If several lots share a symbol, removing one visible row should remove only that lot unless the user chose an explicit remove-all-symbol action.

Alerts must be explicit about delivery expectations. V1 alert rules should be labeled as manually checked unless a future runner is enabled. Alert detail should show condition configuration, last checked time, last observed value, latest event, and data/error status.

Daily reports should have a stable shape rather than being an arbitrary quote dump. V1 morning reports should include generated timestamp, target watchlist, quote freshness, major movers, alert summary, technical snapshot when available, and data gaps.

Quote freshness shown on watchlist and portfolio pages may come from the latest provider response, existing cache metadata, or a small quote-snapshot/read-model table introduced during implementation. It should not be confused with the durable instrument row itself: stale or unavailable quotes must be visible in rows and summaries rather than silently omitted. A regular saved-state poll must not clear a quote/P&L snapshot that was just refreshed; it should remain visible until replaced by a newer quote snapshot or marked stale/unavailable.

Prediction checks should preserve user-authored records when market data is temporarily unavailable. An expired prediction can only be marked `expired` or `resolved` when the check has enough fresh current quote data to evaluate the outcome. Stale cached quotes and zero-filled quote payloads should be treated as data gaps, not as current prices; the check result should report the gap and leave the prediction open for a later retry.

Chat and pages should stay connected as a user-facing invariant:

- "Add Apple to my watchlist" in chat should appear on the Watchlists page.
- Adding Apple on the Watchlists page should be visible to the next chat turn.
- "Show my portfolio" should summarize the same persisted rows shown on the Portfolios page.

GUI page mutations that must append session-visible entries should require the GUI to hold the writer role or route through a writer-owned append path. If the GUI is a follower, mutation controls should be disabled or prompt the user to take over writer role rather than silently writing SQLite without an audit entry.

## 12. Schema Initialization

Initialization should be conservative:

1. Add the new SQLite schema with a new schema version.
2. Create default watchlist/portfolio rows lazily or during initialization.
3. Ensure initialization is idempotent and transactional.
4. Stop reading or writing JSON market-state files.

No JSON migration path is required because OpenCandle has not shipped this market-state feature to users. JSON-backed state should be treated as an implementation detail to remove, not a legacy format to support.

Initialization must be safe under concurrent GUI/TUI startup. Schema creation and default-row creation should use SQLite transactions. It should not depend on the Pi session writer lock, because market-state initialization is local database state rather than session append state.

The SQLite schema reset path must also be updated while this unreleased change is being developed. After V1 ships, schema upgrades for market-state tables should be additive and preserve user-authored rows; destructive reset of market state should require explicit developer/user opt-in.

## 13. Phasing

V1 should be the smallest useful product-shaped change:

- SQLite market state.
- shared service.
- TUI/GUI parity for basic watchlist, portfolio, prediction operations.
- manual daily report and alert-check primitives.
- alert/report schema, with executable background monitoring deferred to V2+.

V2 can add in-process heartbeat and richer alert authoring.

V3 can add external scheduler integration and platform-specific import adapters.
