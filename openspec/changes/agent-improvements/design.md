# Design: Adversarial Bull/Bear Debate

## Overview

Add a structured debate phase between the analyst signals and synthesis in comprehensive analysis. A Bull Researcher and Bear Researcher argue the position before synthesis resolves the tension. Auto-escalates from 1 round to 2 when analysts disagree.

## Architecture

### Current Flow (8 steps)

```
fetch → valuation → momentum → options → contrarian → risk → synthesis → validation
```

### New Flow (11 steps, fixed)

```
fetch → [5 analysts] → bull → bear → rebuttal → synthesis → validation
                                         │
                                    self-gating:
                                    LLM reads analyst
                                    signals in context,
                                    skips if consensus
```

All 11 steps are always in the `WorkflowDefinition`. The rebuttal is **self-gating via prompt** — the LLM reads the analyst signals in its conversation context and either produces a full rebuttal (on BUY+SELL split) or responds with `REBUTTAL SKIPPED — consensus reached` (~50 tokens). No runtime changes needed.

### Why Self-Gating Instead of Runtime Skip

The original design assumed the runner could conditionally skip steps based on prior outputs. It can't — `skippable` only handles execution failures, and the coordinator doesn't capture LLM response text ([P1] findings). Instead of adding runtime complexity:

1. The LLM already sees all prior analyst responses in conversation context
2. Detecting "are there both BUY and SELL signals above?" is trivial for the LLM
3. A skipped rebuttal costs ~50 tokens (one sentence), not an extra API call — the step still executes, but the response is tiny
4. No runner changes, no output capture, no new skip predicates

The same principle applies to synthesis: instead of two prompt variants (`hasRebuttal` flag), the synthesis prompt is self-adapting — it references "the debate above" and handles both cases.

## Design Decisions

### 1. Auto-Escalation: Self-Gating via Prompt (not runtime)

The rebuttal prompt instructs: "First, check the analyst signals above. If there is no BUY+SELL disagreement, respond only with: REBUTTAL SKIPPED — consensus reached. Otherwise, proceed with the rebuttal."

This means:
- `buildComprehensiveAnalysisDefinition()` always returns 11 steps
- All steps have `skippable: false` — the rebuttal never throws, it just produces minimal output on consensus
- No `isAnalystSplit()` function needed at runtime (only in tests/eval to verify correct gating behavior)
- The synthesis prompt is also self-adapting: "If a rebuttal with concessions appears above, reference the concessions as validated risks"

### 2. One Canonical Orchestration Path

The live path is `buildComprehensiveAnalysisDefinition()` → `SessionCoordinator.executeWorkflow()`. This is what the extension's `/analyze` command and input handler use.

`runComprehensiveAnalysis()` and `getComprehensiveAnalysisPrompts()` are legacy/test code. They will be updated to include debate prompts for backward compatibility, but are NOT the implementation target. No changes to `SessionCoordinator` are needed.

### 3. DebateOutput Types: Eval/Test Infrastructure Only

`DebateOutput` and `parseDebateOutput()` exist for:
- **Unit tests**: verify prompt structure and parse debate responses from fixtures
- **Eval framework**: score debate quality (did the bull cite data? did the bear attack the right things? are concessions genuine?)
- **Future**: when the runtime gains output capture, these types are ready

They are NOT consumed in the live workflow path. The live path works purely through LLM conversation context — each step's prompt references "the analyst outputs above" and the LLM reads them from its context window.

### 4. Tools in Debate: Gap-Filling Allowed (Soft Cap)

Bull and bear steps MAY call tools. Rebuttal step may NOT.

```
DEBATE TOOL RULES:
1. You MAY call tools if you identify a SPECIFIC gap in existing evidence.
2. Aim for at most 2 tool calls per debate step.
3. State the gap BEFORE calling the tool.
4. Reuse data already fetched in the session.
```

The 2-call limit is a **soft cap enforced by prompt instruction only**. The runtime does not count or block tool calls per step. If the LLM occasionally makes a 3rd call, that's acceptable — the prompt discourages it but doesn't guarantee it. A hard cap would require runtime changes we're explicitly avoiding.

### 5. Default On

Debate is always part of `/analyze`. ~30% more tokens for substantially better output.

## New Types

### DebateOutput (eval/test only — not used in live path)

