## 1. Infra: HTTP, rate limiter, cache, symbol mapping

- [x] 1.1 **RED**: Add HTTP-client tests proving a new `httpPost<T>` or generic `httpRequest<T>` sends JSON bodies, preserves timeout/retry behavior from `httpGet`, throws `HttpError` with status + body on non-OK, and does not retry 4xx responses
- [x] 1.2 **GREEN**: Implement the POST-capable helper in `src/infra/http-client.ts`; keep `httpGet` behavior unchanged and use this helper from TradingView provider code instead of ad hoc provider-local fetch
- [x] 1.3 Add `rateLimiter.configure("tradingview", 5, 1)` in `src/infra/rate-limiter.ts` (~1 req/s sustained, burst 5) with a comment citing the "potential bans" / batch-first rationale
- [x] 1.4 Add `TTL.SCREENER` (60_000) and `STALE_LIMIT.SCREENER` (15 * 60_000) to `src/infra/cache.ts`
- [x] 1.5 **RED**: Write tests in `tests/unit/providers/tradingview-symbols.test.ts` for `buildTvSymbol(exchange, ticker)` (e.g. `("NASDAQ","AAPL") → "NASDAQ:AAPL"`, uppercases, trims), already-qualified symbol passthrough, class tickers (`BRK.A`), ETF tickers (`SPY`), and bare-symbol resolution behavior
- [x] 1.6 **GREEN**: Implement `buildTvSymbol` and resolver helpers in `src/providers/tradingview.ts`; exact `EXCH:SYM` inputs use `symbols.tickers`, while bare equity symbols use a deterministic `america/scan2` `name in_range` lookup with primary-listing filters
- [x] 1.7 **GREEN**: Add deterministic bare-symbol disambiguation: exact `name`, `market === "america"`, `is_primary === true`, type precedence `stock` → `fund` → `dr`, exchange precedence `NASDAQ` → `NYSE` → `AMEX`, then lexicographic `s`; if still ambiguous, mark unresolved for Yahoo fallback
- [x] 1.8 **GREEN**: Detect Yahoo-style crypto/international suffixes such as `-USD`, `.TO`, `.DE`, `.T`, `.L`, `.HK` and return them as unresolved unless the user saved explicit TradingView `EXCH:SYM`

## 2. Response decoding (resilience core)

- [x] 2.1 Add fixtures: `tests/fixtures/tradingview/screen-america.json` (multi-symbol screener response with realistic `fields`/`symbols`), `tests/fixtures/tradingview/quotes-batch.json` (explicit-ticker quote response), and `tests/fixtures/tradingview/screen-fields-shuffled.json` (same data, **reordered `fields[]`** and one requested column omitted)
- [x] 2.2 **RED**: Write tests in `tests/unit/providers/tradingview-decode.test.ts`:
  - `decodeScannerRows(payload, requestedColumns)` zips `fields[i] → f[i]` into `{ symbol: s, ...fields }`
  - shuffled-`fields` fixture decodes to identical values (position read from response, not hard-coded)
  - a requested column absent from the response `fields` is backfilled as `null` (explicitly `null`, not `undefined`; no throw) — the shape-guard
  - empty `symbols` array → empty result
- [x] 2.3 **GREEN**: Implement `decodeScannerRows(payload, requestedColumns)` reading positions from `payload.fields` and backfilling any requested column missing from `fields[]` as `null`

## 3. Scanner provider (screen + batch quotes)

