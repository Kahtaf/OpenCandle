## ADDED Requirements

### Requirement: Provider market time survives the mapping boundary

Providers that expose a market/as-of time for their data SHALL preserve it on the typed result as `asOf` (ISO 8601). Specifically: Yahoo quote mapping SHALL read `meta.regularMarketTime` (epoch seconds), Alpha Vantage GLOBAL_QUOTE mapping SHALL read `"07. latest trading day"` (date-only), and CoinGecko detail mapping SHALL read `market_data.last_updated`. The existing `timestamp` field keeps its current fetch-wall-clock meaning and MUST NOT be repurposed.

#### Scenario: Yahoo weekend quote carries its market time

- **WHEN** a Yahoo quote response's `meta.regularMarketTime` corresponds to Friday 2024-03-22 16:00 ET and the fetch happens on Saturday 2024-03-23
- **THEN** the mapped `StockQuote.asOf` is the ISO 8601 instant for Friday's market time
- **AND** `StockQuote.timestamp` remains the fetch wall-clock

#### Scenario: Provider without market time omits asOf

- **WHEN** a TradingView scanner result is mapped (its response carries no timestamp field)
- **THEN** `asOf` is absent rather than fabricated
- **AND** the known 15-minute delay is carried as `dataDelayMs` on the freshness stamp instead

### Requirement: A single freshness stamp implementation

The system SHALL provide one `FreshnessStamp` type and one `buildFreshnessStamp()` implementation in `src/infra/freshness.ts` carrying: `fetchedAt`, optional `providerDataAt`, `cacheStatus` (`live | cached | stale`), optional `cachedAt`, `marketSession` (from the shared market calendar), optional `dataDelayMs`, and `isStaleForSession`. For equity data, `isStaleForSession` SHALL be true exactly when `providerDataAt`'s trading date precedes the most recent completed trading day; for crypto, when the data is older than 15 minutes. Tools MUST NOT implement their own staleness wording.

#### Scenario: Weekend fetch of a Friday quote is not session-stale

- **WHEN** `buildFreshnessStamp` runs on a Saturday for an equity quote whose `asOf` is the prior Friday
- **THEN** `isStaleForSession` is false (Friday is the most recent completed trading day)
- **AND** `marketSession` is `closed_weekend`

#### Scenario: Thursday-dated quote fetched on Saturday is session-stale

- **WHEN** `buildFreshnessStamp` runs on a Saturday for an equity quote whose `asOf` is the prior Thursday
- **THEN** `isStaleForSession` is true

#### Scenario: Stale-cache result is stamped from cache metadata

- **WHEN** a provider served a stale cached value after a fetch failure (`stale: true`, `cachedAt` known)
- **THEN** the stamp's `cacheStatus` is `stale` and `cachedAt` is populated
- **AND** with no `providerDataAt`, `isStaleForSession` falls back to true

### Requirement: Quote-family tools disclose freshness in one deterministic line

`get_stock_quote`, the crypto price tool, the option-chain tool, and `screen_stocks` SHALL append `formatAsOfLine(stamp)` as the final line of their text output and replace any pre-existing bespoke staleness wording with it. All except `screen_stocks` attach the stamp as `details.freshness` (`screen_stocks`'s `details` is the bare rows array today and stays that shape; its disclosure is text-only). The option-chain path requires `OptionsChain.asOf` mapped from the underlying Yahoo quote's `regularMarketTime` in both fetch paths. Data whose stamp has `isStaleForSession: true` SHALL be presented with "last available … as of <date>" wording and an explicit "not a live quote" statement, never as a current price; as-of dates render in ET. A zero-filled quote payload remains an unavailable result (existing behavior) and is never stamped as a price.

#### Scenario: Weekend stale quote is disclosed (E3 promotion)

- **WHEN** `get_stock_quote` returns a quote from the `tests/fixtures/yahoo/weekend-stale-quote.json` fixture enriched with `meta.regularMarketTime` for Friday 2024-03-22 16:00 ET
- **THEN** the tool text matches `/stale|weekend|last available|as of/i` and includes `2024-03-22`
- **AND** the tool text does not contain `$0.00`
- **AND** the previously skipped E3 assertion in `tests/unit/evals/provider-outage-deterministic.test.ts` runs as a gating test with its date literal updated to the provider's market date (a strengthening — the fixture previously carried no date, so the old `2024-03-23` literal encoded the fetch day)

#### Scenario: Crypto price gains parity disclosure

- **WHEN** the crypto price tool serves a stale-cache result
- **THEN** its text discloses the cached-data line (today it discloses nothing)

#### Scenario: Live quote gets a plain as-of line

- **WHEN** `get_stock_quote` returns a live quote during market hours
- **THEN** the text's final line is the as-of line with the market-open session label
- **AND** the bespoke stale prefix previously built inside `stock-quote.ts` no longer exists

### Requirement: Shared market calendar module

The market-status logic currently inside `src/runtime/planning-evidence.ts` (`classifyMarketStatus`, `lastTradingDay`, `isWeekendOrKnownHoliday`, the known-holiday table, and the ET time-parts helper) SHALL move to `src/infra/market-calendar.ts` with identical behavior, and `planning-evidence.ts` SHALL consume the shared module. The `market_calendar` capability-gap label on planning evidence is unchanged.

#### Scenario: Extraction preserves behavior

- **WHEN** the existing planning-evidence unit tests run after the extraction
- **THEN** they pass unmodified

### Requirement: Evidence records inherit freshness

When a tool result's `details` carries a `freshness` stamp, the captured tool-evidence record (both the live-event path in `session-coordinator.ts` and the entry-scan path in `prompt-step.ts`) SHALL include the stamp on the record value, and `provenance.timestamp` SHALL be `providerDataAt` when present, else `fetchedAt`.

#### Scenario: Evidence record carries provider data time

- **WHEN** a workflow step calls `get_stock_quote` whose result details include a freshness stamp with `providerDataAt`
- **THEN** the step's evidence record for that call includes the stamp
- **AND** the record's `provenance.timestamp` equals `providerDataAt`
