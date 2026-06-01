## ADDED Requirements

### Requirement: TradingView scanner provider (keyless)
The system SHALL provide a `src/providers/tradingview.ts` module exposing `screenStocks(opts)` and `getQuotes(symbols)`, both issuing an unauthenticated JSON `POST` to `scanner.tradingview.com/{market}/scan2`. The provider SHALL use a shared POST-capable helper from `src/infra/http-client.ts`, call `rateLimiter.acquire("tradingview")` before each request, follow the same cache/rate-limit/stale-fallback provider pattern as `src/providers/yahoo-finance.ts`, and require **no API key, login, cookies, or browser**.

#### Scenario: Screener request shape
- **WHEN** `screenStocks({ market: "america", columns: ["name","close","RSI|60"], filter: [{ field: "market_cap_basic", op: "greater", value: 1e9 }], sort: { by: "volume", order: "desc" }, limit: 50 })` is called
- **THEN** a POST is sent to `https://scanner.tradingview.com/america/scan2?label-product=screener-stock` with body containing `markets: ["america"]`, the `columns` list, a `filter` clause `{ left: "market_cap_basic", operation: "greater", right: 1000000000 }`, `sort: { sortBy: "volume", sortOrder: "desc" }`, and `range: [0, 50]`

#### Scenario: Batch quote request shape
- **WHEN** `getQuotes(["NASDAQ:AAPL", "NASDAQ:MSFT", "NASDAQ:NVDA"])` is called with exchange-qualified TradingView symbols
- **THEN** a POST is sent to the `global/scan2` endpoint with `symbols.tickers` set to those exact symbols and a default quote column set, returning one row per resolved symbol

#### Scenario: Bare equity quote resolution
- **WHEN** `getQuotes(["AAPL", "MSFT", "BRK.A", "SPY"])` is called with bare equity/watchlist symbols
- **THEN** the provider does not send `symbols.tickers: ["AAPL", ...]` because bare tickers do not resolve through that path
- **AND** it performs a deterministic primary-listing lookup, defaulting to the US `america` scanner with the concrete filter clauses `{ left: "name", operation: "in_range", right: ["AAPL", "MSFT", "BRK.A", "SPY"] }`, `{ left: "is_primary", operation: "equal", right: true }`, and `{ left: "type", operation: "in_range", right: ["stock", "fund", "dr"] }`
- **AND** it returns rows mapped back to the original requested symbols without choosing foreign/CDR listings ahead of the primary US listing

#### Scenario: Mixed qualified and bare quote request
- **WHEN** `getQuotes(["NASDAQ:AAPL", "MSFT"])` is called
- **THEN** the provider sends at most one `global/scan2` POST for qualified tickers and at most one `america/scan2` POST for bare tickers
- **AND** each POST acquires a separate `tradingview` rate-limit token
- **AND** returned rows are merged by original requested symbol while preserving caller order

#### Scenario: No credentials required
- **WHEN** the provider is used with no environment variables or config set
- **THEN** requests succeed without any credential; the provider never throws `ProviderCredentialError` and is not gated by `getConfig()`

### Requirement: Resilient response decoding
The decoder SHALL have the signature `decodeScannerRows(payload, requestedColumns)` and decode TradingView's column-compressed response `{ fields: string[], symbols: [{ s, f: any[] }] }` by reading each value's position from the response `fields[]` array at decode time. Field indices SHALL NOT be hard-coded. Because TradingView omits a requested column from the response `fields[]` when it has no value, the decoder SHALL use `requestedColumns` to backfill any requested column missing from `fields[]` as `null` on every row, so downstream formatting never sees `undefined` keys. Decoding SHALL NOT throw on a missing column.

#### Scenario: Position read from response, not hard-coded
- **WHEN** the response `fields` array is in a different order than requested
- **THEN** each value is still mapped to the correct field name (decoded by matching `fields[i]` to `f[i]`)

#### Scenario: Missing column backfilled as null
- **WHEN** a requested column does not appear in the response `fields`
- **THEN** the decoder uses `requestedColumns` to set that field to `null` (not `undefined`) on every decoded row, and no error is thrown

#### Scenario: Empty result
- **WHEN** the response `symbols` array is empty
- **THEN** the provider returns an empty array

### Requirement: Limit clamping and pagination
`screenStocks` SHALL clamp the requested row limit to `[1, 500]` and support an `offset` so the request `range` is `[offset, offset + limit]`.

