# symbol-detail-page

## ADDED Requirements

### Requirement: Full-canvas layout with detail rail
The symbol page SHALL render as a full-width primary column (hero, chart, key stats, about) with a fixed-width right detail rail (key levels, position, alerts, watchlist membership, analyze actions) at desktop widths, using the shared detail-rail layout primitive, and SHALL stack those regions in priority order at narrower widths.

#### Scenario: Desktop uses the rail
- **WHEN** the page renders at a desktop width where the rail layout is active
- **THEN** the primary column takes the available width, the rail keeps its fixed width, and no centered max-width cap leaves the canvas majority-empty

#### Scenario: Mobile stacks in priority order
- **WHEN** the page renders below the rail breakpoint
- **THEN** content stacks hero, chart, position, key levels, stats, about, then remaining rail cards, with no horizontal page overflow

### Requirement: Hero price block with horizon stat strip
The hero SHALL show price, signed change, currency, and session state, above one stat strip of horizon returns and context stats whose vocabulary comes from the asset-type descriptor. Every stat SHALL derive from fetched quote or history data; a horizon whose history is insufficient SHALL be omitted rather than shown as zero or a placeholder.

#### Scenario: Equity strip
- **WHEN** an equity with sufficient history loads
- **THEN** the strip shows 5D, 1M, YTD, 1Y, from 52-week high, day range, and volume with its multiple of the 30-day average, in tabular numerals with the signed color rule

#### Scenario: Crypto vocabulary
- **WHEN** a crypto instrument loads
- **THEN** the strip uses 1W in place of 5D and a 24-hour range in place of day range, and the session label reflects continuous trading

#### Scenario: Short history omits horizons
- **WHEN** an instrument has less than a year of history
- **THEN** horizons that cannot be computed are absent from the strip, and no stat renders as 0, a dash, or a guessed value

#### Scenario: Loading shows shaped skeletons
- **WHEN** quote or history is still loading
- **THEN** the hero and strip render skeletons shaped like the elements they replace, which stop pulsing under reduced-motion preferences

### Requirement: Key levels with distance and alert tie-in
The page SHALL show a key levels card containing the 52-week high, 52-week low, 20-day moving average, and 50-day moving average, each with its value and signed percent distance from the current price, computed deterministically from fetched history and captioned as calculated from recent price action. Each level SHALL offer a create-alert action that opens the existing alert sheet prefilled with that level as the threshold.

#### Scenario: Levels show value and distance
- **WHEN** sufficient daily history exists
- **THEN** each level row shows its price in the quote's currency and its signed percent distance from the current price

#### Scenario: Create alert prefills the level
- **WHEN** the user activates create-alert on the 50-day moving average row
- **THEN** the alert sheet opens with symbol and threshold prefilled to that level, following the sheet's existing currency and distance-hint behavior

#### Scenario: Insufficient history
- **WHEN** history cannot support a level (for example fewer than 50 bars for the 50-day average)
- **THEN** that row is omitted; the card shows only computable levels, and is omitted entirely when none are computable

### Requirement: Deterministic trend summary
The page SHALL show a trend summary derived only from price versus its 20, 50, and 200-day moving averages, labeling each horizon in plain English and stating one summary sentence. The derivation SHALL be a pure function with unit tests and SHALL NOT involve a model call or invented levels.

#### Scenario: Consistent downtrend
- **WHEN** price is below all three averages
- **THEN** each horizon is labeled below its average and the sentence states that price is below its 20, 50 and 200 day averages

#### Scenario: Mixed signals
- **WHEN** price is above some averages and below others
- **THEN** each horizon is labeled individually and the sentence states that signals are mixed, without asserting a single trend

#### Scenario: Insufficient history hides horizons
- **WHEN** history supports only the 20-day average
- **THEN** only that horizon appears and the sentence covers only computable horizons

### Requirement: Position and saved-state context
The page SHALL show the user's saved context for the symbol: portfolio lots with value and gain when held (following existing portfolio formatting and currency-honesty rules), active alerts on the symbol, and watchlist membership with an add action. When the symbol is not held, the position area SHALL be one quiet line rather than an empty card.

#### Scenario: Held symbol shows the position
- **WHEN** the symbol exists in a saved portfolio and quotes are available
- **THEN** the position card shows lot quantity, value, and gain using the same formatting and honesty rules as the portfolio page

#### Scenario: Not held
- **WHEN** the symbol is in no portfolio
- **THEN** the position area is a single line stating the symbol is not held, with no empty table

### Requirement: Action chips prefill, never send
The page SHALL offer per-symbol action chips that prefill the chat composer or the alert sheet with a described action. Activating a chip SHALL only prefill; it SHALL NOT send a prompt, create an alert, or invoke a tool by itself. Writer-only actions SHALL keep the existing follower degradation.

#### Scenario: Chip prefills the composer
- **WHEN** the user activates an analyze chip
- **THEN** the chat composer receives the prompt text and focus, and nothing is sent until the user submits

#### Scenario: Follower window
- **WHEN** the page renders in a read-only follower window
- **THEN** writer-only actions are disabled with the existing read-only messaging, and no action silently fails

### Requirement: Per-asset-type descriptor drives sections and vocabulary
Section presence, stat vocabulary, and labels SHALL come from an explicit descriptor keyed by instrument type (stock, etf, crypto, fx, index, commodity, unknown) resolved from instrument metadata, replacing string-pattern detection. A section absent from the descriptor SHALL be omitted entirely, never rendered empty. Types without fundamentals SHALL state that availability explicitly. The unknown type SHALL show quote, chart, and saved-state context only.

#### Scenario: Crypto page composition
- **WHEN** a crypto instrument renders
- **THEN** equity fundamentals sections are absent (not empty), the strip uses crypto vocabulary, and saved-state context still appears

#### Scenario: FX is not misclassified
- **WHEN** an FX pair renders
- **THEN** it resolves to the fx descriptor from instrument metadata rather than a ticker string pattern, volume is absent, and no fundamentals section appears

#### Scenario: Unknown type stays minimal and honest
- **WHEN** instrument type cannot be resolved
- **THEN** the page shows quote, chart, and saved-state context only, with an explicit note that further detail is unavailable for this instrument

### Requirement: Surface parity with capability-gated omission
The local GUI and hosted PWA SHALL render the same page from the same components. On hosted, a section whose data requires a capability that is not negotiated SHALL be omitted under the same rules as descriptor omission, never rendered broken or as a hidden credential prompt.

#### Scenario: Hosted missing capability
- **WHEN** the hosted runtime has not negotiated a provider needed by a section
- **THEN** that section is absent, the rest of the page renders normally, and no request is attempted against the missing capability

#### Scenario: Same data, same rendering
- **WHEN** the same symbol with the same available data renders on both surfaces
- **THEN** section composition, stat values, and copy are identical
