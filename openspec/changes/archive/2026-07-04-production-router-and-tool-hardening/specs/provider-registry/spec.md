## ADDED Requirements

### Requirement: Quote and Options Providers Surface Unavailable for Zero-Result Responses

`getQuote` and `getOptionsChain` SHALL detect zero-result responses from upstream providers and throw a typed `InvalidSymbolError` rather than returning a successful zero-filled payload. `wrapProvider` SHALL map `InvalidSymbolError` to `unavailable`, and `withFallback` SHALL preserve unavailable status/reason for fallback-backed consumers so all callers see "⚠ … unavailable" instead of "$0.00".

A zero-result quote response is defined as one where ALL of the following fields are simultaneously zero (or absent and therefore defaulted to zero by the provider parser):

- `price`
- `volume`
- `week52High`
- `week52Low`
- `marketCap`

A zero-result options-chain response is defined as one where the upstream `result.options` array is empty AND `quote.regularMarketPrice` is missing or zero.

#### Scenario: Invalid ticker surfaces as unavailable, not $0.00

- **WHEN** `getQuote("XXFAKEXX")` is invoked and Yahoo returns a sparse-meta response with all five fields defaulting to zero
- **THEN** `getQuote` throws `InvalidSymbolError("XXFAKEXX", "yahoo")`
- **AND** `wrapProvider("yahoo", () => getQuote("XXFAKEXX"))` returns `{ status: "unavailable", reason: <error message> }`
- **AND** `withFallback` callers preserve an unavailable result rather than returning zero-filled details
- **AND** the `get_stock_quote` tool emits "⚠ Stock quote unavailable for XXFAKEXX (…)" with no zero-filled `details` payload

#### Scenario: Direct Yahoo tool callers surface unavailable

- **WHEN** a watchlist check, portfolio view, alert check, daily report run, or prediction check calls Yahoo through `wrapProvider` for an invalid zero-result symbol
- **THEN** the tool output includes an unavailable/data-gap status for that symbol
- **AND** no tool result uses zero-filled quote values as valid market data

#### Scenario: Real low-priced stock with non-zero volume is preserved

- **WHEN** `getQuote("PENNY")` returns `price: 0.04, volume: 12000, week52High: 0.20, week52Low: 0.01, marketCap: 50000`
- **THEN** the heuristic does NOT match (volume and 52W fields are non-zero)
- **AND** the quote is returned normally as a successful `StockQuote`

#### Scenario: Empty options chain surfaces as unavailable

- **WHEN** `getOptionsChain("XXFAKEXX")` returns a response where `result.options` is empty and `quote.regularMarketPrice` is missing
- **THEN** `getOptionsChain` throws `InvalidSymbolError("XXFAKEXX", "yahoo")`
- **AND** the consuming tool emits an "unavailable" status rather than a zero-row chain

### Requirement: `analyze_correlation` Supports Partial Success

`analyze_correlation` SHALL return a partial-success matrix computed over the symbols whose history fetch succeeded, when ≥ 2 symbols succeed. The response SHALL list dropped symbols with their wrapped `unavailable` reason.

#### Scenario: One bogus symbol among three valid

- **WHEN** the user runs `analyze_correlation(["AAPL","MSFT","XXFAKEXX"])` and `XXFAKEXX` returns `unavailable`
- **THEN** the matrix is computed for AAPL × MSFT
- **AND** the response includes a "Symbols dropped: XXFAKEXX (…reason)" section
- **AND** the response is NOT marked unavailable

#### Scenario: Only one symbol succeeds

- **WHEN** the user runs `analyze_correlation(["XXFAKEXX","YYBOGUS","AAPL"])` and only AAPL succeeds
- **THEN** the response is unavailable with per-symbol drop reasons for XXFAKEXX and YYBOGUS
- **AND** no matrix is emitted (a 1-symbol matrix carries no information)
