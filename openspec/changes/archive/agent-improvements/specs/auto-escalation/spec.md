## ADDED Requirements

### Requirement: Rebuttal step is self-gating via prompt, not runtime skip

The rebuttal step SHALL always be included in the `WorkflowDefinition` (not conditionally injected). The rebuttal prompt SHALL instruct the LLM to check the five analyst `SIGNAL:` lines specifically (not BUY/SELL mentions in bull/bear prose) and produce either a full rebuttal (when at least one SIGNAL: BUY and one SIGNAL: SELL exist) or a one-line skip response. This avoids needing runtime output capture or conditional skip predicates in the workflow runner.

#### Scenario: LLM self-gates on consensus

- **GIVEN** 5 analyst outputs visible in conversation context: 3 BUY, 2 HOLD, 0 SELL
- **WHEN** the rebuttal step executes
- **THEN** the LLM reads the analyst signals from context
- **AND** detects no BUY+SELL disagreement
- **AND** responds with a line starting with "REBUTTAL SKIPPED" (exact phrasing after the prefix may vary)
- **AND** the response is ~50 tokens (minimal cost)

#### Scenario: LLM self-gates on split

- **GIVEN** 5 analyst outputs visible in conversation context: 3 BUY, 1 HOLD, 1 SELL
- **WHEN** the rebuttal step executes
- **THEN** the LLM reads the analyst signals from context
- **AND** detects BUY+SELL disagreement
- **AND** produces a full rebuttal with CONCESSIONS and REMAINING CONVICTION

#### Scenario: Unanimous still gets debate but no rebuttal

- **GIVEN** 5 analyst outputs: 5 BUY, 0 HOLD, 0 SELL
- **WHEN** the rebuttal step executes
- **THEN** the LLM responds with a line starting with "REBUTTAL SKIPPED"
- **AND** the bull and bear steps still ran (even consensus benefits from devil's advocate)

### Requirement: Workflow definition always includes all 11 steps

`buildComprehensiveAnalysisDefinition(symbol)` SHALL return a fixed 11-step `WorkflowDefinition`: initial_fetch, 5 analysts, debate_bull, debate_bear, debate_rebuttal, synthesis, validation. No steps are dynamically injected or conditionally included.

#### Scenario: Static step count

- **WHEN** `buildComprehensiveAnalysisDefinition("AAPL")` is called
- **THEN** the returned definition has exactly 11 steps
- **AND** step types in order are: `initial_fetch`, `analyst_valuation`, `analyst_momentum`, `analyst_options`, `analyst_contrarian`, `analyst_risk`, `debate_bull`, `debate_bear`, `debate_rebuttal`, `synthesis`, `validation`

#### Scenario: No skippable debate steps

- **WHEN** `buildComprehensiveAnalysisDefinition("AAPL")` is called
- **THEN** `debate_bull`, `debate_bear`, and `debate_rebuttal` all have `skippable: false`
- **AND** the rebuttal never throws — it always produces output (either full or one-line skip)

### Requirement: Synthesis prompt is self-adapting to rebuttal presence

The synthesis prompt SHALL NOT require a `hasRebuttal` flag. Instead, it SHALL instruct the LLM: "If a bull rebuttal with concessions appears above (not 'REBUTTAL SKIPPED'), treat the concessions as validated risks." The LLM reads conversation context to determine which case applies.

#### Scenario: Synthesis adapts to full rebuttal

- **GIVEN** the rebuttal step produced concessions and a remaining conviction score
- **WHEN** the synthesis step executes
- **THEN** synthesis references the concessions as validated risks

#### Scenario: Synthesis adapts to skipped rebuttal

- **GIVEN** the rebuttal step responded with "REBUTTAL SKIPPED"
- **WHEN** the synthesis step executes
- **THEN** synthesis resolves the debate from bull and bear cases only, without referencing concessions

### Requirement: isAnalystSplit is an eval/test helper only

`isAnalystSplit(outputs: AnalystOutput[]): boolean` SHALL be implemented as a helper for eval cases and unit tests. It returns `tallyVotes(outputs).buy > 0 && tallyVotes(outputs).sell > 0`. It is NOT used in the live workflow path.

#### Scenario: Eval verifies LLM gating matches deterministic check

- **GIVEN** an eval case with analyst fixture responses
- **WHEN** eval parses analyst outputs and calls `isAnalystSplit()`
- **AND** checks the LLM's rebuttal response
- **THEN** the LLM's skip/proceed decision matches `isAnalystSplit()` result

### Requirement: No changes to workflow runner or session coordinator

The debate feature SHALL NOT modify `src/runtime/workflow-runner.ts`, `src/runtime/session-coordinator.ts`, or `src/runtime/prompt-step.ts`. The self-gating prompt approach works entirely within the existing runtime capabilities.

#### Scenario: Runtime files unchanged

- **WHEN** the debate feature is implemented
- **THEN** `workflow-runner.ts`, `session-coordinator.ts`, and `prompt-step.ts` have no diff
