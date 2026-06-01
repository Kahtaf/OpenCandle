## Why

OpenCandle has no market-screening capability and no batch-quote path. Every breadth question ("which large-caps are oversold?", "scan my 100-name watchlist") currently has to fan out one Yahoo `getQuote` per symbol — the existing `watchlist` `check` action does exactly this. That fan-out is the precise access pattern that triggers Yahoo's per-IP 429s and bans (the `yfinance` issue tracker is full of them, and we already fight Yahoo's crumb/cookie auth with retries — see CHANGELOG).

TradingView's internal scanner backend (`scanner.tradingview.com/{market}/scan2`) solves both gaps with one keyless POST: it returns **hundreds of symbols × thousands of fields** (price, %change, volume, market cap, and server-computed indicators like `RSI|60`) filtered and sorted server-side, across ~70 countries plus crypto/forex/futures/bond/CFD. One request does what would take Yahoo a thousand. For a watchlist monitor polling every 60s, that is ~1,440 req/day flat regardless of list size — trivially under any rate limit — versus a Yahoo fan-out that would be banned within minutes.

Stability evidence supports building on it: the canonical Python wrapper (`shner-elmo/TradingView-Screener`) has shipped ~4 releases in 18 months with **one** upstream-forced protocol break in three years (the `scan` → `scan2` migration, v3.0 Jan 2025). By contrast `yfinance` ships ~2–3 releases/month largely to chase Yahoo's crumb/auth/decrypt/rate-limit breakages. The realistic TradingView failure mode is column-name/symbol drift, not endpoint death — which a position-based decoder and a fixture shape-guard test defend against.

## What Changes

