## ADDED Requirements

### Requirement: Composer cashtag autocomplete

The GUI chat composer SHALL open an instrument-candidate popover when the caret is inside a `$`-prefixed token of one or more letters, backed by the GUI server's existing instrument-search route. Accepting a candidate SHALL insert the canonical uppercase `$SYMBOL` cashtag. While the popover is open, Enter SHALL accept the highlighted candidate and SHALL NOT submit the message. Search failure or empty results SHALL close the popover silently. The `/`-opens-catalog behavior on an empty composer is unchanged.

#### Scenario: Autocomplete inserts a canonical cashtag

- **WHEN** the user types `$nv` in the composer and selects the NVDA candidate
- **THEN** the composer text contains `$NVDA ` in place of the typed fragment
- **AND** the message was not submitted by the accepting Enter keypress

#### Scenario: Provider search failure degrades silently

- **WHEN** the instrument-search request fails or returns no candidates
- **THEN** the popover closes and typing continues uninterrupted

### Requirement: Entity chips in chat text

The GUI rich-text renderer SHALL render explicit `$SYMBOL` cashtags in user and assistant text as interactive entity chips, and SHALL render bare uppercase tokens as chips only when the token is in the session's known-symbols set. Linkification SHALL NOT apply inside inline code spans or tool-card raw details. Chip rendering must not alter the surrounding text content.

#### Scenario: Cashtag is always a chip

- **WHEN** an assistant message contains `$NVDA`
- **THEN** it renders as an entity chip for NVDA

#### Scenario: Bare token requires the known-symbols set

- **WHEN** an assistant message contains the bare token `CPI` and `CPI` is not in the known-symbols set
- **THEN** it renders as plain text

#### Scenario: Code spans are exempt

- **WHEN** a message contains `` `$NVDA` `` inside an inline code span
- **THEN** no chip is rendered inside the code span

### Requirement: Known-symbols aggregation

The GUI server dashboard state SHALL include a `knownSymbols` array aggregating (a) symbols from the existing quote-activity watchlist projection, (b) `entities.symbols` from `opencandle-route-context` session entries, and (c) saved portfolio and watchlist symbols — uppercase-normalized, deduplicated, capped at 100.

#### Scenario: Router-resolved symbol becomes linkifiable

- **WHEN** a turn's `opencandle-route-context` entry carries `entities.symbols: ["AMD"]`
- **THEN** the dashboard state's `knownSymbols` includes `AMD`

### Requirement: Entity chip popover

Clicking an entity chip SHALL open a popover showing the symbol's cached quote from the existing server quote snapshot (price, day change, and — when present on the snapshot — freshness/as-of metadata; the company name comes from market-state instrument rows or the search route, as the snapshot carries no name), a "Held" badge when the symbol has saved portfolio lots, and two actions: adding the symbol to a watchlist through the existing GUI tool-invoke path for `manage_watchlist` with explicit session/action ids — enabled only after the symbol resolves through the instrument-search route (unresolved cashtags must not be persisted) — and prefilling the composer with `$SYMBOL `. A symbol with no cached quote SHALL show the actions without price data and without fetching a new quote.

#### Scenario: Held symbol shows position badge

- **WHEN** the user clicks a chip for a symbol present in saved portfolio lots
- **THEN** the popover shows a "Held" badge

#### Scenario: No cached quote degrades to actions only

- **WHEN** the user clicks a chip for a symbol absent from the quote snapshot
- **THEN** the popover shows "no cached quote" with both actions available
- **AND** no new provider fetch is triggered
