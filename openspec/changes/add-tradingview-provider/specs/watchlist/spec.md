## MODIFIED Requirements

### Requirement: Watchlist price check uses batch quote with fallback
The `watchlist` tool's `check` action SHALL price all watchlist symbols using a single TradingView batch quote (`getQuotes(symbols)`) as the primary path, wrapped in `withFallback` so that on TradingView failure or empty/changed response it reverts to the existing per-symbol Yahoo `getQuote` loop. The action SHALL NOT fan out one request per symbol on the primary path.

#### Scenario: Single batch call for many symbols
- **WHEN** `check` runs against a watchlist of 100+ symbols and TradingView is available
- **THEN** exactly one TradingView batch request is issued (not one request per symbol), and every symbol is priced

#### Scenario: Fallback to Yahoo preserves behavior
- **WHEN** the TradingView batch quote is unavailable or returns no usable rows
- **THEN** the action falls back to the existing per-symbol Yahoo path and produces output equivalent to the prior behavior

#### Scenario: Price alerts unchanged
- **WHEN** a watchlist item has a `targetPrice` or `stopPrice`
- **THEN** target/stop alert detection fires identically whether prices came from the TradingView batch or the Yahoo fallback

#### Scenario: Delayed/unofficial caveat surfaced
- **WHEN** prices are sourced from the TradingView batch path
- **THEN** the output flags the data as TradingView-sourced and possibly ~15-minute delayed from an unofficial endpoint, consistent with `screen_stocks`

#### Scenario: Add and remove actions unaffected
- **WHEN** the `add` or `remove` action is invoked
- **THEN** behavior is unchanged from before this change
