# Design — Freshness Ledger

All decisions below are made; do not redesign. Line numbers are as of 2026-07-05 — re-locate by symbol name if drifted.

## 1. Shared market calendar: `src/infra/market-calendar.ts` (extraction, no behavior change)

Move from `src/runtime/planning-evidence.ts`, verbatim in behavior (all are module-private today — verified no external importers):

- `classifyMarketStatus` (~line 594). NOTE: it is currently declared `: string`; the union values exist only as body literals. The extraction declares the return type as the explicit six-value union `"closed_weekend" | "closed_holiday" | "pre_market" | "open" | "after_close" | "closed_after_hours"` (type-only tightening, behavior identical) so `MarketSession` does not collapse to `string`.
- `localDateTimeParts` (~line 623, `Intl.DateTimeFormat` in `America/New_York`)
- `lastTradingDay` (~line 648), `isWeekendOrKnownHoliday` (~line 656), `KNOWN_US_MARKET_HOLIDAYS`
- The private helpers they depend on: `dateFromKey`, `addDays`, `dateKey` (~lines 662-678)

`planning-evidence.ts` imports from the new module. The `capability_gap: "market_calendar"` planning-evidence record is unchanged.

Exports: `type MarketSession = <the six-value union> | "unknown"` and a new wrapper the freshness module needs (nothing callable exists today — `classifyMarketStatus` requires pre-computed ET parts, weekend/holiday flags, and prompt-derived `temporalReferences`):

```ts
export function classifyMarketStatusAt(now: Date): MarketSession
// composes localDateTimeParts + isWeekendOrKnownHoliday + classifyMarketStatus with temporalReferences: []
```

Known consequence to encode in tests, not "fix": with empty `temporalReferences`, the `after_close` branch is unreachable — post-16:00 stamps render `closed_after_hours`. Freshness stamps never produce `after_close`.

## 2. `src/infra/freshness.ts` — the ledger row

```ts
export interface FreshnessStamp {
  /** Wall-clock when OpenCandle obtained the data (fetch time or stale-cache read time), ISO 8601. */
  fetchedAt: string;
  /** The provider's own market/as-of time for the data, ISO 8601, when the provider exposes one. */
  providerDataAt?: string;
  /** live = fresh fetch; cached = within TTL; stale = served from the stale window after a fetch failure. */
  cacheStatus: "live" | "cached" | "stale";
  /** Cache write time when cacheStatus != "live", ISO 8601. */
  cachedAt?: string;
  /** US equity market session at fetchedAt (crypto tools pass "unknown"; crypto trades 24/7). */
  marketSession: MarketSession;
  /** Known structural provider delay, e.g. TradingView 15-minute delayed data. */
  dataDelayMs?: number;
  /** True when providerDataAt predates the most recent completed trading session (see rule below). */
  isStaleForSession: boolean;
}

export function buildFreshnessStamp(input: {
  asOf?: string | number | Date; // provider market time: ISO string, epoch ms, epoch seconds (Yahoo), or Date (yahoo-finance2)
  stale?: boolean;               // from ProviderResultOk.stale
  cachedAt?: string;             // from stale metadata / ProviderResultOk.timestamp when stale
  dataDelayMs?: number;
  now?: Date;                    // injectable for tests; default new Date()
  assetClass?: "equity" | "crypto";  // crypto => marketSession "unknown", isStaleForSession from age > 15m
}): FreshnessStamp;
// No provider param: FreshnessStamp carries no provider field and the templates don't render one
// (ProviderResultOk doesn't identify the winning provider after withFallback anyway).

export function formatAsOfLine(stamp: FreshnessStamp): string;
```

All as-of dates render in **ET (America/New_York)** — the same zone the market calendar uses. A Friday 16:00 ET close renders as that Friday's date regardless of the UTC date.

`buildFreshnessStamp` decisions:
- Epoch-seconds detection: numeric `asOf < 10_000_000_000` is seconds (Yahoo `regularMarketTime`), else ms.
- Alpha Vantage's `"07. latest trading day"` is date-only; store as `providerDataAt = "<date>T00:00:00Z"` and set a boolean-equivalent by treating date-only values as "session-dated" — the staleness rule compares by trading day, not clock time, so date-only is sufficient.
- `isStaleForSession` (equity): true when `providerDataAt`'s trading date is strictly before `lastTradingDay(now)`. When `providerDataAt` is absent, fall back to `cacheStatus === "stale"`.
- `isStaleForSession` (crypto): true when `providerDataAt` (or `cachedAt` when stale) is older than 15 minutes.

`formatAsOfLine` output shapes (exact templates; tests snapshot these; all dates/times in ET):
- live/current: `As of 2026-07-03 16:00 ET (market open).`
- delayed: `As of 2026-07-03 15:45 ET (~15m delayed).`
- session-stale: `Last available price as of 2024-03-22. This is not a live quote.` — with a current-session parenthetical appended after the date only when `marketSession` (at `now`) is `closed_weekend`/`closed_holiday`: `Last available price as of 2024-03-22 (market closed — weekend). This is not a live quote.` The parenthetical describes *now*, not the data's day, so it must not render on open-market runs.
- stale cache: `Using cached data from 2026-07-03 14:10 ET (provider unavailable).`
When both stale-cache and session-stale apply, session-stale wording wins and the cached time is appended in parentheses.

