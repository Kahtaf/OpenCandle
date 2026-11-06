## ADDED Requirements

### Requirement: Bounded sourced FX resolution

The system SHALL resolve current FX for USD, EUR, and GBP using validated Yahoo EURUSD=X and GBPUSD=X observations, reciprocals, and a maximum two-leg USD cross. Rates SHALL mean target units per source unit. Identity conversion SHALL require no provider request. Unsupported currency pairs, missing metadata, invalid numeric values, and provider failures SHALL return explicit unavailable reasons, never guessed rates. Each rate SHALL retain provider, pair orientation, symbols, method, observation/fetch times, cache status, and every source leg. Acquisition SHALL use existing cache/rate-limit infrastructure with single-flight and snapshot deduplication.

#### Scenario: EUR holding reported in USD

- **WHEN** a valid EUR security value and eligible EURUSD=X observation exist
- **THEN** reporting value equals native EUR value multiplied by USD-per-EUR rate
- **AND** the saved cost currency does not prevent valuation

#### Scenario: Inverse and cross conversions

- **WHEN** USD→EUR or EUR→GBP is requested
- **THEN** the resolver uses the reciprocal EURUSD=X observation or EURUSD=X divided by GBPUSD=X respectively
- **AND** it exposes all source legs without claiming an independently observed cross quote

#### Scenario: Repeated holdings and failures

- **WHEN** multiple lots and portfolios require the same FX leg in one snapshot
- **THEN** the leg is resolved once and shared, including unavailable results
- **AND** nonpositive rates, unexpected symbols/currencies, and nonfinite results exclude affected rows without disrupting unrelated holdings

### Requirement: Quote units remain distinct from currency codes

The system SHALL preserve raw quote units and normalize explicit GBp/GBX prices to GBP using scale 0.01 before valuation. GBP SHALL remain unscaled. Unknown or irrecoverably ambiguous units SHALL be unavailable. Lot cost units SHALL be treated independently without changing stored lots.

#### Scenario: Pence quote with pound cost

- **WHEN** a raw GBp quote and an explicitly GBP cost lot are valued
- **THEN** price is divided by 100 before comparison or FX conversion
- **AND** quote-unit normalization is separately recorded from any FX conversion

#### Scenario: Stored GBP and new pence acquisition costs

- **WHEN** a stored lot explicitly records GBP
- **THEN** its cost is interpreted in pounds without historical rewrites or uncertainty flags
- **WHEN** a new acquisition cost explicitly uses GBp or GBX
- **THEN** add and update normalize the amount to GBP at scale 0.01, including implicit provider-unit input

### Requirement: FX eligibility uses observation time

The system SHALL reject stale-cache fallbacks and observations missing valid timestamps. REGULAR or unknown-state observations SHALL be at most 15 minutes old. Explicit CLOSED observations SHALL be at most 72 hours old and labeled last-session. Future skew SHALL not exceed 60 seconds. Cross legs SHALL be within 5 minutes of each other and have compatible session states. Security and FX freshness SHALL remain separately visible; fetch time SHALL NOT reset observation age. The US equity calendar SHALL NOT determine FX closure.

#### Scenario: Weekend last-session observation

- **WHEN** a freshly fetched FX observation is explicitly CLOSED and within 72 hours
- **THEN** conversion can use it with its last-session timestamp and label
- **AND** it is not presented as a live executable rate

#### Scenario: Old or inconsistent legs

- **WHEN** an open-state observation exceeds 15 minutes, a closed observation exceeds 72 hours, or cross legs exceed the skew bound
- **THEN** affected conversions are unavailable with a freshness reason

### Requirement: Historical accounting is not fabricated

The system SHALL keep quote currency, lot cost currency, and reporting currency distinct. Native price P&L SHALL be available only when normalized quote and cost currency match. Reporting cost and P&L SHALL be null for foreign-cost lots lacking historical reporting cost. Aggregate reporting cost/P&L SHALL be null unless every lot has known reporting cost and every value is available. Neither current FX nor createdAt/openedAt SHALL synthesize acquisition FX. Cost subtotals SHALL remain grouped by currency. Reporting daily return requiring historical FX SHALL be unavailable in this version.

#### Scenario: Foreign acquisition cost with available current FX

- **WHEN** an EUR-cost lot has an EUR quote and USD reporting currency
- **THEN** its USD market value can be available while USD cost and P&L remain null
- **AND** EUR native price P&L can remain visible with its currency and limitations

#### Scenario: Reporting cost is known

- **WHEN** a lot's cost is explicitly USD and its current EUR quote can be converted to USD
- **THEN** USD price P&L is converted current value minus the known USD cost
- **AND** no historical rate or lot mutation is required

### Requirement: Completeness is shared across surfaces

TUI, local GUI, and hosted GUI SHALL consume one deterministic valuation contract for identical inputs and clock. Status SHALL distinguish empty, complete, partial, and unavailable. Full totalValue SHALL be null for partial/unavailable portfolios, with a separately labeled valuedSubtotal for partial results and explicit excluded lot IDs/reasons. Allocation SHALL use reporting values; partial allocation SHALL be labeled as a share of valued holdings. Null accounting values SHALL never be rendered as zero. Mixed-cost-currency lots SHALL not produce blended costs or P&L by adding unlike currencies.

#### Scenario: One conversion is unavailable

- **WHEN** some holdings are valued and another cannot be converted
- **THEN** status is partial, totalValue is null, and valuedSubtotal plus exclusions are displayed
- **AND** any partial allocation says “of valued holdings” rather than “of portfolio”

#### Scenario: No holdings or no usable data

- **WHEN** a portfolio is empty
- **THEN** status is empty and total value is zero
- **WHEN** a nonempty portfolio has no usable values
- **THEN** status is unavailable with null value/subtotal and explicit reasons

#### Scenario: Reporting currency changes

- **WHEN** only reporting currency changes
- **THEN** every surface recomputes from the same observations without changing quantities, costs, currencies, or dates
- **AND** newly unavailable reporting P&L is disclosed rather than carried over from the previous currency
