## ADDED Requirements

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
