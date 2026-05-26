## Purpose
Deterministic evals verify OpenCandle routing, tool use, data faithfulness, risk disclosure, and trace behavior without live judge calls.
## Requirements
### Requirement: Rich trace schema
The test harness SHALL emit a structured trace containing: `prompt`, `classification` (the `ClassificationResult` from the router), `toolCalls` (array of `{ name, args, result }` objects capturing each tool invocation with its arguments and return value), `askUserTranscript` (ordered array of `{ question, answer }` pairs), and `text` (final assistant response). Eval scorers SHALL consume this trace shape.

#### Scenario: Trace captures tool arguments and results
- **WHEN** the agent calls `get_stock_quote` with `{ symbol: "AAPL" }` and receives a result
- **THEN** the trace SHALL contain an entry with `name: "get_stock_quote"`, `args: { symbol: "AAPL" }`, and `result` containing the tool's return value

#### Scenario: Trace captures classification
- **WHEN** the router classifies a prompt as `single_asset_analysis` with confidence 0.95
- **THEN** the trace SHALL contain `classification: { workflow: "single_asset_analysis", confidence: 0.95, ... }`

#### Scenario: Trace captures ask_user exchanges
- **WHEN** the agent asks "What is your risk tolerance?" and receives "conservative"
- **THEN** the trace SHALL contain an `askUserTranscript` entry with `{ question: "What is your risk tolerance?", answer: "conservative" }`

### Requirement: Intent classification scoring (Layer 1)
The eval framework SHALL score whether the agent routes prompts to the correct `WorkflowType`. Scoring SHALL use exact match against an expected workflow type from the set: `single_asset_analysis`, `portfolio_builder`, `options_screener`, `compare_assets`, `watchlist_or_tracking`, `general_finance_qa`. The expected value is sourced from the trace's `classification.workflow` field.

#### Scenario: Correct workflow classification
- **WHEN** an eval case specifies `expectedWorkflow: "single_asset_analysis"` and the trace shows `classification.workflow: "single_asset_analysis"`
- **THEN** the intent classification score SHALL be 1.0

#### Scenario: Incorrect workflow classification
- **WHEN** an eval case specifies `expectedWorkflow: "portfolio_builder"` and the trace shows `classification.workflow: "general_finance_qa"`
- **THEN** the intent classification score SHALL be 0.0

### Requirement: Tool selection scoring (Layer 2)
The eval framework SHALL score whether the agent called the correct tools. Scoring SHALL check that all `requiredTools` appear in the trace (recall) and no `forbiddenTools` appear (precision).

#### Scenario: All required tools called, no forbidden tools
- **WHEN** an eval case specifies `requiredTools: ["get_stock_quote", "get_technicals"]` and the trace contains both tool calls and no forbidden tools
- **THEN** the tool selection score SHALL be 1.0

#### Scenario: Missing required tool
- **WHEN** an eval case specifies `requiredTools: ["get_stock_quote", "get_technicals"]` and the trace only contains `get_stock_quote`
- **THEN** the tool selection score SHALL reflect the missing tool as a partial failure

#### Scenario: Forbidden tool called
- **WHEN** an eval case specifies `forbiddenTools: ["run_backtest"]` and the trace contains a `run_backtest` call
- **THEN** the tool selection score SHALL be penalized

### Requirement: Tool argument scoring (Layer 3)
The eval framework SHALL score whether tool calls include the correct arguments. Scoring SHALL check `requiredArgs` key-value pairs against actual tool call arguments in the trace.

#### Scenario: Correct arguments passed
- **WHEN** an eval case specifies `requiredArgs: { "get_stock_quote": { "symbol": "AAPL" } }` and the trace shows `get_stock_quote` called with `symbol: "AAPL"`
- **THEN** the argument score SHALL be 1.0

#### Scenario: Missing required argument
- **WHEN** an eval case specifies a required argument that does not appear in the trace's tool call
- **THEN** the argument score SHALL reflect the missing argument as a failure

### Requirement: Data faithfulness scoring (Layer 4)
The eval framework SHALL verify that financial numeric claims in the agent's final response are grounded in tool output. The scorer SHALL extract numbers that appear in financial contexts (prices, ratios, percentages, market cap, volume, returns, drawdowns) and check each against the union of all tool result data in the trace. The scorer SHALL exclude non-financial numbers: dates, ordinals, list indices, position counts, and time periods.

