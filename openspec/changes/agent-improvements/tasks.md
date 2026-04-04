## 1. Debate Types and Parsing (eval/test infrastructure)

- [x] 1.1 Add `DebateSide` type (`"bull" | "bear"`) to `src/runtime/workflow-types.ts`
- [x] 1.2 Add `DebateOutput` interface to `src/runtime/workflow-types.ts` — `{ side: DebateSide, thesis: string, keyRisk: string, concessions: string[], remainingConviction: number, evidence: EvidenceRecord[], rawText: string }`
- [x] 1.3 Implement `parseDebateOutput(side: DebateSide, responseText: string): DebateOutput` in `src/analysts/contracts.ts` — pattern-match BULL THESIS / BEAR THESIS, KEY RISK / KEY RISK TO THIS THESIS, WHAT WOULD CHANGE MY MIND, CONCESSIONS, REMAINING CONVICTION. Detect skipped rebuttal via case-insensitive `/^rebuttal skipped/i` prefix match (any trailing text/punctuation).
- [x] 1.4 Implement `isAnalystSplit(outputs: AnalystOutput[]): boolean` in `src/analysts/contracts.ts` — returns `tallyVotes(outputs).buy > 0 && tallyVotes(outputs).sell > 0`. Eval/test helper only.
- [x] 1.5 Write unit tests for `parseDebateOutput` — well-formed bull, well-formed bear, rebuttal with concessions, rebuttal skipped (test punctuation variants: "REBUTTAL SKIPPED — consensus reached.", "Rebuttal skipped.", "REBUTTAL SKIPPED - consensus"), malformed fallback
- [x] 1.6 Write unit tests for `isAnalystSplit` — consensus (all BUY), consensus (BUY+HOLD), split (BUY+SELL), edge case (all HOLD)

## 2. Debate Prompts

- [x] 2.1 Add `buildBullPrompt(symbol: string): string` to `src/analysts/orchestrator.ts` — references analyst perspectives above, allows ≤2 tool calls for gap-filling, requires "BULL THESIS:" and "KEY RISK TO THIS THESIS:" ending, includes EXECUTION_GUARDRAILS
- [x] 2.2 Add `buildBearPrompt(symbol: string): string` to `src/analysts/orchestrator.ts` — references analysts + bull case above, attacks weakest assumptions, allows ≤2 tool calls, requires "BEAR THESIS:" and "WHAT WOULD CHANGE MY MIND:" ending, includes EXECUTION_GUARDRAILS
- [x] 2.3 Add `buildRebuttalPrompt(symbol: string): string` to `src/analysts/orchestrator.ts` — self-gating: instructs LLM to check the five analyst `SIGNAL:` lines specifically (not BUY/SELL mentions in bull/bear prose); if no BUY+SELL disagreement, respond with a line starting "REBUTTAL SKIPPED"; otherwise full rebuttal with CONCESSIONS and REMAINING CONVICTION. No tool calls allowed. Includes EXECUTION_GUARDRAILS.
- [x] 2.4 Write unit tests for prompt generation — verify each prompt contains required markers, guardrails, tool constraints, self-gating instructions in rebuttal

## 3. Debate-Aware Synthesis and Validation

- [x] 3.1 Replace `SYNTHESIS_PROMPT` with `buildSynthesisPrompt(symbol: string): string` — self-adapting: references debate above, handles both rebuttal-present and REBUTTAL SKIPPED cases. Requires VERDICT, CONFIDENCE, DEBATE WINNER, REVERSAL CONDITION markers. Keeps vote tally, key levels, position sizing.
- [x] 3.2 Update `VALIDATION_PROMPT` to include debate-specific checks — verify bull/bear number citations, verify concessions are genuine (if rebuttal not skipped), verify reversal condition is testable
- [x] 3.3 Write unit tests for `buildSynthesisPrompt` — verify debate references, self-adapting language, required output markers
- [x] 3.4 Write unit tests for updated validation prompt — verify debate checks included

## 4. Orchestrator Integration

- [x] 4.1 Update `buildComprehensiveAnalysisDefinition(symbol)` to insert 3 debate steps between analysts and synthesis: `debate_bull` (skippable: false), `debate_bear` (skippable: false), `debate_rebuttal` (skippable: false). Total: 11 steps.
- [x] 4.2 Update `buildComprehensiveAnalysisDefinition` to use `buildSynthesisPrompt(symbol)` and updated `VALIDATION_PROMPT`
- [x] 4.3 Update `getComprehensiveAnalysisPrompts(symbol)` for backward compat — include debate prompts in returned array between analysts and synthesis
- [x] 4.4 Update `runComprehensiveAnalysis()` for backward compat — enqueue debate prompts after analysts
- [x] 4.5 Write unit tests for updated step sequence — verify 11 steps, correct order, step types, skippable flags
- [x] 4.6 Update existing unit tests in `tests/unit/tools/orchestrator.test.ts` — adjust step count and prompt count assertions

## 5. Integration and Verification

- [x] 5.1 Run full test suite (`npm test`) and verify all existing tests pass with updated step counts
- [x] 5.2 Update e2e test in `tests/e2e/tools.test.ts` — adjust `runComprehensiveAnalysis` assertion from 7 to 10 follow-ups
- [x] 5.3 Add eval case for comprehensive analysis with debate — verify debate steps appear in trace, synthesis references debate, reversal condition present
- [x] 5.4 Manual test via harness: `npx tsx tests/harness/manual-run.ts <dir> "analyze AAPL"` — verify debate steps execute, synthesis resolves tension, output quality improved
