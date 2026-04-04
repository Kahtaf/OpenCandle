## CHANGED Requirements

### Requirement: Validation checks debate claims against tool outputs

The validation prompt SHALL be expanded to verify claims made by the bull and bear researchers, not just the analyst steps. Every number cited in the debate SHALL be checked against tool output data visible in the session context.

#### Scenario: Bull citation validated

- **GIVEN** the bull researcher cited "FCF margin expanded from 24% to 28%"
- **WHEN** validation runs
- **THEN** it checks whether any tool output in the session contains those FCF margin values
- **AND** flags as UNVERIFIED if no tool output matches

#### Scenario: Bear citation validated

- **GIVEN** the bear researcher cited "revenue deceleration: Q3 +12%, Q4 +9%, Q1 +6%"
- **WHEN** validation runs
- **THEN** it checks whether earnings or financials tool output contains those growth rates

### Requirement: Validation checks that rebuttal concessions are genuine (when present)

When the rebuttal produced concessions (not a line starting with "REBUTTAL SKIPPED"), the validation step SHALL verify that concessions address specific bear arguments rather than being generic deflections.

#### Scenario: Genuine concession

- **GIVEN** the bear argued "revenue is decelerating" and the rebuttal's CONCESSIONS include "Revenue deceleration is real"
- **WHEN** validation runs
- **THEN** validation marks this as genuine (addresses a specific bear point)

#### Scenario: Generic deflection flagged

- **GIVEN** the bear argued "revenue is decelerating" and the rebuttal's CONCESSIONS include "There are always risks in the market"
- **WHEN** validation runs
- **THEN** validation flags: "Concession does not address a specific bear argument"

#### Scenario: Skipped rebuttal — no concession check

- **GIVEN** the rebuttal response starts with "REBUTTAL SKIPPED"
- **WHEN** validation runs
- **THEN** validation does NOT check for concessions

### Requirement: Validation checks that reversal condition is testable

The synthesis REVERSAL CONDITION SHALL be validated for specificity. It must reference a concrete metric, threshold, or event.

#### Scenario: Testable reversal condition passes

- **GIVEN** REVERSAL CONDITION is "If Q2 earnings show FCF margin contraction below 25%"
- **WHEN** validation runs
- **THEN** validation passes — condition references a specific metric, threshold, and timeframe

#### Scenario: Vague reversal condition flagged

- **GIVEN** REVERSAL CONDITION is "If the macro environment deteriorates significantly"
- **WHEN** validation runs
- **THEN** validation flags: "Reversal condition is not testable — lacks specific metric, threshold, or timeframe"

### Requirement: Validation prompt text includes debate-specific checks

The validation prompt SHALL explicitly list the debate checks alongside existing number-matching checks.

#### Scenario: Validation prompt covers debate

- **WHEN** the validation prompt is generated
- **THEN** it includes instructions to:
  1. Verify all numbers cited by bull/bear against tool outputs
  2. If rebuttal occurred (not a line starting with "REBUTTAL SKIPPED"), check concessions are genuine
  3. Check reversal condition is specific and testable
- **AND** it still includes the original instruction to verify all analyst-cited numbers