- [x] 3.1 **RED**: Write tests in `tests/unit/providers/tradingview.test.ts` (mock `globalThis.fetch` with fixtures):
  - `screenStocks({ market:"america", columns, filter, sort, limit })` POSTs to `scanner.tradingview.com/america/scan2?label-product=screener-stock` with correct body (markets, columns, filter, sort, `range:[0,limit]`)
  - `limit` clamps to `[1, 500]`, with `limit <= 0` defaulting to 50
  - `getQuotes(["NASDAQ:AAPL","NASDAQ:MSFT"])` POSTs to `global/scan2` with `symbols.tickers` set and returns one row per resolved symbol
  - `getQuotes(["AAPL","MSFT"])` uses a single deterministic bare-symbol lookup with concrete body `{ left: "name", operation: "in_range", right: ["AAPL","MSFT"] }` plus primary/type filters (not `symbols.tickers: ["AAPL"]`) and resolves primary US listings to `NASDAQ:AAPL` / `NASDAQ:MSFT`
  - mixed bare/qualified input issues at most two POSTs (one qualified `global/scan2`, one bare `america/scan2`), acquires one `tradingview` token per POST, preserves caller order, and returns a map/list that the watchlist can match back to original saved symbols
  - missing or ambiguous bare symbols are reported as unresolved rows for Yahoo fill, not silently replaced by foreign/CDR listings
  - `BTC-USD`, `RY.TO`, `BMW.DE`, and `7203.T` are returned as unresolved unless explicitly TradingView-qualified
  - quote requests include the fixed minimum columns `name`, `close`, `change`, `change_abs`, `volume`, `exchange`, `market`, `description`, `type`, and `typespecs`
  - filter clauses map `{ field, op, value }` → `{ left, operation, right }`
  - non-OK HTTP surfaces an error with status + truncated body (diagnosable misuse)
  - results cached under a stable canonical JSON key; repeat call within `TTL.SCREENER` does not re-fetch even if object key order differs
  - stale-cache fallback returns prior data on fetch failure within `STALE_LIMIT.SCREENER`
  - `scannerFetch` sends TradingView-compatible headers (`Content-Type`, `Origin`, `Referer`, browser-like `User-Agent`)
- [x] 3.2 **GREEN**: Implement `buildScannerBody(opts)`, `scannerFetch(endpoint, body)` (via the shared POST helper, after `rateLimiter.acquire("tradingview")`), `screenStocks()`, and `getQuotes()` in `src/providers/tradingview.ts` with `cache` + stale fallback
- [x] 3.3 **GREEN**: Define and export types `ScreenerRow`, `ScreenFilterClause`, `ScreenStocksOpts`, `TradingViewQuote` (and a curated `DEFAULT_COLUMNS`) — types in `src/types/market.ts` where they extend existing market types, provider-local otherwise
- [x] 3.4 **GREEN**: Export `screenStocks`, `getQuotes` from `src/providers/index.ts`
- [x] 3.5 **REFACTOR**: Align error-handling, cache-key format, and stale-fallback with existing providers, using `src/providers/yahoo-finance.ts` as the primary reference for `rateLimiter.acquire`, `cache.set`, `cache.getStale`, typed returns, and propagated `HttpError`

## 4. `screen_stocks` tool

- [x] 4.1 **RED**: Write tests in `tests/unit/tools/screen-stocks.test.ts`:
  - Typebox params: `market` (default `"america"`), `columns` (optional), `filter` (optional array of clauses), `sort` (optional), `limit` (optional, default 50)
  - multiple filter clauses are emitted as flat AND clauses; OR/nested `filter2` composition is not exposed in V1
  - happy path returns formatted rows + a TradingView-sourced / possibly-delayed / unofficial caveat
  - provider `unavailable` → tool returns a structured "screening unavailable" message, never fabricated rows
  - field/op misuse surfaces the scanner error, not a silent empty
- [x] 4.2 **GREEN**: Implement `screenStocksTool` (name `screen_stocks`) in `src/tools/market/screen-stocks.ts`, calling the provider through `wrapProvider`, snake_case name, Typebox params per CODE STYLE
- [x] 4.3 **GREEN**: Register `screenStocksTool` in `src/tools/index.ts` (import, named export, and `getAllTools()` array)
- [x] 4.4 **GREEN**: Wire `screen_stocks` into active-tool selection by adding it to `TOOL_BUNDLE_TOOLS.core_market` in `src/routing/route-manifest.ts`, updating `src/prompts/context-builder.ts` and `src/system-prompt.ts` tool catalog guidance, and adding tests that `getOpenCandleToolDefinitions()` and core-market routing expose the tool
- [x] 4.5 **GREEN**: Add tool-choice guidance/tests so OpenCandle uses `screen_stocks` for breadth/screening prompts (large-cap screens, oversold scans, market movers by filter) but keeps using Yahoo-backed `get_stock_quote` / `get_stock_history` for single-symbol quotes/history and `get_option_chain`, fundamentals, or workflows for options/DCF/analysis prompts
- [x] 4.6 **GREEN**: Add negative bundle tests asserting `screen_stocks` is absent from macro-only, sentiment-only, and SEC-only active tool lists unless `core_market` is selected

## 5. Watchlist batch-quote + Yahoo fallback

