## ADDED Requirements

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
