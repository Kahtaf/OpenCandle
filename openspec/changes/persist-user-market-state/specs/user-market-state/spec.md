## ADDED Requirements

### Requirement: User Market State Uses SQLite

OpenCandle SHALL persist user watchlists, portfolios, portfolio lots, prediction records, instruments, and instrument aliases in `~/.opencandle/state.db`.

#### Scenario: Watchlist state is read from SQLite

- **WHEN** a user asks to view their watchlist
- **THEN** OpenCandle reads watchlist rows and items from `state.db`
- **AND** it does not treat `watchlist.json` as authoritative state

#### Scenario: Portfolio state is read from SQLite

- **WHEN** a user asks to view their portfolio
- **THEN** OpenCandle reads portfolio rows and lots from `state.db`
- **AND** it does not treat `portfolio.json` as authoritative state

#### Scenario: Prediction state is read from SQLite

- **WHEN** a user asks to record or check tracked predictions
- **THEN** OpenCandle reads and writes prediction records in `state.db`
- **AND** it does not treat `predictions.json` as authoritative state

### Requirement: Default Watchlist and Portfolio Are Extensible

OpenCandle SHALL provide one default watchlist and one default portfolio while preserving schema support for multiple watchlists and portfolios in a later change.

#### Scenario: Default watchlist is created lazily

- **WHEN** a user adds their first watchlist item and no watchlist exists
- **THEN** OpenCandle creates a default watchlist
- **AND** the new item is attached to that default watchlist

#### Scenario: Default portfolio is created lazily

- **WHEN** a user adds their first portfolio lot and no portfolio exists
- **THEN** OpenCandle creates a default portfolio
- **AND** the new lot is attached to that default portfolio

#### Scenario: Schema does not assume only one collection

- **WHEN** the database schema is inspected
- **THEN** watchlist items refer to a watchlist id
- **AND** portfolio lots refer to a portfolio id
- **AND** uniqueness constraints are scoped to the owning watchlist or portfolio where appropriate

#### Scenario: Watchlist contains one row per instrument

- **WHEN** the same instrument is added to the same watchlist more than once
- **THEN** OpenCandle updates or reports the existing watchlist item
- **AND** it does not create duplicate rows for separate theses in V1

#### Scenario: Only one default exists per collection type

- **WHEN** the database contains watchlists or portfolios
- **THEN** at most one watchlist is marked as default
- **AND** at most one portfolio is marked as default

#### Scenario: Concurrent default creation is safe

- **WHEN** two processes attempt to create the default watchlist or portfolio concurrently
- **THEN** SQLite constraints and transactions preserve at most one default row
- **AND** both callers observe the same default collection after the transaction completes

### Requirement: Instruments and Aliases Normalize Symbols

OpenCandle SHALL store normalized instruments separately from source-specific symbol aliases.

#### Scenario: Provider search creates an instrument

- **WHEN** the user adds a resolved security to a watchlist or portfolio
- **THEN** OpenCandle stores a normalized instrument row with symbol, asset type, exchange, currency, and provider metadata when available
- **AND** the watchlist item or portfolio lot references the instrument id

#### Scenario: Yahoo search supports candidate selection

- **WHEN** the user searches for a company name or partial ticker
- **THEN** OpenCandle can use Yahoo Finance search results as instrument candidates
- **AND** each candidate includes at least symbol, display name when available, quote type, exchange, and provider score when available

#### Scenario: Source-specific symbols are preserved

- **WHEN** an imported row uses a source-specific symbol such as an exchange-prefixed ticker or broker identifier
- **THEN** OpenCandle stores that source symbol in an instrument alias row
- **AND** the alias points at the normalized instrument row

#### Scenario: Alias identity includes disambiguators

- **WHEN** two source aliases have the same bare symbol but differ by source-native id, exchange, or asset type
- **THEN** OpenCandle can store both aliases without collision
- **AND** it does not rely on source plus bare symbol alone as the unique alias identity

### Requirement: JSON Market State Is Not Supported

OpenCandle SHALL NOT support JSON files as market-state sources for watchlists, portfolios, or predictions.

#### Scenario: JSON files are ignored as state

