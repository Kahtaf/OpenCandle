## CHANGED Requirements

### Requirement: Synthesis resolves the debate instead of tallying votes

The synthesis prompt SHALL be replaced with a debate-aware version. It SHALL resolve tension between bull and bear cases, declare a debate winner, address the loser's strongest argument, and state a specific reversal condition. It SHALL NOT merely average analyst opinions.

#### Scenario: Synthesis references debate output from context

- **GIVEN** analyst signals, a bull case, and a bear case are visible in LLM context
- **WHEN** the synthesis step executes
- **THEN** the LLM reads and references all three from conversation context

#### Scenario: Synthesis declares debate winner

- **GIVEN** the synthesis step runs
- **THEN** its output includes "DEBATE WINNER: BULL" or "DEBATE WINNER: BEAR"
- **AND** it explains WHY that side had the stronger argument

#### Scenario: Synthesis addresses losing side's best point

- **GIVEN** the bear raised "revenue deceleration for 3 consecutive quarters"
- **AND** synthesis declares BULL as winner
- **THEN** synthesis explicitly addresses the revenue deceleration point
- **AND** explains why it's outweighed (not ignored)

#### Scenario: Synthesis includes reversal condition

- **GIVEN** the synthesis step completes
- **THEN** its output includes "REVERSAL CONDITION: [specific, testable condition]"
- **AND** the condition is concrete (e.g., "If Q2 FCF margin drops below 25%")
- **AND** the condition is NOT vague (e.g., NOT "if macro deteriorates")

#### Scenario: Synthesis retains standard fields

- **GIVEN** the synthesis step completes
- **THEN** its output still includes: VERDICT (BUY/HOLD/SELL), CONFIDENCE (1-10), vote tally, key levels (entry, stop, target), and position sizing

### Requirement: Synthesis prompt is self-adapting (no hasRebuttal flag)

The synthesis prompt SHALL NOT take a `hasRebuttal` boolean parameter. Instead, it SHALL instruct: "If a bull rebuttal with concessions appears above (not a line starting with 'REBUTTAL SKIPPED'), treat the concessions as validated risks." The LLM determines which case applies from conversation context.

#### Scenario: Single synthesis prompt for both cases

- **WHEN** `buildSynthesisPrompt("AAPL")` is called
- **THEN** it returns ONE prompt (not two variants)
- **AND** the prompt handles both rebuttal-present and rebuttal-skipped cases via self-adapting instructions

#### Scenario: Synthesis adapts when rebuttal occurred

- **GIVEN** the rebuttal step produced concessions
- **WHEN** synthesis executes
- **THEN** the LLM treats conceded points as validated risks

#### Scenario: Synthesis adapts when rebuttal was skipped

- **GIVEN** the rebuttal step responded "REBUTTAL SKIPPED"
- **WHEN** synthesis executes
- **THEN** the LLM resolves from bull and bear cases only

### Requirement: Synthesis output format adds debate fields

The synthesis output SHALL add DEBATE WINNER and REVERSAL CONDITION fields alongside the existing VERDICT and CONFIDENCE fields.

#### Scenario: New output format markers

- **WHEN** the synthesis step completes
- **THEN** the output ends with:
  ```
  VERDICT: [BUY|HOLD|SELL]
  CONFIDENCE: [1-10]
  DEBATE WINNER: [BULL|BEAR]
  REVERSAL CONDITION: [specific, testable condition]
  ```

### Requirement: buildSynthesisPrompt replaces SYNTHESIS_PROMPT constant

The existing `SYNTHESIS_PROMPT` constant (a function taking symbol) SHALL be replaced with `buildSynthesisPrompt(symbol: string): string`. The new function generates the debate-aware synthesis prompt.

#### Scenario: Old constant replaced

- **WHEN** the debate feature is implemented
- **THEN** `SYNTHESIS_PROMPT` is replaced by `buildSynthesisPrompt`
- **AND** all references in `buildComprehensiveAnalysisDefinition` and `getComprehensiveAnalysisPrompts` use the new function