```ts
// In src/runtime/workflow-types.ts

export type DebateSide = "bull" | "bear";

export interface DebateOutput {
  side: DebateSide;
  thesis: string;              // 2-3 sentence case
  keyRisk: string;             // "what would change my mind"
  concessions: string[];       // points conceded (rebuttal only)
  remainingConviction: number; // 1-10 (rebuttal only, 0 otherwise)
  evidence: EvidenceRecord[];
  rawText: string;
}
```

### Parser (eval/test only)

```ts
// In src/analysts/contracts.ts

export function parseDebateOutput(side: DebateSide, responseText: string): DebateOutput {
  // Pattern-match: BULL THESIS: / BEAR THESIS:
  // Pattern-match: KEY RISK: / KEY RISK TO THIS THESIS:
  // Pattern-match: WHAT WOULD CHANGE MY MIND:
  // Pattern-match: CONCESSIONS: (rebuttal only)
  // Pattern-match: REMAINING CONVICTION: (rebuttal only)
}
```

### isAnalystSplit (eval/test helper)

```ts
// In src/analysts/contracts.ts

export function isAnalystSplit(outputs: AnalystOutput[]): boolean {
  const votes = tallyVotes(outputs);
  return votes.buy > 0 && votes.sell > 0;
}
```

Used in eval cases to verify the LLM's self-gating matches the deterministic check. Not used in the live workflow path.

## Prompts

### Bull Researcher

```
**[Bull Researcher]** You have received five analyst perspectives above for ${symbol}.
Build the strongest possible case FOR this position.

Rules:
- Cite analyst outputs and underlying tool evidence where available.
- Address any bearish signals (SELL votes, high VaR, negative sentiment) and explain
  why they are less concerning than they appear.
- You may call up to 2 tools if you identify a specific gap in the existing evidence.
  State the gap before calling the tool.
- Reuse data already fetched in the session.

${EXECUTION_GUARDRAILS}

End with this exact format:
BULL THESIS: [2-3 sentences building the case for the position]
KEY RISK TO THIS THESIS: [one sentence — the single thing that would invalidate your case]
```

### Bear Researcher

```
**[Bear Researcher]** You have received five analyst perspectives and a bull case above
for ${symbol}. Your job is to dismantle the bull thesis.

Rules:
- Attack the weakest assumptions in the bull case above.
- Cite analyst outputs and underlying tool evidence where available.
- If the bull case ignored negative data points, surface them.
- You may call up to 2 tools if you identify a specific gap in the existing evidence.
  State the gap before calling the tool.
- Reuse data already fetched in the session.

${EXECUTION_GUARDRAILS}

End with this exact format:
BEAR THESIS: [2-3 sentences arguing against the position]
WHAT WOULD CHANGE MY MIND: [one sentence — what data would make you concede to the bull]
```

### Bull Rebuttal (self-gating)

```
**[Bull Rebuttal]** First, check the five analyst SIGNAL: lines above for ${symbol}
(each analyst ended with "SIGNAL: BUY", "SIGNAL: HOLD", or "SIGNAL: SELL").
If there is NO case where at least one analyst said SIGNAL: BUY and at least one
said SIGNAL: SELL, respond with ONLY:
REBUTTAL SKIPPED — consensus reached.

Otherwise, the bear raised specific concerns above. Address each one directly.

Rules:
- Concede any point where the bear is factually correct.
- For points you rebut, cite specific data from the analysts above.
- Do not repeat your original thesis — respond to the bear's NEW arguments.
- No tool calls in the rebuttal. Work with existing evidence only.

${EXECUTION_GUARDRAILS}

End with this exact format:
CONCESSIONS: [bullet list of points you concede]
REMAINING CONVICTION: [1-10, where 10 = fully confident despite bear case]
```

### Debate-Aware Synthesis (self-adapting)

