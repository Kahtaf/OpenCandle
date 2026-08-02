import { buildPortfolioPrompt } from "../prompts/workflow-prompts.js";
import type { PortfolioSlots, SlotResolution } from "../routing/types.js";
import type { WorkflowDefinition } from "../runtime/prompt-step.js";
import { promptStep } from "../runtime/prompt-step.js";
import {
  buildPortfolioRepairPrompt,
  validatePortfolioOutput,
} from "./portfolio-output-validation.js";

export function buildPortfolioWorkflowDefinition(
  resolution: SlotResolution<PortfolioSlots>,
): WorkflowDefinition {
  const s = resolution.resolved;
  const allocationConstraintsAreCompatible = s.positionCount * s.maxSinglePositionPct >= 100;

  return {
    workflowType: "portfolio_builder",
    steps: [
      promptStep(
        "fetch_candidates",
        "Fetch market data and select candidates",
        buildPortfolioPrompt(resolution),
        {
          requiredInputs: ["symbols"],
          expectedOutputs: ["candidate_positions"],
        },
      ),
      promptStep(
        "risk_review",
        "Review risk and diversification",
        `Now review the risk and diversification of this draft portfolio:
1. Use analyze_correlation across all ${s.positionCount} candidates to check for concentration risk.
2. Use analyze_risk on each position for volatility and max drawdown.
3. If correlation is too high (>0.7 between any pair), suggest a replacement to improve diversification.
4. If any position's risk metrics undermine its intended role, lower its allocation, replace it with a role-equivalent candidate, or explicitly justify why it remains.
5. Preserve the hard asset scope "${s.assetScope}" for every replacement.
6. Preserve exactly ${s.positionCount} positions, keep every allocation at or below ${s.maxSinglePositionPct}%, and make the allocations sum to 100%.
7. Confirm the portfolio fits a ${s.riskProfile} risk profile with ${s.timeHorizon} horizon.`,
        {
          skippable: true,
          requiredInputs: ["candidate_positions"],
          expectedOutputs: ["risk_assessment"],
        },
      ),
      promptStep(
        "synthesize",
        "Present final portfolio draft",
        `Present the final portfolio draft as a structured summary:
- State all assumptions at the top (which parameters were defaults vs user-specified vs saved preferences).
- Treat these as hard final constraints: asset scope "${s.assetScope}", exactly ${s.positionCount} positions, no position above ${s.maxSinglePositionPct}%, and allocations summing to 100%.
- If those constraints are mathematically incompatible, say so explicitly instead of violating one. Otherwise, verify the final table satisfies each constraint before presenting it.
- Commit to the allocation: concrete percentages per position, not ranges.
- Present an allocation table: symbol, allocation %, dollar amount ($${s.budget.toLocaleString("en-US")} total), current price used, estimated shares, role, and one-line analyst rationale per position.
- Add a brief "Why this fits the horizon" summary explaining the growth/stability tradeoff for the ${s.timeHorizon} horizon.
- Include overall portfolio risk summary: estimated volatility, diversification quality, largest single risk. State an invalidation condition for the draft.
- Include implementation notes: rebalance cadence, low-cost/liquid implementation, and tax/account caveats where relevant.
- Suggest what to change for more growth or more safety.

Length constraints:
- Max 1 sentence of rationale per position in the allocation table; do not paste company descriptions or issuer background.
- Risk summary: max 3 bullet points.
- Implementation notes: max 3 bullets.
- Growth/safety suggestions: max 2 bullet points each.
- Keep total response under 40 lines.`,
        {
          requiredInputs: ["risk_assessment"],
          expectedOutputs: ["portfolio_summary"],
          ...(allocationConstraintsAreCompatible
            ? {
                outputValidation: {
                  validate: (rawText: string) =>
                    validatePortfolioOutput(rawText, {
                      positionCount: s.positionCount,
                      maxSinglePositionPct: s.maxSinglePositionPct,
                    }),
                  repairPrompt: (errors: string[]) =>
                    buildPortfolioRepairPrompt(
                      errors,
                      {
                        positionCount: s.positionCount,
                        maxSinglePositionPct: s.maxSinglePositionPct,
                      },
                      s.assetScope,
                    ),
                },
              }
            : {}),
        },
      ),
    ],
  };
}