- [x] 5.1 **RED**: Update `tests/unit/tools/watchlist.test.ts` (or create if absent):
  - `check` with N equity symbols issues ONE TradingView batch call (assert single fetch), not N
  - TradingView `unavailable`/empty → falls back to the existing per-symbol Yahoo path for the whole list, output unchanged
  - TradingView partial result (e.g. AAPL priced, BTC-USD or UNKNOWN missing) fills missing symbols through Yahoo without discarding successful TradingView rows
  - bare watchlist symbols (`AAPL`, `MSFT`, `BRK.A`, `SPY`) resolve to primary US listings; unresolved/ambiguous rows do not map to foreign/CDR listings
  - Yahoo-style suffix symbols (`BTC-USD`, `RY.TO`, `BMW.DE`, `7203.T`) skip TradingView unless explicitly `EXCH:SYM`-qualified and are priced through Yahoo fallback
  - partial fallback preserves per-row `sourceProvider` and only labels TradingView-sourced rows as delayed/unofficial
  - target/stop price alerting logic still fires identically under both paths
- [x] 5.2 **GREEN**: Refactor the `check` action in `src/tools/portfolio/watchlist.ts` to call `getQuotes(symbols)` through `wrapProvider("tradingview", ...)`, fill missing symbols with the existing Yahoo per-symbol path, and use whole-list Yahoo fallback when TradingView is unavailable or returns no usable rows
- [x] 5.3 **GREEN**: Annotate batch results with the delayed/unofficial caveat consistent with `screen_stocks`
- [x] 5.4 **REFACTOR**: Confirm no regression in add/remove actions and price-alert formatting

## 6. Test suite & guards

- [x] 6.1 Run `npm test` — all new + existing tests pass; confirm no live API calls in unit tests (fetch is mocked)
- [x] 6.2 Confirm the shape-guard test (2.2) fails if `decodeScannerRows` is reverted to hard-coded indices (sanity-check the guard actually guards)
- [x] 6.3 Because this change updates tool-catalog/system-prompt guidance, run `npx vitest run tests/unit/prompts/prompt-debt-guard.test.ts` and any focused prompt/system-prompt tests touched by the catalog update

## 7. Harness integration (live agent, batch-first, read-only)

Run via `npx tsx tests/harness/cli.ts run`; verify routing + no regressions. Keep request volume minimal (batch calls only).

- [x] 7.1 `"Screen for US large-caps with RSI below 30 sorted by volume"` → agent calls `screen_stocks` (market america, filter on RSI + market cap, sort volume); rows returned with delayed/unofficial caveat
- [x] 7.2 `"Which mega-cap tech names are down more than 3% today?"` → `screen_stocks` with a `change` filter; sensible rows
- [x] 7.3 `"Show me stocks with market cap above $10B and RSI under 30"` → active tools include `screen_stocks`; no prompt text pushes the agent toward repeated `get_stock_quote` fan-out
- [x] 7.4 `"Check my watchlist"` (seed a 100+ bare US equity-symbol watchlist) → `watchlist check` issues a single TradingView bare-symbol batch call for the primary path; all names priced; alerts fire
- [x] 7.5 Watchlist partial fallback: include at least one symbol TradingView does not resolve (e.g. Yahoo-style crypto or an unknown ticker) → missing symbols use Yahoo fill while priced TradingView rows remain intact
- [x] 7.6 Watchlist provider fallback: simulate TradingView failure (e.g. force-unavailable) → `check` degrades to Yahoo per-symbol, output equivalent
- [x] 7.7 Regression `"What's AAPL trading at?"` → still routes to `get_stock_quote` (Yahoo), unaffected
- [x] 7.8 Regression `"Run a DCF on MSFT"`, `"Analyze GOOGL"`, and an options-chain prompt → fundamentals / options / analysis workflows unaffected by the new provider/tool

## 8. Docs & changelog

- [x] 8.1 Update `CHANGELOG.md` under `[Unreleased] / Added` (use changelog-automation skill) describing the keyless TradingView screener provider, `screen_stocks` tool, and watchlist batch-quote fallback — including the delayed/unofficial-data caveat
- [x] 8.2 Add a short `src/providers/` note or `docs/` reference listing the borrowed projects (finance-skills, shner-elmo, tvscreener) and a pointer to the field/operation catalog, with licenses noted
- [x] 8.3 If the shared HTTP helper becomes part of `opencandle/tool-kit`, update package export/build tests; otherwise document that it is internal-only and keep public exports unchanged
