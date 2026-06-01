## 1. Infra: rate limiter, cache, symbol mapping

- [ ] 1.1 Add `rateLimiter.configure("tradingview", 5, 1)` in `src/infra/rate-limiter.ts` (~1 req/s sustained, burst 5) with a comment citing the "potential bans" / batch-first rationale
- [ ] 1.2 Add `TTL.SCREENER` (60_000) and `STALE_LIMIT.SCREENER` (15 * 60_000) to `src/infra/cache.ts`
- [ ] 1.3 **RED**: Write tests in `tests/unit/providers/tradingview-symbols.test.ts` for `buildTvSymbol(exchange, ticker)` (e.g. `("NASDAQ","AAPL") → "NASDAQ:AAPL"`, uppercases, trims) and exchange-default behavior
- [ ] 1.4 **GREEN**: Implement `buildTvSymbol` (borrowed shape from `finance-skills/lib/symbols.js`) in `src/providers/tradingview.ts`

## 2. Response decoding (resilience core)

- [ ] 2.1 Add fixtures: `tests/fixtures/tradingview/screen-america.json` (multi-symbol screener response with realistic `fields`/`symbols`), `tests/fixtures/tradingview/quotes-batch.json` (explicit-ticker quote response), and `tests/fixtures/tradingview/screen-fields-shuffled.json` (same data, **reordered `fields[]`** and one requested column omitted)
- [ ] 2.2 **RED**: Write tests in `tests/unit/providers/tradingview-decode.test.ts`:
  - `decodeScannerRows(payload, requestedColumns)` zips `fields[i] → f[i]` into `{ symbol: s, ...fields }`
  - shuffled-`fields` fixture decodes to identical values (position read from response, not hard-coded)
  - a requested column absent from the response `fields` is backfilled as `null` (explicitly `null`, not `undefined`; no throw) — the shape-guard
  - empty `symbols` array → empty result
- [ ] 2.3 **GREEN**: Implement `decodeScannerRows(payload, requestedColumns)` reading positions from `payload.fields` and backfilling any requested column missing from `fields[]` as `null`

## 3. Scanner provider (screen + batch quotes)

- [ ] 3.1 **RED**: Write tests in `tests/unit/providers/tradingview.test.ts` (mock `globalThis.fetch` with fixtures):
  - `screenStocks({ market:"america", columns, filter, sort, limit })` POSTs to `scanner.tradingview.com/america/scan2?label-product=screener-stock` with correct body (markets, columns, filter, sort, `range:[0,limit]`)
  - `limit` clamps to `[1, 500]`
  - `getQuotes(["AAPL","MSFT"])` POSTs to `global/scan2` with `symbols.tickers` set and returns one row per resolved symbol
  - filter clauses map `{ field, op, value }` → `{ left, operation, right }`
  - non-OK HTTP surfaces an error with status + truncated body (diagnosable misuse)
  - results cached under a stable key; repeat call within `TTL.SCREENER` does not re-fetch
  - stale-cache fallback returns prior data on fetch failure within `STALE_LIMIT.SCREENER`
- [ ] 3.2 **GREEN**: Implement `buildScannerBody(opts)`, `scannerFetch(endpoint, body)` (via `httpGet`, `rateLimiter.acquire("tradingview")`), `screenStocks()`, and `getQuotes()` in `src/providers/tradingview.ts` with `cache` + stale fallback
- [ ] 3.3 **GREEN**: Define and export types `ScreenerRow`, `ScreenFilterClause`, `ScreenStocksOpts`, `TradingViewQuote` (and a curated `DEFAULT_COLUMNS`) — types in `src/types/market.ts` where they extend existing market types, provider-local otherwise
- [ ] 3.4 **GREEN**: Export `screenStocks`, `getQuotes` from `src/providers/index.ts`
- [ ] 3.5 **REFACTOR**: Align error-handling, cache-key format, and stale-fallback with existing providers (compare against `yahoo-finance.ts` / `finnhub.ts`)

## 4. `screen_stocks` tool