#### Scenario: Financial number grounded in tool output
- **WHEN** the agent response contains "AAPL is trading at $185.50" and the `get_stock_quote` tool returned `price: 185.50`
- **THEN** the faithfulness score SHALL be 1.0

#### Scenario: Hallucinated financial number detected
- **WHEN** the agent response cites a P/E ratio of 28.5 but no tool result in the trace contains that value
- **THEN** the faithfulness score SHALL be penalized and the ungrounded number SHALL be flagged in the eval report

#### Scenario: Calculated values within tolerance
- **WHEN** the agent response contains a percentage change derived from tool output and the value is within 1% relative tolerance of the correct calculation
- **THEN** the faithfulness scorer SHALL accept the value as grounded

#### Scenario: Non-financial numbers excluded
- **WHEN** the agent response contains "Here are 5 key metrics" or "over the past 3 years"
- **THEN** the faithfulness scorer SHALL NOT flag these as ungrounded

### Requirement: Risk disclosure scoring (Layer 5)
The eval framework SHALL verify that agent responses include appropriate risk disclosures. The scorer SHALL check for disclaimer text via regex and verify absence of prohibited language ("guaranteed", "risk-free", "can't lose").

#### Scenario: Disclaimer present and no prohibited language
- **WHEN** the agent response contains a disclaimer and does not contain prohibited terms
- **THEN** the risk disclosure score SHALL be 1.0

#### Scenario: Missing disclaimer on buy recommendation
- **WHEN** the agent response contains a buy recommendation but no risk disclaimer
- **THEN** the risk disclosure score SHALL be 0.0

#### Scenario: Prohibited language detected
- **WHEN** the agent response contains "guaranteed returns" or "risk-free"
- **THEN** the risk disclosure score SHALL be 0.0

### Requirement: Eval case format
Each eval case SHALL conform to a typed `EvalCase` interface with fields: `name`, `tier` ("always" | "usually"), `prompt`, optional `answers` (ordered `string[]` for multi-turn ask_user scripting, consumed in sequence), and `assertions` containing layer-specific expected values. Layer 1 assertions SHALL use `expectedWorkflow` (a `WorkflowType` string) instead of a generic intent string.

#### Scenario: Valid always-tier eval case
- **WHEN** an eval case has `tier: "always"` with deterministic assertions (Layers 1–5)
- **THEN** the eval runner SHALL include it in every CI run

#### Scenario: Eval case with ordered ask_user answers
- **WHEN** an eval case specifies `answers: ["conservative", "10 years", "no sector exclusions"]`
- **THEN** the harness SHALL provide the first answer to the first `ask_user` call, the second to the second call, and so on in order

### Requirement: Always-tier CI integration
All eval cases with `tier: "always"` SHALL run as part of the standard `npm test` pipeline. A failure in any always-tier eval SHALL cause the test suite to fail.

#### Scenario: Always-tier eval fails in CI
- **WHEN** a deterministic eval case fails (score below passing threshold)
- **THEN** the Vitest run SHALL report the failure and exit with non-zero status

### Requirement: Planning Fields Captured in Deterministic Traces

Deterministic eval traces SHALL include planning-layer fields: planning version, task family, commitment mode, policy card identifier, evidence plan identifier, answer contract identifier, structured-check identifiers, optional workspace/artifact placeholder identifiers, capability-gap identifiers, evidence records, structured-check failures, and retry eligibility when present.

#### Scenario: Trace includes planning metadata

- **WHEN** an always-tier eval case runs through the harness
- **THEN** the trace includes route/workflow metadata and planning metadata for the turn

#### Scenario: Trace includes structured-check result

- **WHEN** structured checks run for an eval case
- **THEN** the trace records which checks passed or failed
- **AND** active corrective retry is not required in V1

### Requirement: Before/After Migration Characterization

Before removing global prompt clauses or weakening deterministic behavior, the deterministic eval suite SHALL contain characterization coverage for the behavior protected by those clauses or logic. After migration, the same cases SHALL be rerunnable to compare route, workflow, tool, evidence, provider-gap, structured-check, and final-answer behavior.

#### Scenario: Prompt-protected behavior characterized before deletion

- **WHEN** a scenario-specific global prompt clause is selected for removal
- **THEN** at least one deterministic or scripted harness case covers the behavior before the clause is deleted