#### Scenario: Over-cap limit clamped
- **WHEN** `limit: 5000` is requested
- **THEN** the request `range` upper bound is `offset + 500`

#### Scenario: Below-minimum limit defaults
- **WHEN** `limit: 0` or a negative limit is requested
- **THEN** a default of 50 rows is requested

#### Scenario: Default limit
- **WHEN** no limit is provided
- **THEN** a default of 50 rows is requested

### Requirement: Filter operation grammar
The provider SHALL map flat structured filter clauses `{ field, op, value }` to scanner clauses `{ left, operation, right }`, supporting at least the operations `greater`, `egreater`, `less`, `eless`, `equal`, `nequal`, `in_range`, `not_in_range`, `crosses`, `crosses_above`, `crosses_below`, `above%`, `below%`, `match`, `nmatch`, `has`, `has_none_of`, `empty`, and `nempty`. V1 SHALL treat multiple filter clauses as flat AND conditions. Boolean `filter2` composition is out of scope unless a later change adds an explicit nested parameter grammar.

#### Scenario: Range filter
- **WHEN** a clause `{ field: "RSI", op: "in_range", value: [30, 70] }` is supplied
- **THEN** it maps to `{ left: "RSI", operation: "in_range", right: [30, 70] }`

#### Scenario: Unknown field surfaces a diagnosable error
- **WHEN** the scanner returns a non-OK HTTP status for an invalid field or operation
- **THEN** the provider throws an error including the HTTP status and a truncated response body, rather than returning an empty result silently

### Requirement: Symbol mapping
The provider SHALL provide `buildTvSymbol(exchange, ticker)` producing `EXCH:SYM` (uppercased, trimmed). When a watchlist/quote symbol has no known exchange, the provider SHALL use deterministic bare-symbol resolution rather than relying on `global/scan2` `symbols.tickers` with unqualified symbols.

#### Scenario: Exchange-qualified symbol
- **WHEN** `buildTvSymbol("nasdaq", "aapl")` is called
- **THEN** it returns `"NASDAQ:AAPL"`

#### Scenario: Unqualified symbol resolution
- **WHEN** `getQuotes(["AAPL"])` is called with no exchange
- **THEN** the request resolves AAPL through the US `america` scanner by exact `name` matching and primary-listing filters
- **AND** the returned row maps to `NASDAQ:AAPL`

#### Scenario: Multiple listing disambiguation
- **WHEN** more than one TradingView row matches the same requested bare symbol
- **THEN** the provider chooses deterministically by exact `name`, `market === "america"`, `is_primary === true` when present, `type` precedence `stock` then `fund` then `dr`, exchange precedence `NASDAQ` then `NYSE` then `AMEX`, and finally lexicographic `s`
- **AND** if rows remain equivalent after that ordering, the symbol is marked unresolved for caller-level fallback

#### Scenario: Yahoo-style suffixes skip bare US lookup
- **WHEN** `getQuotes(["BTC-USD", "RY.TO", "BMW.DE", "7203.T"])` is called without explicit TradingView exchange qualification
- **THEN** those symbols are returned as unresolved for caller-level fallback rather than sent to the US `america` bare-symbol lookup

#### Scenario: Unresolved symbols are explicit
- **WHEN** a bare symbol cannot be resolved by the TradingView scanner
- **THEN** the provider returns that symbol as unresolved for caller-level fallback instead of fabricating a quote or mapping to a different market

### Requirement: Batch quote columns
`getQuotes` SHALL request a fixed minimum quote column set needed by watchlist rendering and source attribution: `name`, `close`, `change`, `change_abs`, `volume`, `exchange`, `market`, `description`, `type`, and `typespecs`.

#### Scenario: Watchlist quote columns present
- **WHEN** `getQuotes` builds a TradingView batch quote request
- **THEN** the request `columns` include `name`, `close`, `change`, `change_abs`, `volume`, `exchange`, `market`, `description`, `type`, and `typespecs`
- **AND** watchlist mapping does not depend on columns outside this fixed minimum set

### Requirement: Rate limiting
The system SHALL configure a `"tradingview"` bucket in `src/infra/rate-limiter.ts` at approximately 1 request/second sustained with a small burst allowance, reflecting the unofficial endpoint's "potential bans" caveat and batch-first usage.

#### Scenario: Rate limiter configured
- **WHEN** the application starts
- **THEN** `rateLimiter.configure("tradingview", ...)` is called with a sustained refill of ~1 req/s