- **WHEN** `watchlist.json`, `portfolio.json`, or `predictions.json` exists under `~/.opencandle/`
- **THEN** OpenCandle reads market state from SQLite
- **AND** it does not import, merge, or trust those JSON files

#### Scenario: Initialization is idempotent

- **WHEN** OpenCandle starts with no market-state tables
- **THEN** it initializes the SQLite schema transactionally
- **AND** repeated startup does not create duplicate default rows

### Requirement: Market-State Schema Upgrades Preserve User Rows

OpenCandle SHALL treat user market state as durable after this feature ships.

#### Scenario: Additive schema upgrade preserves rows

- **WHEN** a later schema version adds market-state tables, columns, or indexes
- **THEN** OpenCandle preserves existing user-authored watchlists, portfolios, prediction records, alert rules, report templates, and import provenance rows
- **AND** it migrates shape additively where possible rather than dropping market-state tables

#### Scenario: Destructive reset requires explicit opt-in

- **WHEN** a schema reset would delete user-authored market-state rows after V1 ships
- **THEN** OpenCandle requires explicit developer or user opt-in
- **AND** it does not perform the reset as a silent compatibility fallback

### Requirement: Instrument Search Supports Add Flows

OpenCandle SHALL provide a shared search/resolve path for adding instruments to watchlists and portfolios.

#### Scenario: Exact symbol resolves directly

- **WHEN** the user adds `AAPL` to a watchlist
- **THEN** OpenCandle resolves the symbol to an instrument
- **AND** adds that instrument to the requested or default watchlist

#### Scenario: Provider currency is preserved

- **WHEN** exact-symbol resolution returns a provider currency such as `CAD`
- **THEN** OpenCandle stores that currency on the normalized instrument
- **AND** it does not overwrite the instrument currency with `USD`

#### Scenario: Unknown portfolio currency requires explicit input

- **WHEN** a user adds a portfolio lot without an explicit lot currency and the resolver cannot determine the instrument currency
- **THEN** OpenCandle asks for or returns a structured need for currency
- **AND** it does not create a USD-denominated lot by default

#### Scenario: Ambiguous search asks for selection

- **WHEN** the user searches for a name or symbol that resolves to multiple plausible instruments
- **THEN** OpenCandle returns the candidates instead of silently choosing one
- **AND** no watchlist item or portfolio lot is created until the user or caller selects a candidate

#### Scenario: Non-interactive ambiguous search returns candidates

- **WHEN** a non-interactive caller attempts to add an ambiguous symbol or company name
- **THEN** OpenCandle returns a structured candidates response or error
- **AND** it does not call an interactive selector or mutate saved state

#### Scenario: No search result does not mutate state

- **WHEN** the user searches for a symbol or name that cannot be resolved
- **THEN** OpenCandle returns no candidates or a resolution failure
- **AND** it does not create a watchlist item, portfolio lot, or unresolved stub instrument

#### Scenario: Misspelled ticker-like input requires confirmation

- **WHEN** the user enters a ticker-like query such as `APL` intending Apple
- **THEN** OpenCandle uses provider-backed search/validation to present plausible candidates
- **AND** it does not add a symbol unless the user or caller selects a resolved candidate such as `AAPL`

#### Scenario: Zero-filled quote responses are invalid for saved state

- **WHEN** exact-symbol validation receives a provider response with zero price, zero volume, and no meaningful range or identity metadata
- **THEN** OpenCandle treats the response as unresolved or invalid
- **AND** it does not save that symbol to a watchlist or portfolio

#### Scenario: Provider failure does not save an unresolved instrument

- **WHEN** provider-backed resolution is unavailable
- **THEN** OpenCandle reports the resolution failure
- **AND** it does not create a saved watchlist item, portfolio lot, or unresolved instrument

#### Scenario: Autocomplete provider failure completes safely

- **WHEN** GUI autocomplete search cannot reach the provider
- **THEN** OpenCandle returns a controlled empty-candidate result with error context
- **AND** the HTTP request does not hang or create saved state

#### Scenario: Alias hit avoids re-resolution