- **Add a keyless TradingView scanner provider** — new `src/providers/tradingview.ts` with `screenStocks(opts)` (filtered/sorted multi-symbol scan) and `getQuotes(symbols)` (batch snapshot). Both POST to `scanner.tradingview.com/{market}/scan2`, decode the column-compressed `{fields, symbols:[{s,f}]}` response **by reading positions from the response `fields[]` (never hard-coded indices)**, tolerate missing columns as `null`, and route through the existing `cache` + `rateLimiter` + stale-fallback infra using the same provider pattern as `src/providers/yahoo-finance.ts`. No API key, no login, no browser, no cookies.
- **Add a `screen_stocks` tool** — new `src/tools/market/screen-stocks.ts` exposing market screening (market, structured filters, columns, sort, limit) to the agent. This is a brand-new capability OpenCandle cannot do today.
- **Wire the tool into OpenCandle's active-tool path** — register `screenStocksTool` in `src/tools/index.ts`, add `screen_stocks` to the core market route bundle in `src/routing/route-manifest.ts`, and update the tool catalog/system prompt text so OpenCandle knows to use TradingView screening for breadth queries while preserving Yahoo for single-symbol quotes, history, options, and analysis workflows.
- **Add batch-quote fallback to the `manage_watchlist` tool** — the `check` action prefers a TradingView batch call for equity-like watchlist symbols and fills any missing/ambiguous rows via the current per-symbol Yahoo path, preserving existing behavior when TradingView is unavailable or incomplete.
- **Add `tradingview` rate-limit, cache TTL, and symbol-mapping support** — conservative `~1 req/s` bucket (community norm + the wrapper README's "potential bans" caveat), `TTL.SCREENER` (60s) / `STALE_LIMIT.SCREENER` (15m), and an exchange-aware `EXCH:SYM` symbol builder.
- **Add POST-capable HTTP support** — `scan2` requires JSON POST, while OpenCandle's current `httpGet` helper is GET-only. This change adds or reuses an equivalent `httpPost`/generic JSON request helper with the same timeout, retry, and `HttpError` behavior before using it from the provider.

## Capabilities

### New Capabilities
- `tradingview-screener`: Keyless TradingView scanner provider (screen + batch quotes), the `screen_stocks` tool, resilient response decoding, rate limiting, caching, and symbol mapping.

### Modified Capabilities
- `watchlist`: `manage_watchlist` `check` action uses TradingView batch quotes with Yahoo per-symbol fallback, eliminating the common fan-out that risks Yahoo rate-limit bans.

## Impact

- **Dependencies**: None. The scanner is a plain JSON POST via OpenCandle's HTTP infra — no SDK, no `better-sqlite3`/browser path (unlike our Twitter provider).
- **Credentials**: **None required** — the `scan2` data endpoint is keyless. No new env var, no onboarding/degradation tagging. (This is a deliberate contrast with Finnhub/Exa, which need keys.)
- **Config**: No new key. Optional internal pacing constant only.
- **Rate limiting**: New `tradingview` bucket (~1 req/s sustained, burst 5). Batch-first usage keeps real volume far below this.
- **Cache**: New `TTL.SCREENER` (60s) and `STALE_LIMIT.SCREENER` (15m).
- **Tests**: New unit tests + fixtures for the HTTP POST helper, provider, decoder, symbol mapping/resolution, route-bundle exposure, tool catalog guidance, and `screen_stocks` tool; updated `watchlist` tests for the batch+partial-fallback path. A **fixture shape-guard test** asserts the decoder survives field reordering and missing columns. No live API calls in unit tests.
- **Data quality caveat (surfaced to users)**: Free-tier scanner data is typically **~15-min delayed** for most US exchanges, and the endpoint is **undocumented / unofficial** (TradingView publishes no REST API). The tool output flags delayed/unofficial data the same way we flag stale quotes; usage is batch-first, read-only, conservatively paced, and attributed.

## Findings from Research

- **Endpoint shape**: `POST https://scanner.tradingview.com/{market}/scan2?label-product=screener-stock` with body `{ markets, symbols:{tickers|query}, columns, filter, sort, range:[offset, offset+limit] }` for this V1 scope. TradingView also supports `filter2` boolean trees, but this change deliberately exposes only flat AND filters until a later spec defines a nested parameter grammar. Response is column-compressed `{ totalCount, fields:[...], symbols:[{ s, f:[...] }], time }`; row limit clamps to ~500. Exchange-qualified quotes can use `global/scan2` with explicit `EXCH:SYM` tickers. Bare symbols such as `AAPL` do **not** resolve through `symbols.tickers`; they require deterministic resolution (default US/`america` `name in_range` lookup for equity watchlists, exact `EXCH:SYM` when known, Yahoo fallback for unresolved/ambiguous rows).
- **Coverage**: ~3,000 fields (shner-elmo) to 13,000+ counting timeframe variants (tvscreener); markets `america` + ~70 country codes, `crypto`, `coin`, `forex`, `futures`, `bond`, `cfd`. Indicators are server-computed and timeframe-suffixed (`RSI|60` = 1h RSI).
- **Access reality**: only the anonymous `scan2` *data* path is keyless and stable. The options-chain-with-greeks path in `himself65/finance-skills` requires harvesting cookies from the TradingView **desktop app** over CDP — explicitly **out of scope** here, as is the login/real-time websocket path (CAPTCHA/account-flagging prone).
- **Stability**: one upstream protocol break in ~3 years (`scan`→`scan2`, v3.0 Jan 2025); residual churn is field/symbol drift. Design hardens against drift, not against total breakage.
- **Rate limits**: undocumented for both TradingView and Yahoo. TradingView's advantage is request *economy* (batching collapses N lookups into 1), not a higher ceiling — so conservative pacing + batching keeps us safe.

## Supplementary projects to borrow logic from

We reimplement in TypeScript; we borrow grammar, field catalogs, and decoding discipline — not code verbatim. Licenses to confirm before lifting any source.

- **`himself65/finance-skills`** — `opencli-plugins/tradingview/lib/scanner.js` + `symbols.js` (MIT, © Alex Yang). Borrow: the `scan2` request body grammar (`buildScreenerBody`), the **position-based `decodeScannerRows`** ("read `fields[]`, never hard-code indices") and `buildTvSymbol(exchange, ticker)`. Use its `filter2` boolean composition only as future reference; nested boolean filters are out of scope for this V1 spec. Its options-chain `index_filters`/desktop-CDP path is useful context but explicitly out of scope.
- **`shner-elmo/TradingView-Screener`** (Python, MIT) — the canonical wrapper. Borrow: the `Column`/filter-operation grammar (`greater`, `in_range`, `crosses_above`, `above%`, …), the ~3,000-field reference catalog, the market path-segment list, and the `scan` vs `scan2` knowledge. Also our stability proxy.
- **`deepentropy/tvscreener`** (Python) — borrow: the 13,000+ field enumeration including timeframe variants, typed market/field enums, and the ~1.0s pacing guidance that informs our rate-limit bucket.
- **`Fynnius/TradingView.Screener`** (C#) and **`ryar001/tradingview-screener-wrapper`** — secondary cross-checks for filter-grammar parity.
