## ADDED Requirements

### Requirement: `withFallback` utility tries alternate providers when primary fails

A shared `withFallback()` utility SHALL attempt providers in order, stopping at the first success. It integrates with `ProviderTracker` to skip circuit-open providers and record failures. It integrates with stale cache (spec B) as the last resort before declaring unavailability.

#### Scenario: Primary succeeds — no fallback attempted

- **GIVEN** `withFallback` is called with `[yahoo, alphavantage]` for a quote
- **AND** Yahoo is healthy
- **WHEN** Yahoo returns data
- **THEN** the result is the Yahoo data
- **AND** the AlphaVantage fallback is never called

#### Scenario: Primary fails — fallback attempted

- **GIVEN** `withFallback` is called with `[yahoo, alphavantage]` for a quote
- **AND** Yahoo throws `HttpError(503)`
- **WHEN** the primary fails
- **THEN** `providerTracker.recordFailure("yahoo")` is called
- **AND** AlphaVantage is attempted next
- **AND** if AlphaVantage succeeds, its data is returned

#### Scenario: All providers fail — result is unavailable

- **GIVEN** `withFallback` is called with `[yahoo, alphavantage]` for a quote
- **AND** both providers fail
- **WHEN** the fallback chain is exhausted
- **THEN** the result is `ProviderResultUnavailable` listing all attempted providers
- **AND** stale cache is NOT attempted here — stale fallback lives inside each provider function (spec B), so it was already tried within each provider's own execution before the provider threw

#### Scenario: Circuit-open providers are skipped

- **GIVEN** `providerTracker.isCircuitOpen("yahoo")` returns `true`
- **WHEN** `withFallback` reaches the Yahoo entry
- **THEN** it skips Yahoo without making an HTTP call
- **AND** proceeds to the next provider in the chain

#### Scenario: Fallback respects rate limits

- **GIVEN** Yahoo failed and AlphaVantage is the fallback
- **WHEN** the AlphaVantage fallback call executes
- **THEN** it goes through `rateLimiter.acquire("alphavantage")` — same as a direct call
- **AND** rate limiting is NOT bypassed for fallback calls

### Requirement: Fallback matrix is limited to type-compatible provider pairs

Cross-provider fallback SHALL only be defined where the fallback provider can return the **same type** as the primary, or where a lightweight adapter produces the same type. The current provider landscape supports very few genuine fallback pairs.

#### Scenario: Viable fallback pairs

- **WHEN** the fallback matrix is defined
- **THEN** it contains ONLY these pairs:

| Data Need | Primary | Fallback | Adapter Needed | Notes |
|-----------|---------|----------|----------------|-------|
| Stock quote | Yahoo `getQuote` | AlphaVantage `getGlobalQuote` (new) | Yes — new AV function returning `StockQuote` | AV GLOBAL_QUOTE endpoint returns last price, change, volume. Missing intraday high/low/open — set to 0 with formatter guard. |
| Stock history (daily only) | Yahoo `getHistory` (when `interval="1d"`) | AlphaVantage `getDailyHistory` (new) | Yes — new AV function returning `OHLCV[]` | AV TIME_SERIES_DAILY endpoint. Daily granularity only — fallback MUST NOT be attempted for intraday intervals. |

All other data needs have NO viable cross-provider fallback:

| Data Need | Why No Fallback |
|-----------|----------------|
| Company overview | SEC EDGAR returns `SECFiling` (metadata: formType, filedDate, url) — cannot produce `CompanyOverview` fields (P/E, EPS, marketCap, sector). |
| Earnings | SEC EDGAR has filing metadata, not parsed EPS/surprise data. |
| Financials | SEC EDGAR has filing index, not parsed income/balance/cashflow line items. |
| Options chain | Yahoo is the only source (already has 3-tier: normal → re-auth → browser). |
| Crypto | CoinGecko is the only provider. |
| Sentiment | Reddit is the only provider. |
| Macro | FRED is the only provider. |
| Fear & Greed | Single-source API. |

For providers with no fallback, the recovery path is: stale cache (spec B) → `ProviderResultUnavailable` (spec A).

#### Scenario: New AlphaVantage functions return existing types

- **GIVEN** a new `getGlobalQuote(symbol, apiKey)` function is added to `src/providers/alpha-vantage.ts`
- **WHEN** it fetches the AV GLOBAL_QUOTE endpoint
- **THEN** it returns `StockQuote` with:
  - `price`, `change`, `changePercent`, `previousClose`, `volume`: from API response
  - `open`, `high`, `low`: from API response (AV provides these for last trading day)
  - `marketCap`, `pe`: `0` and `null` respectively (not available from this endpoint)
  - `week52High`, `week52Low`: `0` (not available — formatters must guard against 0)
  - `timestamp`: current time
- **AND** the function uses `rateLimiter.acquire("alphavantage")` and `cache.set()` as existing AV functions do

