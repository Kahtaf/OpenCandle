# structured-analysts Specification

## Purpose
Defines structured analyst roles, outputs, debate, synthesis, and validation steps for comprehensive analysis workflows.
## Requirements
### Requirement: Each analyst role has a typed input/output contract
Each analyst role (valuation, momentum, options, contrarian, risk) SHALL define a typed input contract (what evidence it receives) and a typed output contract (what evidence it produces). The output contract SHALL include a signal (`BUY | HOLD | SELL`), conviction score (1-10), thesis string, and an array of evidence records.

#### Scenario: Valuation analyst output contract
- **WHEN** the valuation analyst step completes
- **THEN** its output includes `{ signal: "BUY", conviction: 7, thesis: "...", evidence: [EvidenceRecord, ...] }` with evidence records for P/E, intrinsic value, growth rate, and any unavailable metrics

#### Scenario: Risk analyst output contract
- **WHEN** the risk analyst step completes
- **THEN** its output includes `{ signal: "HOLD", conviction: 5, thesis: "...", evidence: [EvidenceRecord, ...] }` with evidence records for volatility, Sharpe ratio, max drawdown, and VaR

### Requirement: Analyst steps receive prior evidence, not conversation history
Each analyst step SHALL receive the structured evidence records collected so far as input, not the raw conversation history. This prevents reliance on freeform text parsing.

#### Scenario: Momentum analyst receives fetched quote data
- **WHEN** the momentum analyst step runs after the initial data fetch step
- **THEN** it receives the evidence records from the fetch step (quote price, volume, 52-week range) as structured input

#### Scenario: Risk analyst receives all prior analyst evidence
- **WHEN** the risk analyst step runs last among analyst steps
- **THEN** it receives evidence records from valuation, momentum, options, and contrarian steps as structured input

### Requirement: Synthesis consumes structured analyst outputs
The synthesis step SHALL receive an array of typed analyst outputs (signal, conviction, thesis, evidence) and SHALL produce a vote tally, verdict, and key metrics by processing structured data rather than parsing prose.

#### Scenario: Synthesis tallies votes from structured outputs
- **WHEN** synthesis receives 3 BUY signals (convictions 7, 8, 6), 1 HOLD (conviction 5), and 1 SELL (conviction 4)
- **THEN** the vote tally shows "3 BUY, 1 HOLD, 1 SELL — weighted average conviction: 6.2"

#### Scenario: Synthesis cites evidence with provenance
- **WHEN** synthesis references a P/E ratio in its output
- **THEN** it cites the value from the evidence record, not from memory or fabrication

### Requirement: Analyst prompts are generated from step contracts
The prompt text for each analyst role SHALL be generated using the step's input contract and output contract as context, not hardcoded as static template strings. The current `ANALYST_PROMPTS` record SHALL be replaced with prompt generators that reference the typed contracts.

#### Scenario: Prompt includes expected output format
- **WHEN** the valuation analyst prompt is generated
- **THEN** it includes instructions to produce output conforming to the typed output contract (signal, conviction, thesis, evidence records)

#### Scenario: Prompt includes available evidence context
- **WHEN** the contrarian analyst prompt is generated and prior steps have produced evidence for P/E and sentiment
- **THEN** the prompt references the available evidence fields so the analyst knows what data is already collected

### Requirement: Comprehensive Analysis Always Includes Adversarial Debate

The comprehensive analysis workflow SHALL always include the bull case, bear case, rebuttal, and debate-resolving synthesis steps. No configuration flag SHALL gate the debate.

#### Scenario: Debate steps run unconditionally

- **WHEN** a comprehensive analysis workflow is built for a symbol
- **THEN** the workflow includes the bull, bear, and rebuttal debate steps and the debate-aware synthesis and validation prompts
- **AND** no environment variable or file-config setting can select a no-debate variant

#### Scenario: Legacy debate flag is inert

- **WHEN** a user environment still sets `OPENCANDLE_DEBATE`
- **THEN** the value is ignored without failing startup
- **AND** the removal is documented as a breaking configuration change

### Requirement: Workflow steps capture scoped tool evidence
Comprehensive-analysis workflow steps SHALL capture tool executions that occur during the step as structured evidence records without storing full tool results.

#### Scenario: Tool evidence is scoped to the active step
- **WHEN** two workflow steps each execute tools
- **THEN** each step output includes only the evidence records for tools executed during that step
- **AND** prior evidence passed to the next step includes the earlier step's captured evidence

#### Scenario: Tool evidence stores a readable digest
- **WHEN** a tool execution completes during a workflow step
- **THEN** the evidence value includes the tool name, serialized arguments truncated to 500 characters, started/completed timestamps, and a result digest with a 500-character preview plus total serialized length

### Requirement: Analyst and debate steps emit structured parse entries
Comprehensive-analysis analyst and debate steps SHALL parse their final assistant text with the existing structured analyst/debate contracts, store the parsed structure on the step output when valid, and append an `opencandle-analyst-step` custom entry.

#### Scenario: Analyst parse succeeds
- **WHEN** an `analyst_*` step ends with the required signal, conviction, and thesis labels
- **THEN** the step output stores the parsed analyst structure
- **AND** an `opencandle-analyst-step` entry is appended with stage, signal, conviction, and `parsed: true`

#### Scenario: Analyst parse fails after one retry
- **WHEN** an `analyst_*` or `debate_*` step does not include its required labels
- **THEN** the workflow sends exactly one follow-up prompt referencing the existing required output format
- **AND** if the retry still fails, the step output records raw text and an `opencandle-analyst-step` entry with `parsed: false`
- **AND** the workflow continues instead of failing the step

### Requirement: Generated analyst prompts remain deferred in observe-only compliance slice
The observe-only evidence-capture slice SHALL NOT edit analyst prompt templates or replace static analyst prompts with generated prompt contracts.

#### Scenario: Prompt templates remain unchanged
- **WHEN** this change is implemented
- **THEN** `ANALYST_PROMPTS` and debate/synthesis/validation template text remain unchanged
- **AND** generated prompt contract compliance remains documented as deferred future work

### Requirement: Dashboard counts completed analyst steps from custom entries
The GUI dashboard projector SHALL derive active-analysis `analystsDone` from `opencandle-analyst-step` custom entries instead of a hardcoded zero.

#### Scenario: Analyst entries update active dashboard progress
- **WHEN** a session contains an `opencandle-workflow` entry followed by analyst-step custom entries
- **THEN** the projected active analysis reports `analystsDone` equal to the number of matching analyst-step entries