```
**[Synthesis]** You have received five analyst signals with conviction scores
for ${symbol}, a bull case arguing FOR the position, and a bear case arguing AGAINST.
If a bull rebuttal with concessions appears above (not a line starting with
"REBUTTAL SKIPPED"), treat the concessions as validated risks that must be addressed.

Your job is NOT to average opinions. Your job is to RESOLVE THE DEBATE.

1. **Vote Tally**: X BUY, Y HOLD, Z SELL — weighted average conviction
2. **Verdict**: BUY, HOLD, or SELL
3. **Debate winner**: Which side had the stronger argument, and why
4. **Strongest counterpoint**: Address the losing side's best argument directly —
   explain why it's outweighed, or acknowledge it as a real risk
5. **Reversal condition**: State the SPECIFIC, TESTABLE condition under which
   your verdict would reverse (the bear's "what would change my mind" or
   the bull's "key risk")
6. **Key levels**: Entry, stop-loss, and target prices
7. **Position sizing**: Based on risk manager's analysis

Be direct and actionable. This is your final word on ${symbol}.

End with this exact format:
VERDICT: [BUY|HOLD|SELL]
CONFIDENCE: [1-10]
DEBATE WINNER: [BULL|BEAR]
REVERSAL CONDITION: [specific, testable condition]
```

### Expanded Validation

```
**[Validation Check]** Review the complete analysis of ${symbol} above, including
the debate. For each specific number cited by any analyst, bull, or bear researcher,
verify it matches tool output data received in the session.

Additionally check:
1. Did the bull/bear cite real numbers from analyst outputs (not hallucinated)?
2. If a rebuttal occurred (not a line starting with "REBUTTAL SKIPPED"), are the concessions genuine
   (did the bull actually give ground on the bear's specific points)?
3. Is the reversal condition specific and testable (not vague like "if macro deteriorates")?

Output: VALIDATED if all checks pass, or list specific corrections needed.
```

## Token Budget

```
Step              LLM calls   Est. tokens (in+out)
──────────────    ─────────   ────────────────────
initial_fetch     1           ~2K
5 analysts        5           ~15K
debate_bull       1           ~4K
debate_bear       1           ~4K
debate_rebuttal   1           ~3K (split) or ~50 (consensus)
synthesis         1           ~3K
validation        1           ~2K
──────────────    ─────────   ────────────────────
TOTAL (consensus) 11          ~30K (rebuttal is ~50 tokens)
TOTAL (split)     11          ~33K (rebuttal is full)
vs CURRENT        8           ~24K
OVERHEAD          +3 calls    +25-37%
```

Note: consensus case always makes the rebuttal LLM call, but the response is one line. The token overhead is in the input (rebuttal sees full context) not the output.

## Files to Change

| File | Change |
|------|--------|
| `src/analysts/orchestrator.ts` | Add `buildBullPrompt`, `buildBearPrompt`, `buildRebuttalPrompt`; update `buildComprehensiveAnalysisDefinition()` to include 3 debate steps; update `SYNTHESIS_PROMPT` → `buildSynthesisPrompt()`; update `VALIDATION_PROMPT`; update `getComprehensiveAnalysisPrompts()` for compat |
| `src/analysts/contracts.ts` | Add `parseDebateOutput()`, `isAnalystSplit()` (eval/test helpers) |
| `src/runtime/workflow-types.ts` | Add `DebateOutput`, `DebateSide` types |
| `tests/unit/tools/orchestrator.test.ts` | Update step count assertions, add debate prompt tests |
| `tests/unit/analysts/contracts.test.ts` | Add parseDebateOutput and isAnalystSplit tests |
| `tests/e2e/tools.test.ts` | Update `runComprehensiveAnalysis` assertion for new prompt count |

**NOT changed**: `src/runtime/session-coordinator.ts`, `src/runtime/workflow-runner.ts`, `src/runtime/prompt-step.ts` — no runtime modifications needed.

## Example Output (After)

```
DEBATE RESOLUTION

The bull argued 25% DCF upside + momentum breakout on rising OBV.
The bear correctly identified 3 consecutive quarters of revenue
deceleration and elevated IV suggesting risk is already priced in.

Winner: BULL — but with a critical concession.
The revenue deceleration is real (Q3: +12%, Q4: +9%, Q1: +6%).
However, FCF margins expanded from 24% to 28% over the same period,
meaning the company is generating more cash on less growth. The market
is pricing in revenue deceleration but hasn't priced in the margin
expansion.

Verdict: BUY
Confidence: 7/10

⚠ REVERSAL CONDITION: If Q2 earnings show FCF margin contraction
below 25%, the margin expansion thesis breaks and this becomes a
HOLD. Watch the earnings call on July 24.

Entry: $185 (above SMA50 support)
Stop: $172 (below Q1 low)
Target: $215 (DCF midpoint)
Position: 3.2% of $100K portfolio ($3,200)
```
