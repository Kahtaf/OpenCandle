## ADDED Requirements

### Requirement: Judge Rubrics Distinguish Product Layers

LLM-judge evals SHALL distinguish between routing, planning, evidence-plan, tool-capability, evidence-normalization, answer-contract, structured-check, retry-eligibility, synthesis, and judge/harness failures when reporting OpenCandle improvement ideas.

#### Scenario: Judge identifies missing capability

- **WHEN** OpenCandle loses because required data capability is absent, such as exact ETF holdings overlap
- **THEN** the judge report labels the improvement as a tool-capability or evidence-source gap rather than recommending a new global prompt clause

#### Scenario: Judge identifies synthesis weakness

- **WHEN** route, plan, tools, and evidence are correct but the final prose fails to answer directly
- **THEN** the judge report labels the improvement as synthesis or answer-contract execution

### Requirement: Competitive Reruns Compare Planning Behavior

Competitive benchmark reports SHALL include planning metadata alongside route, tool, and final-answer information so fixed-prompt reruns can compare whether a migration changed internal behavior.

#### Scenario: Competitive report includes planning metadata

- **WHEN** a competitive benchmark run completes
- **THEN** the report includes planning version, task family, commitment mode, policy card, evidence plan, answer contract, structured checks, workspace/artifact placeholders, capability gaps, structured-check failures, and retry eligibility when available

#### Scenario: Cached baseline rerun compares internal OpenCandle behavior

- **WHEN** a fixed-prompt rerun uses cached generic-agent baselines
- **THEN** the OpenCandle before/after comparison can inspect route, task family, tool calls, evidence records, structured checks, and final answer

#### Scenario: OpenCandle parity is compared before competitor score

- **WHEN** a competitive rerun evaluates a migrated prompt
- **THEN** the report first compares current OpenCandle baseline behavior against migrated OpenCandle behavior
- **AND** an OpenCandle self-regression blocks treating a competitor win/loss change as an improvement

#### Scenario: Hard parity assertions outrank judge wins

- **WHEN** the judge prefers the migrated answer but a required route, tool, evidence, provider-gap, or final-answer hard assertion fails
- **THEN** the report treats the change as a regression unless the parity ledger records it as an accepted improvement

#### Scenario: Competitive report compares expected artifacts

- **WHEN** a fixed-prompt rerun covers sentiment source gaps, SEC filings, ETF overlap, retail tradeoffs, or backtests
- **THEN** the report can compare minimal evidence records, source metadata, artifact placeholders, or capability-gap IDs in addition to final prose quality
- **AND** it does not require full workspace artifact generation in V1

### Requirement: Prompt-Clause Additions Require Layer Justification

LLM-judge-driven improvement workflows SHALL classify each loss before adding prompt text. A new global prompt clause SHALL be allowed only when the failure cannot be addressed by routing, planning, evidence, tool capability, answer contract, structured checks, future semantic validators, or targeted policy card changes.

#### Scenario: Routing failure does not add prompt clause

- **WHEN** a competitive loss is caused by a wrong route or task family
- **THEN** the improvement workflow targets router/planner behavior rather than adding a global synthesis instruction

#### Scenario: Policy card absorbs scenario-specific behavior

- **WHEN** a competitive loss is caused by missing task-specific answer obligations
- **THEN** the improvement workflow adds or updates a task policy card or answer contract rather than the global prompt

#### Scenario: Capability gap blocks prompt-only fix

- **WHEN** a competitive loss requires unavailable data or computation
- **THEN** the improvement workflow records a capability gap and follow-up tool/meta-tool need
- **AND** it does not add a policy card that implies the capability exists

#### Scenario: Prompt-clause deletion requires parity evidence

- **WHEN** a judge-driven improvement recommends removing or shrinking prompt guidance
- **THEN** the workflow checks the parity ledger first
- **AND** deletion is blocked unless current OpenCandle behavior is preserved or the changed behavior is explicitly accepted

### Requirement: Retail Prompt Benchmark Set

Competitive benchmark review SHALL maintain a fixed retail-investor prompt set for before/after migration comparison.

#### Scenario: Retail prompt families are covered

- **WHEN** migration benchmark prompts are selected
- **THEN** they include sentiment source gaps, filing thesis review, market-closed "today" move, ticker alias, unknown ticker earnings risk, ETF overlap, dividend-vs-growth ETF tradeoff, brokerage choice, safe cash products, crypto sizing, mortgage-vs-investing, and followups

#### Scenario: Specialist comparability is reported as scorecard until baselines exist

- **WHEN** V1 competitive reports discuss specialist finance agents
- **THEN** they use a capability scorecard and gap taxonomy rather than claiming direct benchmark parity with Dexter, LangAlpha, TradingAgents, FinRobot, or EDGAR-specialist tools
- **AND** direct specialist-agent baselines require a later benchmark integration before they are used as pass/fail criteria