#### Scenario: Deterministic routing behavior characterized before change

- **WHEN** a deterministic router correction, workflow dispatch rule, tool-scope rule, or provider-degradation behavior is selected for change
- **THEN** deterministic tests cover the current behavior before the change is activated

#### Scenario: After migration preserves behavior

- **WHEN** the migrated policy/evidence/contract/structured-check path replaces a global prompt clause
- **THEN** the corresponding characterization case passes against the new path

#### Scenario: V1 scaffold can pass before full migration

- **WHEN** a task family has only observational planning metadata in V1
- **THEN** deterministic evals can assert the metadata and trace shape
- **AND** they do not require deletion of all legacy prompt guidance

#### Scenario: Shadow planning does not change active behavior

- **WHEN** shadow planning is enabled for a parity-ledger entry
- **THEN** deterministic evals compare shadow planning output to legacy behavior
- **AND** the legacy route, workflow, tool behavior, and final answer obligations remain active until the parity gate passes

### Requirement: Parity Ledger Report

Deterministic eval reports SHALL include parity-ledger status for migrated behavior and SHALL fail unaccepted regressions against the current baseline.

#### Scenario: Parity report blocks unreviewed regression

- **WHEN** a migrated path changes route kind, workflow, active tool calls, provider-gap disclosure, required evidence, or final-answer obligations
- **THEN** the deterministic report marks the ledger entry as failed unless the change is recorded as an accepted improvement

#### Scenario: Judge improvement cannot override hard assertion failure

- **WHEN** a migrated path receives a better judge score but fails a required hard assertion from the parity ledger
- **THEN** the deterministic report marks the ledger entry as failed
- **AND** the failure can be accepted only if the ledger records an explicit accepted improvement with changed expected assertions

#### Scenario: Dual-run comparison is available

- **WHEN** a behavior is in `dual_run` status
- **THEN** the report compares legacy and replacement route, tool, evidence, structured checks, optional artifact placeholders, and final-answer obligations before the replacement becomes active

### Requirement: Layered Failure Classification

Deterministic eval reports SHALL classify failures by layer: routing, planning, evidence plan, tool capability, evidence normalization, answer contract, structured check, retry eligibility, or synthesis.

#### Scenario: Missing tool call classified as evidence-plan failure

- **WHEN** the route and task family are correct but required evidence is not requested
- **THEN** the eval report classifies the failure as an evidence-plan failure rather than a generic final-answer failure

#### Scenario: Structured evidence mismatch classified as structured-check failure

- **WHEN** an answer contract requires structured evidence such as freshness, source coverage, or provider-gap disclosure and that evidence is absent
- **THEN** the eval report classifies the failure as a structured-check or evidence-normalization failure

#### Scenario: Missing data source classified as capability gap

- **WHEN** a prompt requires exact ETF holdings overlap, brokerage fee/yield comparison, live cash-product rates, or market-calendar data that OpenCandle cannot fetch
- **THEN** the eval report records a capability-gap identifier instead of recommending a new global prompt clause

#### Scenario: Disclosed gap is honest but not specialist-competitive

- **WHEN** OpenCandle correctly discloses a capability gap for a prompt requiring specialist finance data or computation
- **THEN** the eval report may mark current-behavior honesty as preserved
- **AND** it reports that capability as not specialist-competitive until the gap is closed

### Requirement: Workspace Artifact Placeholders Are Deferred

Deterministic evals SHALL NOT require full workspace artifact generation in V1. They MAY assert placeholder IDs, minimal evidence records, raw trace pointers, or capability gaps for prompt families that would later benefit from intermediate structured work.

#### Scenario: Sentiment prompt expects source coverage metadata

- **WHEN** a sentiment-divergence eval runs
- **THEN** the eval can assert source-coverage metadata or a future artifact placeholder
- **AND** it does not require a full source-coverage artifact in V1

#### Scenario: Filing prompt expects filing evidence separation

- **WHEN** a filing-thesis eval runs
- **THEN** the eval can assert filing metadata, filing evidence, and filing-vs-news separation
- **AND** it does not require a full filing-change artifact in V1

### Requirement: Prompt Size Regression Gate

The deterministic test suite SHALL include prompt assembly assertions that detect truncation and prompt-size regressions in production prompt variants.

#### Scenario: Production prompt contains no active-section truncation