- [ ] 4.1 **RED**: Write tests in `tests/unit/tools/screen-stocks.test.ts`:
  - Typebox params: `market` (default `"america"`), `columns` (optional), `filter` (optional array of clauses), `sort` (optional), `limit` (optional, default 50)
  - happy path returns formatted rows + a TradingView-sourced / possibly-delayed / unofficial caveat
  - provider `unavailable` → tool returns a structured "screening unavailable" message, never fabricated rows
  - field/op misuse surfaces the scanner error, not a silent empty
- [ ] 4.2 **GREEN**: Implement `screenStocksTool` (name `screen_stocks`) in `src/tools/market/screen-stocks.ts`, calling the provider through `wrapProvider`, snake_case name, Typebox params per CODE STYLE
- [ ] 4.3 **GREEN**: Register `screenStocksTool` in `src/tools/index.ts` (import, named export, and `getAllTools()` array)

## 5. Watchlist batch-quote + Yahoo fallback

- [ ] 5.1 **RED**: Update `tests/unit/tools/watchlist.test.ts` (or create if absent):
  - `check` with N symbols issues ONE TradingView batch call (assert single fetch), not N
  - TradingView `unavailable`/empty → falls back to the existing per-symbol Yahoo path, output unchanged
  - target/stop price alerting logic still fires identically under both paths
- [ ] 5.2 **GREEN**: Refactor the `check` action in `src/tools/portfolio/watchlist.ts` to call `getQuotes(symbols)` once, wrapped in `withFallback([tradingview, yahoo-per-symbol])`, mapping both result shapes to the existing `WatchlistItem` rendering
- [ ] 5.3 **GREEN**: Annotate batch results with the delayed/unofficial caveat consistent with `screen_stocks`
- [ ] 5.4 **REFACTOR**: Confirm no regression in add/remove actions and price-alert formatting

## 6. Test suite & guards

- [ ] 6.1 Run `npm test` — all new + existing tests pass; confirm no live API calls in unit tests (fetch is mocked)
- [ ] 6.2 Confirm the shape-guard test (2.2) fails if `decodeScannerRows` is reverted to hard-coded indices (sanity-check the guard actually guards)
- [ ] 6.3 If any production prompt guidance changed, run `npx vitest run tests/unit/prompts/prompt-debt-guard.test.ts` (expected: no prompt changes in this change → skip with a note)

## 7. Harness integration (live agent, batch-first, read-only)

Run via `npx tsx tests/harness/cli.ts run`; verify routing + no regressions. Keep request volume minimal (batch calls only).

- [ ] 7.1 `"Screen for US large-caps with RSI below 30 sorted by volume"` → agent calls `screen_stocks` (market america, filter on RSI + market cap, sort volume); rows returned with delayed/unofficial caveat
- [ ] 7.2 `"Which mega-cap tech names are down more than 3% today?"` → `screen_stocks` with a `change` filter; sensible rows
- [ ] 7.3 `"Check my watchlist"` (seed a 100+ symbol watchlist) → `watchlist check` issues a single batch call; all names priced; alerts fire
- [ ] 7.4 Watchlist fallback: simulate TradingView failure (e.g. force-unavailable) → `check` degrades to Yahoo per-symbol, output equivalent
- [ ] 7.5 Regression `"What's AAPL trading at?"` → still routes to `get_stock_quote` (Yahoo), unaffected
- [ ] 7.6 Regression `"Run a DCF on MSFT"` and `"Analyze GOOGL"` → fundamentals / analysis workflows unaffected by the new provider/tool

## 8. Docs & changelog

- [ ] 8.1 Update `CHANGELOG.md` under `[Unreleased] / Added` (use changelog-automation skill) describing the keyless TradingView screener provider, `screen_stocks` tool, and watchlist batch-quote fallback — including the delayed/unofficial-data caveat
- [ ] 8.2 Add a short `src/providers/` note or `docs/` reference listing the borrowed projects (finance-skills, shner-elmo, tvscreener) and a pointer to the field/operation catalog, with licenses noted
