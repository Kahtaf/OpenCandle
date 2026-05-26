## Purpose
LLM judge evals assess analysis quality and full workflow behavior outside deterministic CI gates.
## Requirements
### Requirement: Analysis quality scoring (Layer 6)
The eval framework SHALL assess analysis quality using LLM-as-judge with an atomized rubric. Each rubric item SHALL be scored independently as a binary pass/fail. The rubric items SHALL include: data collection completeness, quantitative screen presence, risk check presence, reasoning chain explicitness, and actionable conclusion.

#### Scenario: Full rubric pass
- **WHEN** an agent response references multiple data sources, includes explicit PASS/FAIL screens, mentions risk metrics, chains reasoning from data to conclusion, and provides a directional view with conviction level
- **THEN** the analysis quality score SHALL be 1.0

#### Scenario: Partial rubric pass
- **WHEN** an agent response meets 3 of 5 rubric items
- **THEN** the analysis quality score SHALL be 0.6

#### Scenario: LLM judge consistency via averaging
- **WHEN** an LLM-judge eval runs
- **THEN** the scorer SHALL execute 3 independent judge calls and report the average score

### Requirement: E2E workflow scoring (Layer 7)
The eval framework SHALL assess full conversation workflows including multi-turn interactions and multi-analyst orchestration. Scoring SHALL combine trajectory matching (did the agent follow the expected workflow steps?) with LLM quality assessment of the final output.

#### Scenario: Portfolio builder workflow
- **WHEN** a portfolio builder eval runs with scripted ask_user answers
- **THEN** the scorer SHALL verify the agent followed the expected tool sequence AND the final portfolio recommendation meets quality rubric criteria

#### Scenario: Multi-analyst orchestration
- **WHEN** a comprehensive analysis eval runs
- **THEN** the scorer SHALL verify multiple analyst perspectives were gathered and synthesized

### Requirement: LLM judge configuration
LLM judge scorers SHALL use temperature 0.1, binary pass/fail per rubric item, and few-shot examples (2–3 per rubric item) to maximize scoring consistency. Each rubric item is judged as 0 (fail) or 1 (pass). The per-case score is the fraction of rubric items passed (e.g., 3/5 = 0.6). This normalized 0–1 score is what flows into the baseline and regression system.

#### Scenario: Low temperature scoring
- **WHEN** an LLM judge eval executes
- **THEN** the LLM call SHALL use temperature 0.1

#### Scenario: Binary rubric scoring normalized to 0–1
- **WHEN** an LLM judge scores 5 rubric items and 4 pass
- **THEN** the per-case score SHALL be 0.8 (4/5)

### Requirement: Usually-tier execution
Eval cases with `tier: "usually"` SHALL run separately from CI — either nightly or on manual invocation. They SHALL NOT block PR merges.

#### Scenario: Usually-tier runs on demand
- **WHEN** a developer runs the usually-tier eval command
- **THEN** all `usually`-tier cases execute with 3x averaging and produce a report

#### Scenario: Usually-tier does not run in CI
- **WHEN** the standard `npm test` pipeline runs
- **THEN** `usually`-tier eval cases SHALL be skipped

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

### Requirement: Fixed Prompt Competitive Replay Is Explicit

Competitive benchmark tooling SHALL make same-prompt branch-vs-ref replay an explicit fixed-prompt mode so generic-agent costs and cached-baseline assumptions are visible.

#### Scenario: Competitive replay requires fixed prompts

- **WHEN** a developer compares competitive behavior against a base ref
- **THEN** the harness requires an explicit fixed prompt set or a prior competitive report
- **AND** it records whether competitor answers were live, cached, or unavailable

#### Scenario: OpenCandle self-regression is separated from competitor result

- **WHEN** a branch changes OpenCandle's answer on a fixed prompt
- **THEN** the report compares OpenCandle current-vs-base behavior before interpreting competitor win/loss deltas
- **AND** unsupported base-ref execution is reported as a harness limitation rather than a competitor comparison result

### Requirement: Judge Reports Can Classify Artifact Contract Gaps

LLM judge reports SHALL be able to distinguish a missing structured-answer contract from a missing provider/tool capability or prose-only synthesis weakness.

#### Scenario: Structured work expected but absent

- **WHEN** a prompt would benefit from an exposure map, rebalance action plan, education example table, or source coverage table
- **THEN** the report MAY classify the improvement as an artifact-contract gap
- **AND** it must not imply a rendered workspace artifact exists unless a later implementation provides it

### Requirement: Main Branch Competitive Replay Harness

LLM-judge eval tooling SHALL provide a current-vs-ref competitive replay report for fixed finance prompts without requiring current branch-only code to exist on the base ref.

#### Scenario: Competitive reports are compared across refs

- **WHEN** a developer supplies current and base competitive finance reports for matching fixed prompts
- **THEN** the harness writes a combined comparison report under `tests/evals/runs/`
- **AND** the report includes ref names, report paths, OpenCandle score deltas, winner changes, and cached competitor coverage

#### Scenario: Planning metadata is preserved for parity diagnosis

- **WHEN** competitive report cases include OpenCandle planning metadata
- **THEN** the comparison report preserves current and base planning metadata per prompt
- **AND** regressions can be traced to planning, evidence, answer-contract, structured-check, retry, synthesis, or harness layers

#### Scenario: Unsupported competitive replay is honest

- **WHEN** the selected base ref cannot produce or parse a compatible competitive report
- **THEN** the harness records an unsupported reason
- **AND** it does not count the unsupported run as an OpenCandle win or loss