### Requirement: Caching and stale fallback
Results SHALL be cached with `TTL.SCREENER` (60s) and `STALE_LIMIT.SCREENER` (15 min), following the existing provider stale-fallback pattern. Cache keys SHALL be stable canonical JSON over the effective request body, including endpoint, market, symbols, columns, filters, sort, offset, and limit, so equivalent request objects do not miss cache due to object key order.

#### Scenario: Repeated query within TTL
- **WHEN** the same screen/quote query is issued within 60 seconds
- **THEN** the cached result is returned without a new request

#### Scenario: Stale fallback on failure
- **WHEN** a request fails but a cached result exists within `STALE_LIMIT.SCREENER`
- **THEN** the stale cached data is returned and flagged stale

### Requirement: `screen_stocks` tool
The system SHALL provide a `screenStocksTool` (name `screen_stocks`) in `src/tools/market/screen-stocks.ts`, registered in `src/tools/index.ts`, exposing market screening to the agent with Typebox params `market`, `columns`, `filter`, `sort`, and `limit`.

#### Scenario: Successful screen
- **WHEN** the agent invokes `screen_stocks` with a valid filter
- **THEN** the tool returns formatted rows and a caveat noting the data is TradingView-sourced, possibly ~15-minute delayed, and from an unofficial endpoint

#### Scenario: Provider unavailable
- **WHEN** the provider returns `unavailable` (e.g. endpoint failure with no stale cache)
- **THEN** the tool returns a structured "screening unavailable" message and never fabricates rows

### Requirement: Tool routing and usage guidance
The system SHALL expose `screen_stocks` through OpenCandle's active-tool selection and prompt/tool catalog so the agent can choose the right data tool. Registration in `getAllTools()` alone is insufficient; the tool SHALL be included in the relevant route bundle and described in the tool catalog.

#### Scenario: Core market bundle exposes screening
- **WHEN** a finance route selects the `core_market` tool bundle
- **THEN** `screen_stocks` is included in the active tool names alongside `get_stock_quote`, `get_stock_history`, and related market tools

#### Scenario: Breadth prompt uses screening
- **WHEN** the user asks a breadth query such as "screen for US large caps with RSI below 30" or "which mega-cap tech stocks are down more than 3% today"
- **THEN** the agent has `screen_stocks` available and the tool catalog guides it to use `screen_stocks` instead of fanning out repeated single-symbol quote calls

#### Scenario: Single-symbol quote remains Yahoo-backed
- **WHEN** the user asks "what is AAPL trading at?", requests historical OHLCV, asks for an options chain, or starts a DCF/fundamental analysis workflow
- **THEN** the agent continues to use the existing Yahoo-backed quote/history/options tools and relevant fundamentals tools rather than `screen_stocks`

#### Scenario: Non-market bundles do not expose screening
- **WHEN** active tool selection includes only macro, sentiment, or SEC bundles without `core_market`
- **THEN** `screen_stocks` is not included in the active tool names

### Requirement: Shared POST helper
The system SHALL add or reuse a shared POST-capable HTTP helper in `src/infra/http-client.ts` before implementing `scannerFetch`. The helper SHALL preserve the current `httpGet` timeout, retry, JSON parsing, and `HttpError` body-capture semantics.

#### Scenario: TradingView provider uses shared HTTP behavior
- **WHEN** `scannerFetch` sends a `scan2` request
- **THEN** it uses the shared POST helper with a JSON body and does not implement provider-local retry/error parsing
- **AND** it sends `Content-Type: application/json`, `Origin: https://www.tradingview.com`, `Referer: https://www.tradingview.com/`, and a browser-like `User-Agent` unless live harness validation proves an OpenCandle-specific UA works

#### Scenario: Client errors remain diagnosable
- **WHEN** TradingView returns a 4xx response for an invalid field or operation
- **THEN** the POST helper throws `HttpError` with the status and truncated body available to the provider/tool layer, and does not retry the client error

### Requirement: Read-only and scope boundaries
The provider SHALL only read scanner data. It SHALL NOT implement options-chain/greeks retrieval (which requires TradingView desktop-app cookies via CDP), real-time/streaming or login-authenticated paths, or historical OHLC candle retrieval.

#### Scenario: No options or history endpoints
- **WHEN** the provider module is reviewed
- **THEN** it exposes only screening and batch-quote reads — no options-greeks, websocket/real-time, login, or candle-history functions
