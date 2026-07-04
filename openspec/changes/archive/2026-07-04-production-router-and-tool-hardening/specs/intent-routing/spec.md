## MODIFIED Requirements

### Requirement: Single LLM Router Call per Turn

The system SHALL invoke a single LLM-based router call on every user turn before system-prompt assembly. The router SHALL emit a structured JSON output containing route classification, entities, slots with provenance, preference updates, and a `missing_required` list. The LLM router is the default and only production routing path; no rules-mode primary dispatch exists.

#### Scenario: Router runs on every turn

- **WHEN** the user submits a turn through `pi.on("input")`
- **THEN** exactly one router LLM call is made before the main-agent prompt is assembled

#### Scenario: Unset router mode uses the LLM router

- **WHEN** `OPENCANDLE_ROUTER_MODE` is unset
- **THEN** OpenCandle routes input through the LLM router

#### Scenario: Explicit llm mode uses the LLM router

- **WHEN** `OPENCANDLE_ROUTER_MODE=llm` is set
- **THEN** OpenCandle routes input through the LLM router

#### Scenario: Rules mode is rejected with migration guidance

- **WHEN** `OPENCANDLE_ROUTER_MODE=rules` is set
- **THEN** config loading fails fast with an error explaining that the rules router was removed and the variable should be unset

#### Scenario: Router output is structured and validated

- **WHEN** the router returns a response
- **THEN** the response is parsed and validated against the defined JSON schema; on validation failure, one retry is attempted with error feedback; on persistent failure, the router emits a minimal fallback output (`route: "fallback"`, extracted symbols only, empty slots, empty preference_updates, empty missing_required)

### Requirement: Deterministic Router as Post-Processor

Deterministic routing code SHALL NOT make the primary route decision. Deterministic code SHALL validate and normalize the LLM output, enforce manifest constraints, compute missing required slots, and produce diagnostics for any correction. Deterministic safety nets — acronym disambiguation via `symbol-disambiguator`, symbol preflight and provider invalid-symbol handling, compare clarification aborts, router validation-failure recovery, and tool validation — SHALL remain active on LLM router output.

#### Scenario: LLM route remains primary

- **WHEN** the router emits valid `routeKind: "agent_task"`
- **THEN** deterministic code does not override it with a legacy keyword route

#### Scenario: Invalid route kind is corrected

- **WHEN** the LLM router emits an invalid route kind
- **THEN** post-processing applies the documented fallback correction and records a diagnostic explaining the correction

#### Scenario: Deterministic safety nets survive rules-router removal

- **WHEN** the legacy rules router is removed as a dispatch path
- **THEN** acronym disambiguation via `symbol-disambiguator`, workflow symbol preflight, provider/tool validation, compare clarification aborts, and router validation-failure recovery continue to run against LLM router output

### Requirement: Rules Router Removal Requires Acceptance Evidence

The legacy rules-router dispatch path SHALL only be removed after the live router eval has been run against the production model with the results recorded in the change, including a classification of every fixture failure. Failures SHALL be either benign model-choice differences (extra informational slots, richer workflow labels with the same route kind, internal diagnostics differences) or individually explained; unexplained route-kind regressions block the removal. The eval diff SHALL compare the routing contract (route kind, workflow, entities, slots, missing required, tool bundles, preference updates) and not internal correction diagnostics, which are model-recording-specific.

#### Scenario: Live eval evidence recorded before removal

- **WHEN** the change removing rules-mode dispatch is prepared
- **THEN** `eval:router-live` has been run with live credentials against the production model
- **AND** the run output is recorded in the change evidence

#### Scenario: Fixture failures classified

- **WHEN** the recorded live eval has non-exact fixtures
- **THEN** each failure is classified as benign model-choice difference, fixture/recording mismatch, or genuine route-quality gap with rationale

#### Scenario: Unexplained route-kind regression blocks removal

- **WHEN** the live eval shows a route-kind disagreement that is not explained and accepted in the evidence record
- **THEN** the rules-router removal does not land until the regression is fixed or the fixture is re-recorded with justification

