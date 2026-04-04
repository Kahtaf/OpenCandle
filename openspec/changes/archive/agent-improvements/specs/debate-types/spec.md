## ADDED Requirements

### Requirement: Debate types are eval/test infrastructure, not live-path contracts

`DebateOutput`, `DebateSide`, and `parseDebateOutput()` SHALL be used by the eval framework and unit tests to score debate quality and verify prompt structure. They are NOT consumed in the live workflow path — the live path works through LLM conversation context where each step's prompt references "the outputs above."

#### Scenario: Types not imported by runtime code

- **WHEN** the debate feature is implemented
- **THEN** `src/runtime/session-coordinator.ts` does NOT import `DebateOutput` or `parseDebateOutput`
- **AND** `src/runtime/workflow-runner.ts` does NOT import them
- **AND** `src/analysts/orchestrator.ts` does NOT import them (it only defines prompt strings)

### Requirement: Each debate side has a typed output contract

Debate steps (bull, bear, rebuttal) SHALL have a `DebateOutput` type for eval parsing. Debate outputs represent advocacy positions, not directional signals — they do not carry a BUY/HOLD/SELL signal.

#### Scenario: Bull researcher output contract

- **GIVEN** the bull researcher response text is parsed
- **THEN** its parsed output includes `{ side: "bull", thesis: "...", keyRisk: "...", concessions: [], remainingConviction: 0, evidence: [], rawText: "..." }`
- **AND** `thesis` is a 1-3 sentence advocacy case FOR the position
- **AND** `keyRisk` names one specific condition that would invalidate the bull case

#### Scenario: Bear researcher output contract

- **GIVEN** the bear researcher response text is parsed
- **THEN** its parsed output includes `{ side: "bear", thesis: "...", keyRisk: "...", concessions: [], remainingConviction: 0, evidence: [], rawText: "..." }`
- **AND** `thesis` is a 1-3 sentence case AGAINST the position
- **AND** `keyRisk` is labeled "what would change my mind"

#### Scenario: Rebuttal output contract (full rebuttal)

- **GIVEN** the bull rebuttal response text is parsed from a split-vote debate
- **THEN** its parsed output includes `{ side: "bull", concessions: ["point 1", ...], remainingConviction: 7, ... }`
- **AND** `concessions` is a non-empty array of points the bull concedes

#### Scenario: Rebuttal output contract (skipped)

- **GIVEN** the rebuttal response text starts with "REBUTTAL SKIPPED" (case-insensitive, any trailing text/punctuation)
- **WHEN** `parseDebateOutput("bull", responseText)` is called
- **THEN** `thesis` = "" and `concessions` = [] and `remainingConviction` = 0
- **AND** `rawText` contains the skip message

#### Scenario: Skip detection is fuzzy

- **GIVEN** rebuttal response variants: "REBUTTAL SKIPPED — consensus reached.", "Rebuttal skipped - consensus reached", "REBUTTAL SKIPPED."
- **WHEN** `parseDebateOutput("bull", responseText)` is called for each
- **THEN** all are detected as skipped (thesis = "", concessions = [])

### Requirement: Debate output parser extracts structured fields from LLM prose

`parseDebateOutput()` SHALL extract `DebateOutput` fields using pattern matching, with fallback defaults when patterns don't match.

#### Scenario: Parse well-formed bull output

- **GIVEN** LLM response contains "BULL THESIS: Strong FCF growth supports 25% upside." and "KEY RISK TO THIS THESIS: Revenue deceleration below 5% YoY."
- **WHEN** `parseDebateOutput("bull", responseText)` is called
- **THEN** `thesis` = "Strong FCF growth supports 25% upside."
- **AND** `keyRisk` = "Revenue deceleration below 5% YoY."

#### Scenario: Parse well-formed bear output

- **GIVEN** LLM response contains "BEAR THESIS: IV is elevated and revenue is decelerating." and "WHAT WOULD CHANGE MY MIND: FCF margin expansion above 30%."
- **WHEN** `parseDebateOutput("bear", responseText)` is called
- **THEN** `thesis` = "IV is elevated and revenue is decelerating."
- **AND** `keyRisk` = "FCF margin expansion above 30%."

#### Scenario: Parse rebuttal with concessions

- **GIVEN** LLM response contains "CONCESSIONS:\n- Revenue deceleration is real\n- IV is elevated" and "REMAINING CONVICTION: 7"
- **WHEN** `parseDebateOutput("bull", responseText)` is called
- **THEN** `concessions` = ["Revenue deceleration is real", "IV is elevated"]
- **AND** `remainingConviction` = 7

#### Scenario: Fallback on malformed output

- **GIVEN** LLM response does not contain any expected markers
- **WHEN** `parseDebateOutput("bull", responseText)` is called
- **THEN** `thesis` = "" and `keyRisk` = "" and `rawText` contains the full response
- **AND** the function does not throw

### Requirement: DebateSide is independent of AnalystRole

`DebateSide` SHALL be `"bull" | "bear"`. The existing `AnalystRole` type SHALL remain unchanged.

#### Scenario: Types are separate

- **GIVEN** the type definitions
- **THEN** `AnalystRole` is `"valuation" | "momentum" | "options" | "contrarian" | "risk"` (unchanged)
- **AND** `DebateSide` is `"bull" | "bear"` (new, separate type)
