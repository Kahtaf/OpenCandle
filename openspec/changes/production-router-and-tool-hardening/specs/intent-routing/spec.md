## MODIFIED Requirements

### Requirement: Default Router Mode is LLM

The system SHALL default `OPENCANDLE_ROUTER_MODE` to `"llm"`. The `"rules"` value SHALL remain a valid configuration for one release as a rollback escape hatch, after which it is removed by a separate change.

#### Scenario: Unset env var resolves to llm

- **WHEN** `OPENCANDLE_ROUTER_MODE` is unset
- **THEN** `getConfig().routerMode === "llm"`

#### Scenario: Explicit rules opt-in still works

- **WHEN** `OPENCANDLE_ROUTER_MODE=rules` is set
- **THEN** `getConfig().routerMode === "rules"` and the legacy `classifyIntent` + `extractPreferences` path executes unchanged

### Requirement: Acronym Disambiguation Post-Filter

After entity extraction (in either router mode), the system SHALL apply an acronym disambiguation post-filter to `entities.symbols` that removes tokens belonging to a finance-acronym dictionary unless at least one positive ticker signal is present in the raw user input.

The dictionary SHALL include at minimum: IV, HV, ITM, OTM, ATM, IPO, SEC, FED, FOMC, IRS, ECB, BOE, BOJ, GDP, CPI, PPI, FX, MA, NDA.

A positive ticker signal is defined as one of:
- The raw input contains `$<token>` (case-insensitive),
- The raw input contains the words "ticker", "symbol", or "stock" (whole-word match),
- The token appears in a comma- or "and"-list adjacent to ≥1 candidate token that is NOT in the dictionary.

#### Scenario: Bare acronym with no signal is dropped

- **WHEN** the user says "Compare these assets: IV, ASTS" with no `$`-prefix and no other ticker-like adjacency for IV
- **THEN** `entities.symbols === ["ASTS"]` and IV is dropped via the post-filter
- **AND** an `opencandle-symbol-dropped` custom entry is appended with `{ token: "IV", reason: "no positive ticker signal", source: <mode> }`

#### Scenario: Acronym with `$`-prefix is retained

- **WHEN** the user says "Get me a quote on $IV"
- **THEN** `entities.symbols === ["IV"]` (retained because `$IV` is a positive signal)

#### Scenario: Acronym in mixed list with non-dictionary candidates is retained

- **WHEN** the user says "compare KO, IV, PEP"
- **THEN** `entities.symbols === ["KO","IV","PEP"]` (retained because KO and PEP are non-dictionary candidates in the same list)

#### Scenario: Disambiguation runs in both router modes

- **WHEN** the LLM router emits `entities.symbols: ["IV","ASTS"]` for input "Compare these assets: IV, ASTS"
- **THEN** the post-filter still removes IV before the output reaches the main agent
- **AND** the same drop logic and observability entries apply identically to rules-mode extraction

### Requirement: Numeric Acceptance Gate for Default Flip

Flipping the production default of `OPENCANDLE_ROUTER_MODE` from `"rules"` to `"llm"` SHALL require demonstrated achievement of all three measured targets on the full deterministic fixture set:

| Metric | Threshold |
|---|---|
| Live-eval pass-rate | ≥ 90% |
| p95 router latency | ≤ 1500 ms |
| Cost per router call | ≤ $0.005 |

#### Scenario: Default flip blocked when pass-rate below threshold

- **WHEN** `npm run eval:router-live` reports pass-rate < 90%
- **THEN** the change to `src/config.ts` defaulting `routerMode` to `"llm"` MUST NOT be merged

#### Scenario: Default flip blocked when latency above threshold

- **WHEN** the live eval reports p95 router latency > 1500 ms
- **THEN** the change to `src/config.ts` defaulting `routerMode` to `"llm"` MUST NOT be merged

#### Scenario: Baseline measured with credentials present

- **WHEN** the live eval is run as part of acceptance verification
- **THEN** `ANTHROPIC_API_KEY` (or the configured provider key) MUST be present in the run environment, and the run output MUST be archived under `tests/fixtures/router/eval-baselines/<date>.txt`