#### Scenario: New AlphaVantage daily history returns OHLCV[]

- **GIVEN** a new `getDailyHistory(symbol, apiKey, range)` function is added
- **WHEN** it fetches the AV TIME_SERIES_DAILY endpoint
- **THEN** it returns `OHLCV[]` — same type as `yahoo-finance.getHistory()`
- **AND** `range` maps to an appropriate `outputsize` parameter (`compact` for ≤100 days, `full` for more)

### Requirement: History fallback is restricted to daily interval

`get_stock_history` accepts `interval` values including intraday (`1m`, `5m`, `15m`, `1h`) and daily+ (`1d`, `1wk`, `1mo`). The AlphaVantage TIME_SERIES_DAILY fallback only provides daily bars. Silently returning daily data for an intraday request would be a semantic error.

#### Scenario: Intraday request — no fallback attempted

- **GIVEN** the user requests `get_stock_history` with `interval: "5m"` and `range: "1d"`
- **AND** Yahoo throws `HttpError(503)`
- **WHEN** the tool evaluates the fallback chain
- **THEN** the AlphaVantage daily-history fallback is NOT attempted
- **AND** the tool returns the provider-level stale cache result (spec B) or an unavailable response
- **AND** the response explains: `"⚠ Intraday history unavailable (Yahoo down). No alternate source for 5m data."`

#### Scenario: Daily request — fallback attempted normally

- **GIVEN** the user requests `get_stock_history` with `interval: "1d"` (or default)
- **AND** Yahoo throws `HttpError(503)`
- **WHEN** the tool evaluates the fallback chain
- **THEN** AlphaVantage `getDailyHistory` is attempted
- **AND** if it succeeds, the bars are returned with provenance noting the AlphaVantage source

### Requirement: Tool formatters guard against fallback zero-value fields

When a fallback provider returns `StockQuote` or `OHLCV[]` with zero-value fields that the primary would have populated, tool formatters SHALL display those fields as "N/A" instead of "$0.00" or crashing on `.toFixed()`.

#### Scenario: stock-quote formatter handles zero week52 from fallback

- **GIVEN** `get_stock_quote` received a `StockQuote` from the AlphaVantage fallback
- **AND** `week52High` and `week52Low` are `0` (not available from GLOBAL_QUOTE)
- **WHEN** the formatter builds the text response
- **THEN** the 52W Range line reads `"52W Range: N/A"` instead of `"$0.00 - $0.00"`

### Requirement: Tools declare fallback chains via withFallback

Tools opt into fallback by wrapping their provider call in `withFallback()`. The tool's `execute()` signature and return type do not change. Callers (the LLM, the workflow runner) are unaware of the fallback mechanism.

#### Scenario: get_stock_quote with fallback

- **GIVEN** `get_stock_quote` currently calls `getQuote(symbol)` directly
- **WHEN** fallback is added
- **THEN** it uses:
  ```
  withFallback(providerTracker, [
    { provider: "yahoo", fn: () => getQuote(symbol) },
    { provider: "alphavantage", fn: () => getGlobalQuote(symbol, apiKey) },
  ])
  ```
- **AND** the tool's external interface is unchanged
- **AND** the text response includes provenance: which provider served the data
- **AND** `withFallback` does NOT manage cache keys — each provider function internally uses its own cache key (e.g., `yahoo:quote:${symbol}`, `av:globalquote:${symbol}`) including stale fallback (spec B)

#### Scenario: Tool with no fallback uses wrapProvider directly

- **GIVEN** `get_company_overview` has no cross-provider fallback (EDGAR can't substitute)
- **WHEN** AlphaVantage fails
- **THEN** the tool uses `wrapProvider("alphavantage", ...)` (spec A) — not `withFallback`
- **AND** stale cache recovery happens inside `getOverview()` itself (spec B)
- **AND** if both fresh fetch and stale cache fail, the tool returns a degraded text response

## NOT Changed

- Provider implementations (Yahoo, AlphaVantage, FRED, etc.) — existing functions unchanged
- Tool parameter schemas — no new parameters exposed to the LLM  
- Workflow step definitions — steps are unaware of fallback
- `httpGet` retry logic — HTTP retries happen within each provider call, before fallback triggers
- SEC EDGAR provider — not used as a data fallback (only filing metadata)
- Options chain fallback — Yahoo's existing 3-tier (normal → re-auth → browser) is sufficient

## NEW Code Required

| File | What |
|------|------|
| `src/providers/alpha-vantage.ts` | New `getGlobalQuote()` and `getDailyHistory()` functions |
| `src/providers/with-fallback.ts` (new) | `withFallback()` utility |
| `src/tools/market/stock-quote.ts` | Wrap in `withFallback`, guard formatter for zero fields |
| `src/tools/market/stock-history.ts` | Wrap in `withFallback` |
| Other tools | Single-entry `withFallback` for stale-cache-only fallback |
