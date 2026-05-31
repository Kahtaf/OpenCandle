## MODIFIED Requirements

### Requirement: Router Default Remains Gated

The system SHALL default `OPENCANDLE_ROUTER_MODE` to `"rules"` until a credentialed production-router acceptance gate is green in a follow-up change. The `"llm"` value SHALL remain a valid opt-in configuration for development and evaluation, but this change SHALL NOT promote it to the unset-env default without the gate evidence.

#### Scenario: Unset env var resolves to rules before gate passes

- **WHEN** the acceptance gate has not passed and `OPENCANDLE_ROUTER_MODE` is unset
- **THEN** `getConfig().routerMode === "rules"`
- **AND** a follow-up LLM-default promotion change owns any later default change

#### Scenario: Explicit llm opt-in still works

- **WHEN** `OPENCANDLE_ROUTER_MODE=llm` is set
- **THEN** `getConfig().routerMode === "llm"` and the LLM router path executes with the same post-extraction safety nets

#### Scenario: Explicit rules opt-in still works

- **WHEN** `OPENCANDLE_ROUTER_MODE=rules` is set
- **THEN** `getConfig().routerMode === "rules"` and the rules-based `classifyIntent` + `extractPreferences` path executes unchanged

### Requirement: Acronym Disambiguation Post-Filter

After entity extraction (in either router mode), the system SHALL apply an acronym disambiguation post-filter to `entities.symbols` that removes tokens belonging to a finance-acronym dictionary unless at least one positive ticker signal is present in the raw user input.

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

#### Scenario: Rules-mode compare prompt clarifies when a drop leaves too few symbols

- **WHEN** default rules mode receives "Compare these assets: IV, ASTS"
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

#### Scenario: Disambiguation runs in both router modes

- **WHEN** the LLM router emits `entities.symbols: ["IV","ASTS"]` for input "Compare these assets: IV, ASTS"
- **THEN** the post-filter still removes IV before the output reaches the main agent
- **AND** the same drop logic and observability entries apply identically to rules-mode extraction

#### Scenario: MA ticker survives plain comparison

- **WHEN** the user says "compare V and MA"
- **THEN** OpenCandle SHALL retain `MA` as the Mastercard ticker

#### Scenario: MA moving-average usage is not a ticker

- **WHEN** the user says "compare the 20 day MA and 50 day MA for SPY"
- **THEN** OpenCandle SHALL NOT treat `MA` as a ticker symbol

### Requirement: Numeric Acceptance Gate for Promoting LLM Default

Promoting the production default to `OPENCANDLE_ROUTER_MODE="llm"` SHALL require a follow-up change with demonstrated achievement of all three measured targets on the full deterministic fixture set:

| Metric | Threshold |
|---|---|
| Live-eval pass-rate | ≥ 90% |
| p95 router latency | ≤ 1500 ms |
| Cost per router call | ≤ $0.005 |

#### Scenario: LLM default blocked when pass-rate below threshold

- **WHEN** `npm run eval:router-live` reports pass-rate < 90%
- **THEN** a change that leaves `src/config.ts` defaulting `routerMode` to `"llm"` MUST NOT be merged

#### Scenario: LLM default blocked when latency above threshold

- **WHEN** the live eval reports p95 router latency > 1500 ms
- **THEN** a change that leaves `src/config.ts` defaulting `routerMode` to `"llm"` MUST NOT be merged

#### Scenario: Baseline measured with credentials present

- **WHEN** the live eval is run as part of acceptance verification
- **THEN** `ANTHROPIC_API_KEY` (or the configured provider key) MUST be present in the run environment, and the run output MUST be archived under `tests/fixtures/router/eval-baselines/<date>.txt`