- **WHEN** the user adds a source-specific symbol that already exists in `instrument_aliases`
- **THEN** OpenCandle uses the mapped normalized instrument
- **AND** it does not create a duplicate instrument for the same security

### Requirement: Market State Relationships Have Explicit Delete Semantics

OpenCandle SHALL define foreign-key behavior for market-state rows.

#### Scenario: Deleting a collection removes its child rows

- **WHEN** a watchlist or portfolio is deleted in a future multi-collection flow
- **THEN** its watchlist items or portfolio lots are removed with it

#### Scenario: Referenced instruments are protected

- **WHEN** an instrument is referenced by watchlist items, portfolio lots, prediction records, alert rules, or import history
- **THEN** OpenCandle prevents deleting the instrument unless dependent state is removed first

### Requirement: Market State Writes Are Transactional Across Surfaces

OpenCandle SHALL use SQLite transactions as the concurrency boundary for normal market-state mutations from TUI tools and GUI actions.

#### Scenario: Concurrent surface writes serialize through SQLite

- **WHEN** a TUI tool and GUI action mutate market state at nearly the same time
- **THEN** each mutation runs in an SQLite transaction
- **AND** the resulting saved state is equivalent to a serial order of those mutations

#### Scenario: Session writer lock is not required for normal state writes

- **WHEN** a process does not hold the Pi session writer lock
- **THEN** it may still perform authorized market-state mutations through the shared service
- **AND** it must not run background alert/report work that could duplicate another writer's work

#### Scenario: Same-row concurrent edits return committed state

- **WHEN** two surfaces update the same watchlist item, portfolio lot, prediction record, alert rule, or report template near the same time
- **THEN** each mutation is committed transactionally with an updated timestamp or equivalent change marker
- **AND** callers receive or can refetch the committed row after the write
- **AND** later reads show the final SQLite-committed state rather than stale local form state

### Requirement: Prediction Lifecycle Is Explicit

OpenCandle SHALL represent prediction status and check behavior consistently across TUI and GUI.

#### Scenario: Prediction is recorded open

- **WHEN** a user records a prediction
- **THEN** OpenCandle stores the instrument, direction, conviction, entry price, opened time, expiration time, and optional target price
- **AND** the prediction starts with status `open`

#### Scenario: Prediction check evaluates open records

- **WHEN** a user checks predictions
- **THEN** OpenCandle compares each open prediction against current quote data when available
- **AND** it reports unresolved predictions without fabricating results when quote data is unavailable

#### Scenario: Quote-unavailable prediction remains retryable

- **WHEN** a prediction check cannot obtain current quote data for an open prediction
- **THEN** OpenCandle reports a data gap for that prediction
- **AND** it leaves the prediction `open` with no resolved timestamp or final result so a later check can retry it

#### Scenario: Stale or zero-filled prediction quote remains retryable

- **WHEN** a prediction check receives stale cached quote data or a zero-filled quote payload
- **THEN** OpenCandle treats that quote as unavailable for prediction scoring
- **AND** it leaves the prediction `open` with no resolved timestamp or final result

#### Scenario: Expired prediction is marked explicitly

- **WHEN** an open prediction is past its expiration time during a check
- **THEN** OpenCandle marks it `expired` or `resolved` according to the defined prediction outcome policy only when current quote data is available
- **AND** stores result metadata needed to explain the outcome later

#### Scenario: Resolved prediction history remains visible

- **WHEN** all tracked predictions have already been resolved and the user checks predictions again
- **THEN** OpenCandle reports the durable historical scorecard from stored result metadata
- **AND** it does not replace the scorecard with an empty "no open predictions" result

#### Scenario: Expired prediction with missing quote remains open

- **WHEN** an open prediction is past its expiration time during a check but current quote data is unavailable
- **THEN** OpenCandle reports the unavailable quote as a data gap
- **AND** it does not mark the prediction `expired` until a later check can evaluate it with market data

#### Scenario: Prediction can be cancelled without outcome

- **WHEN** a user cancels a prediction before resolution
- **THEN** OpenCandle marks it `cancelled`
- **AND** it excludes the record from hit-rate calculations unless the user explicitly asks for cancelled history
