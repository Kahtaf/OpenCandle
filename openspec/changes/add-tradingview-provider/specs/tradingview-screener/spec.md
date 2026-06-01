## ADDED Requirements

### Requirement: TradingView scanner provider (keyless)
The system SHALL provide a `src/providers/tradingview.ts` module exposing `screenStocks(opts)` and `getQuotes(symbols)`, both issuing an unauthenticated JSON `POST` to `scanner.tradingview.com/{market}/scan2`. The provider SHALL use `httpGet` (or equivalent POST helper) from `src/infra/http-client.ts`, call `rateLimiter.acquire("tradingview")` before each request, and require **no API key, login, cookies, or browser**.

#### Scenario: Screener request shape
- **WHEN** `screenStocks({ market: "america", columns: ["name","close","RSI|60"], filter: [{ field: "market_cap_basic", op: "greater", value: 1e9 }], sort: { by: "volume", order: "desc" }, limit: 50 })` is called
- **THEN** a POST is sent to `https://scanner.tradingview.com/america/scan2?label-product=screener-stock` with body containing `markets: ["america"]`, the `columns` list, a `filter` clause `{ left: "market_cap_basic", operation: "greater", right: 1000000000 }`, `sort: { sortBy: "volume", sortOrder: "desc" }`, and `range: [0, 50]`

#### Scenario: Batch quote request shape
- **WHEN** `getQuotes(["AAPL", "MSFT", "NVDA"])` is called
- **THEN** a POST is sent to the `global/scan2` endpoint with `symbols.tickers` set to the resolved TradingView symbols and a default quote column set, returning one row per resolved symbol

#### Scenario: No credentials required
- **WHEN** the provider is used with no environment variables or config set
- **THEN** requests succeed without any credential; the provider never throws `ProviderCredentialError` and is not gated by `getConfig()`

### Requirement: Resilient response decoding
The provider SHALL decode TradingView's column-compressed response `{ fields: string[], symbols: [{ s, f: any[] }] }` by reading each value's position from the response `fields[]` array at decode time. Field indices SHALL NOT be hard-coded. A requested column absent from the response `fields[]` SHALL decode to `null` rather than throwing.

#### Scenario: Position read from response, not hard-coded
- **WHEN** the response `fields` array is in a different order than requested
- **THEN** each value is still mapped to the correct field name (decoded by matching `fields[i]` to `f[i]`)

#### Scenario: Missing column tolerated
- **WHEN** a requested column does not appear in the response `fields`
- **THEN** that field on each decoded row is `null` and no error is thrown

#### Scenario: Empty result
- **WHEN** the response `symbols` array is empty
- **THEN** the provider returns an empty array

### Requirement: Limit clamping and pagination
`screenStocks` SHALL clamp the requested row limit to `[1, 500]` and support an `offset` so the request `range` is `[offset, offset + limit]`.

#### Scenario: Over-cap limit clamped
- **WHEN** `limit: 5000` is requested
- **THEN** the request `range` upper bound is `offset + 500`

#### Scenario: Default limit
- **WHEN** no limit is provided
- **THEN** a default of 50 rows is requested

### Requirement: Filter operation grammar
The provider SHALL map structured filter clauses `{ field, op, value }` to scanner clauses `{ left, operation, right }`, supporting at least the operations `greater`, `egreater`, `less`, `eless`, `equal`, `nequal`, `in_range`, `not_in_range`, `crosses_above`, `crosses_below`, `above%`, `below%`, and `match`.

#### Scenario: Range filter
- **WHEN** a clause `{ field: "RSI", op: "in_range", value: [30, 70] }` is supplied
- **THEN** it maps to `{ left: "RSI", operation: "in_range", right: [30, 70] }`

#### Scenario: Unknown field surfaces a diagnosable error
- **WHEN** the scanner returns a non-OK HTTP status for an invalid field or operation
- **THEN** the provider throws an error including the HTTP status and a truncated response body, rather than returning an empty result silently

### Requirement: Symbol mapping
The provider SHALL provide `buildTvSymbol(exchange, ticker)` producing `EXCH:SYM` (uppercased, trimmed). When a watchlist/quote symbol has no known exchange, the provider SHALL fall back to a `global/scan2` ticker query that lets TradingView resolve the primary listing.

#### Scenario: Exchange-qualified symbol
- **WHEN** `buildTvSymbol("nasdaq", "aapl")` is called
- **THEN** it returns `"NASDAQ:AAPL"`

#### Scenario: Unqualified symbol resolution
- **WHEN** `getQuotes(["AAPL"])` is called with no exchange
- **THEN** the request uses a ticker query that resolves AAPL's primary listing

### Requirement: Rate limiting
The system SHALL configure a `"tradingview"` bucket in `src/infra/rate-limiter.ts` at approximately 1 request/second sustained with a small burst allowance, reflecting the unofficial endpoint's "potential bans" caveat and batch-first usage.

#### Scenario: Rate limiter configured
- **WHEN** the application starts
- **THEN** `rateLimiter.configure("tradingview", ...)` is called with a sustained refill of ~1 req/s

### Requirement: Caching and stale fallback
Results SHALL be cached with `TTL.SCREENER` (60s) and `STALE_LIMIT.SCREENER` (15 min), following the existing provider stale-fallback pattern.

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

### Requirement: Read-only and scope boundaries
The provider SHALL only read scanner data. It SHALL NOT implement options-chain/greeks retrieval (which requires TradingView desktop-app cookies via CDP), real-time/streaming or login-authenticated paths, or historical OHLC candle retrieval.

#### Scenario: No options or history endpoints
- **WHEN** the provider module is reviewed
- **THEN** it exposes only screening and batch-quote reads — no options-greeks, websocket/real-time, login, or candle-history functions