## ADDED Requirements

### Requirement: Acronym Disambiguation Post-Filter

After LLM router output is parsed, the system SHALL apply an acronym disambiguation post-filter to `entities.symbols` that removes tokens belonging to a finance-acronym dictionary unless at least one positive ticker signal is present in the raw user input.

The dictionary SHALL include at minimum: IV, HV, ITM, OTM, ATM, IPO, SEC, FED, FOMC, IRS, ECB, BOE, BOJ, GDP, CPI, PPI, FX, NDA. `MA` SHALL NOT be blanket-dropped because it is the common Mastercard ticker; moving-average or M&A usage SHALL be handled with context-specific rules instead.

A positive ticker signal is defined as one of:
- The raw input contains `$<token>` (case-insensitive),
- The raw input contains a local phrase that marks that token as a ticker/stock/symbol, such as "IV ticker", "ticker IV", "IV stock", "symbol IV", or "stock IV",
- A future parser emits another explicit per-token ticker marker covered by tests.

Bare comma-list or "and"-list adjacency is not a positive ticker signal.

#### Scenario: Bare acronym with no signal is dropped

- **WHEN** the user says "Compare these assets: IV, ASTS" with no `$`-prefix and no local ticker phrase for IV
- **THEN** `entities.symbols === ["ASTS"]` and IV is dropped via the post-filter
- **AND** an `opencandle-symbol-dropped` custom entry is appended with `{ token: "IV", reason: "no positive ticker signal", source: <mode> }`

#### Scenario: Compare prompt clarifies when a drop leaves too few symbols

- **WHEN** the LLM router receives "Compare these assets: IV, ASTS"
- **AND** IV is dropped as an ambiguous finance acronym
- **THEN** OpenCandle SHALL NOT pass the raw prompt through to the main agent as a comparison request
- **AND** it SHALL append `opencandle-workflow-aborted` with reason `symbol-disambiguation-insufficient-symbols`
- **AND** the next agent turn SHALL receive clarification context instructing it to call `ask_user` before comparison tools

#### Scenario: Acronym with `$`-prefix is retained

- **WHEN** the user says "Get me a quote on $IV"
- **THEN** `entities.symbols === ["IV"]` (retained because `$IV` is a positive signal)

#### Scenario: Bare acronym in mixed list is dropped

- **WHEN** the user says "compare KO, IV, PEP"
- **THEN** `entities.symbols === ["KO","PEP"]`
- **AND** IV is dropped because list context alone is insufficient

#### Scenario: Acronym with local ticker phrase is retained

- **WHEN** the user says "compare KO, the IV ticker, and PEP"
- **THEN** `entities.symbols === ["KO","IV","PEP"]`

#### Scenario: Disambiguation runs after LLM router output

- **WHEN** the LLM router emits `entities.symbols: ["IV","ASTS"]` for input "Compare these assets: IV, ASTS"
- **THEN** the post-filter still removes IV before the output reaches the main agent
- **AND** the same drop logic and observability entries apply regardless of the model output shape

#### Scenario: Dropped symbols are not restored from slots

- **WHEN** the LLM router emits a dropped token in both `entities.symbols` and `slots.symbols`
- **THEN** OpenCandle SHALL remove the token from workflow dispatch symbols
- **AND** router slot merging SHALL NOT reintroduce a token already reported by `symbol_dropped`
- **AND** missing-required-slot checks SHALL use sanitized symbol slots so a single survivor cannot satisfy a multi-symbol workflow

#### Scenario: MA ticker survives plain comparison

- **WHEN** the user says "compare V and MA"
- **THEN** OpenCandle SHALL retain `MA` as the Mastercard ticker

#### Scenario: MA moving-average usage is not a ticker

- **WHEN** the user says "compare the 20 day MA and 50 day MA for SPY"
- **THEN** OpenCandle SHALL NOT treat `MA` as a ticker symbol