- **WHEN** the standard, workflow, fallback, clarification, pass-through, and no-tool prompt variants are assembled
- **THEN** active non-memory sections contain no truncation marker

#### Scenario: Prompt growth is visible

- **WHEN** a prompt section exceeds its configured budget
- **THEN** the deterministic test output identifies the section and prompt variant that exceeded the budget

### Requirement: Migration Prompt Manifest Is Stable

Before/after migration comparisons SHALL use a committed prompt manifest with exact prompt text and expected assertions rather than generated prompts.

#### Scenario: Manifest pins prompt identity and assertions

- **WHEN** a migration prompt is added to the before/after set
- **THEN** the manifest records prompt ID, exact prompt text, followup sequence when applicable, expected hard assertions, optional judge assertions, baseline OpenCandle report path, competitor baseline path or hash, model/date metadata, and cached-competitor-answer policy

#### Scenario: Prompt drift is visible

- **WHEN** prompt text or expected assertions change
- **THEN** the manifest diff shows the changed prompt identity or accepted assertion change
- **AND** the baseline comparison cannot silently reuse stale expectations

### Requirement: Followup Characterization

Deterministic evals SHALL include multi-turn cases for planning carryover, entity replacement, changed constraints, stale evidence invalidation, and ambiguous prior context.

#### Scenario: Followup preserves task family

- **WHEN** a user follows an ETF comparison with "what about SCHD instead?"
- **THEN** the eval can assert the same task family and commitment mode with the replaced entity

#### Scenario: Followup refreshes time-sensitive evidence

- **WHEN** a followup asks for the same "today" analysis later in a session
- **THEN** the eval can assert whether market-status and quote evidence were refreshed or explicitly reused

### Requirement: Main Branch Product Replay Harness

Deterministic eval tooling SHALL provide a branch-vs-ref product replay harness that compares current checkout behavior against a git ref such as `origin/main` without requiring current branch-only scripts to exist on the base ref.

#### Scenario: Product evals are compared across refs

- **WHEN** a developer runs the main-branch product replay harness
- **THEN** the harness runs product evals for the current checkout and the selected base ref when supported
- **AND** it writes a combined comparison report under `tests/evals/runs/`
- **AND** the report includes ref names, report paths, score deltas, pass/fail deltas, and per-case changes when available

#### Scenario: Unsupported base ref is reported honestly

- **WHEN** the selected base ref does not support the requested eval command or report schema
- **THEN** the harness records the unsupported reason in the comparison report
- **AND** it does not count the unsupported run as a product win or loss

#### Scenario: Replay harness avoids branch patching

- **WHEN** the harness prepares a base-ref worktree
- **THEN** it does not edit the base ref to install current branch scripts
- **AND** comparison logic runs from the current checkout after reports are collected

### Requirement: Deterministic Reports Include Artifact Contract IDs

Deterministic eval traces and reports SHALL expose typed artifact contract identifiers when planning selects them.

#### Scenario: Trace includes artifact contracts

- **WHEN** planning selects trace-only artifact contracts
- **THEN** the deterministic trace includes those contract IDs alongside existing planning metadata
- **AND** no rendered artifact file is required

#### Scenario: Artifact contracts can be asserted without rendering

- **WHEN** an eval case targets a prompt with expected structured intermediate work
- **THEN** it MAY assert artifact contract IDs
- **AND** the assertion does not require persisted workspace storage or UI artifacts

### Requirement: OpenCandle Superiority Scorecard

Deterministic eval tooling SHALL provide a composed scorecard that explains whether the current branch is below, at, or better than main parity using existing replay and prompt-policy reports.

#### Scenario: Scorecard composes report evidence

- **WHEN** product replay, competitive replay, and prompt-policy manifest reports are supplied
- **THEN** the scorecard classifies each layer independently
- **AND** it writes an auditable JSON report under `tests/evals/runs/`

#### Scenario: Blocking regressions are explicit

- **WHEN** any supplied report shows a current-vs-base regression
- **THEN** the scorecard status is `below_main_parity`
- **AND** the blocking layer and reason are included in the report

#### Scenario: Architecture signals are part of superiority

- **WHEN** current behavior matches or beats main
- **THEN** the scorecard also records planning metadata, artifact-contract, and structured-check availability
- **AND** those signals are used to distinguish maintainable parity from prompt-bloat parity

