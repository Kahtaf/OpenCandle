## ADDED Requirements

### Requirement: Deterministic validation runs before LLM validation
The runtime SHALL execute deterministic validation checks on structured evidence records before any LLM-based validation prompt. Deterministic validation SHALL produce a `ValidationResult` listing passes, failures, and warnings.

#### Scenario: Validation runs after evidence collection
- **WHEN** all analyst steps have produced evidence records for a comprehensive analysis
- **THEN** the deterministic validator runs before the LLM synthesis/validation step

#### Scenario: Validation result is structured
- **WHEN** validation completes
- **THEN** the result contains arrays of `passes`, `failures`, and `warnings`, each with a human-readable message and the evidence record that triggered it

### Requirement: Cited numbers must match tool results
The validator SHALL check that numerical values referenced in evidence records match the values returned by the corresponding tool calls. A mismatch SHALL be recorded as a validation failure.

#### Scenario: Matching number passes validation
- **WHEN** an evidence record cites P/E of 25.3 and the tool result for `get_company_overview` returned P/E of 25.3
- **THEN** validation passes for that data point

#### Scenario: Mismatched number fails validation
- **WHEN** an evidence record cites revenue of $50B but the tool result returned $45B
- **THEN** validation records a failure: "Revenue mismatch: evidence says $50B, tool returned $45B"

### Requirement: Market-sensitive values must have timestamps
The validator SHALL check that all market-sensitive evidence records (prices, volumes, ratios derived from prices) include a `timestamp` in their provenance. Missing timestamps SHALL be recorded as validation warnings.

#### Scenario: Price with timestamp passes
- **WHEN** a stock price evidence record includes `provenance.timestamp: "2026-04-02T14:30:00Z"`
- **THEN** validation passes for that data point

#### Scenario: Price without timestamp warns
- **WHEN** a stock price evidence record has no timestamp in provenance
- **THEN** validation records a warning: "Market-sensitive value 'Stock Price' has no timestamp"

### Requirement: Options expiries must be grounded against current date
The validator SHALL check that any options expiry dates referenced in evidence records are valid future dates relative to today's date. Past expiry dates SHALL be recorded as validation failures.

#### Scenario: Future expiry passes
- **WHEN** an options evidence record references expiry "2026-05-16" and today is "2026-04-02"
- **THEN** validation passes

#### Scenario: Past expiry fails
- **WHEN** an options evidence record references expiry "2026-03-15" and today is "2026-04-02"
- **THEN** validation records a failure: "Options expiry 2026-03-15 is in the past"

### Requirement: Missing required data must be explicitly labeled
The validator SHALL check that required fields for the current workflow are either present with valid provenance or explicitly marked as `unavailable`. Fields that are silently absent (no evidence record at all) SHALL be recorded as validation failures.

#### Scenario: Explicitly unavailable field passes
- **WHEN** a required field "Free Cash Flow" has an evidence record with `source: "unavailable"`
- **THEN** validation passes (the absence is acknowledged)

#### Scenario: Silently missing field fails
- **WHEN** a required field "Market Cap" has no evidence record at all
- **THEN** validation records a failure: "Required field 'Market Cap' has no evidence record"

### Requirement: LLM validation remains as a complementary second layer
The existing LLM validation prompt SHALL continue to run after deterministic validation. It SHALL receive the deterministic validation result as context so it can focus on higher-order consistency checks rather than re-checking numbers.

#### Scenario: LLM validation receives deterministic results
- **WHEN** deterministic validation completes with 2 warnings and 0 failures
- **THEN** the LLM validation prompt includes the deterministic results so it knows what has already been verified
