# watchlist Specification

## Purpose
TBD - created by archiving change add-tradingview-provider. Update Purpose after archive.
## Requirements
### Requirement: Watchlist price check uses batch quote with fallback
The `manage_watchlist` tool's `check` action SHALL price equity-like watchlist symbols using TradingView batch quotes (`getQuotes(symbols)`) as the primary path. It SHALL invoke TradingView through `wrapProvider("tradingview", ...)` so provider failure is represented as `unavailable`. If TradingView is unavailable, returns no usable rows, or the response shape changes enough to be unsafe, the action SHALL revert to the existing per-symbol Yahoo `getQuote` loop for the whole list. If TradingView returns a partial usable result, the action SHALL preserve the successful TradingView rows and fill missing/unresolved symbols through the existing Yahoo path. The action SHALL NOT fan out one request per symbol on the primary path.

#### Scenario: Single batch call for many symbols
- **WHEN** `check` runs against a watchlist of 100+ symbols and TradingView is available
- **THEN** the primary path issues batch TradingView requests rather than one request per symbol
- **AND** all bare US equity symbols are resolved in one TradingView POST
- **AND** every symbol is priced or explicitly filled by Yahoo fallback

#### Scenario: Full fallback to Yahoo preserves behavior
- **WHEN** the TradingView batch quote is unavailable or returns no usable rows
- **THEN** the action falls back to the existing per-symbol Yahoo path and produces output equivalent to the prior behavior

#### Scenario: Partial fallback fills unresolved symbols
- **WHEN** the TradingView batch quote returns prices for only some watchlist symbols
- **THEN** the action uses the returned TradingView prices for those symbols
- **AND** it calls Yahoo only for missing/unresolved symbols
- **AND** the output still includes every watchlist item

#### Scenario: Bare symbols resolve safely
- **WHEN** the watchlist contains bare symbols such as `AAPL`, `MSFT`, `BRK.A`, or `SPY`
- **THEN** the TradingView path resolves them to primary US listings rather than unqualified `global/scan2` ticker queries
- **AND** ambiguous or unresolved rows are handed to Yahoo fallback instead of being mapped to a foreign/CDR listing

#### Scenario: Yahoo-style suffixes skip TradingView
- **WHEN** the watchlist contains symbols such as `BTC-USD`, `RY.TO`, `BMW.DE`, or `7203.T`
- **THEN** those symbols are treated as unresolved for TradingView and priced through Yahoo fallback unless saved with explicit TradingView `EXCH:SYM` qualification

#### Scenario: Price alerts unchanged
- **WHEN** a watchlist item has a `targetPrice` or `stopPrice`
- **THEN** target/stop alert detection fires identically whether prices came from the TradingView batch or the Yahoo fallback

#### Scenario: Delayed/unofficial caveat surfaced
- **WHEN** prices are sourced from the TradingView batch path
- **THEN** those rows are flagged as TradingView-sourced and possibly ~15-minute delayed from an unofficial endpoint, consistent with `screen_stocks`
- **AND** Yahoo-filled rows are not labeled with the TradingView delayed/unofficial caveat

#### Scenario: Add and remove actions unaffected
- **WHEN** the `add` or `remove` action is invoked
- **THEN** behavior is unchanged from before this change