## 3. Provider mapping boundary changes

- `src/types/market.ts`: add `asOf?: string` (ISO 8601 provider market time) to `StockQuote` and `CryptoPrice`. `timestamp` keeps its existing meaning (fetch wall-clock) — do not repurpose it; consumers exist.
- `src/providers/yahoo-finance.ts` quote mapping (~line 97-124): read `meta.regularMarketTime` (epoch seconds) → `asOf` ISO string when present and finite.
- `src/providers/alpha-vantage.ts` GLOBAL_QUOTE mapping (~line 221-237): read `"07. latest trading day"` → `asOf` (date-only ISO as above).
- `src/providers/coingecko.ts`: add `market_data.last_updated` to `CoinGeckoDetailResponse` and map → `asOf`.
- `src/providers/tradingview.ts`: no market time exists; the provider keeps `dataCaveat` and tools stamping TradingView results pass `dataDelayMs: 15 * 60_000` (the constant already used at `alert-runner.ts` TradingView path).
- Options: add `asOf?: string` to `OptionsChain` (`src/types/options.ts` — it has only `fetchedAt` today). In `parseOptionsResponse` (`src/providers/yahoo-finance.ts` ~:546-612) map the underlying `result.quote.regularMarketTime` (epoch seconds, untyped `Record<string, any>`); in the `fetchOptionsViaYahooFinance2` fallback (~:617) map its quote time field too — yahoo-finance2 may return a `Date`, which `buildFreshnessStamp`'s input union accepts.
- FRED: `FredSeries.lastUpdated` already exists; no provider change.

## 4. Tool integration (v1 scope: quote family)

Tools in scope: `src/tools/market/stock-quote.ts`, the crypto price tool, `src/tools/options/` option-chain tool, `src/tools/market/screen-stocks.ts` (TradingView). Each:

1. Builds the stamp: `buildFreshnessStamp({ asOf: quote.asOf, stale: result.stale, cachedAt: result.stale ? result.timestamp : undefined, dataDelayMs })`.
2. Appends `formatAsOfLine(stamp)` as the **last line** of the tool's text content.
3. Adds `freshness: stamp` to the tool's `details` object — **except `screen_stocks`**, whose `details` is the bare `ScreenerRow[]` array today; reshaping it would break consumers, so `screen_stocks` is exempt from `details.freshness` and its disclosure is text-only. (Its stamp uses `dataDelayMs: 15 * 60_000`, no `asOf`.)
4. Bespoke wording is REPLACED, not duplicated: `stock-quote.ts` drops its stale `prefix` (~:55-57); `screen_stocks` drops its two existing hand-rolled lines ("⚠ Using cached TradingView screen from …" and "Data freshness: … retrieved at …", ~:153-154) in favor of the shared line. The TradingView provider-level `dataCaveat` string (unofficial/delayed data wording) stays — it is a source caveat, not staleness wording.

The existing zero-filled-quote guard (`isZeroFilledQuote` → unavailable) is unchanged and runs before stamping.

## 5. Evidence propagation

In `toolEvidenceRecord` (`src/runtime/session-coordinator.ts` ~line 773) and `captureToolEvidence` (`src/runtime/prompt-step.ts` ~line 62): when the tool result's `details` carries a `freshness` object, copy it onto the evidence record value (alongside `resultDigest`) and set `provenance.timestamp` to `freshness.providerDataAt ?? freshness.fetchedAt`. `RuntimeValidator.checkTimestamps` needs no change — it already warns on missing timestamps; this change makes real timestamps flow.

## 6. E3 promotion mechanics (decided — the fixture/test date pair changes together)

`tests/fixtures/yahoo/weekend-stale-quote.json` currently has **no date field of any kind** in `meta`; the skipped test's `2024-03-23` literal encoded the *fetch* Saturday as a placeholder because no provider market date existed to assert on. The promotion:

1. Add `"regularMarketTime": 1711137600` to the fixture's `meta` (2024-03-22 20:00:00 UTC = Friday 16:00 ET — what Yahoo actually returns on a Saturday fetch).
2. Update the test's expected-date regex from `2024-03-23` to `2024-03-22` (Friday, ET). This is a **strengthening**, not a weakening: the assertion's intent is disclosure of the provider's stale market date, which now exists; the old literal was the fetch-day placeholder. Record this justification in the test comment.
3. The promoted assertion must not depend on when the test runs: it matches the session-stale wording (`last available`/`as of`), the `2024-03-22` date, and the absence of `$0.00` — not the current-session parenthetical, which varies with the wall clock.

## 7. What this deliberately does not touch

- `wrapProvider` / `withFallback` / circuit breaker logic — unchanged. The stamp is built in tools from data the result already carries.
- Alert runner (`AlertQuoteObservation`) — unchanged; it already has its own richer observation. Converging it is a follow-up.
- Prompt templates — untouched. The as-of line lives in tool output text, which is data to the model, not instruction.
