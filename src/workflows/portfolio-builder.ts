import type { PortfolioSlots, SlotResolution } from "../routing/types.js";
import { buildPortfolioPrompt } from "../prompts/workflow-prompts.js";
import type { WorkflowPlan } from "./types.js";
import type { WorkflowDefinition } from "../runtime/prompt-step.js";
import { promptStep } from "../runtime/prompt-step.js";

export function buildPortfolioWorkflowDefinition(resolution: SlotResolution<PortfolioSlots>): WorkflowDefinition {
  const s = resolution.resolved;

  return {
    workflowType: "portfolio_builder",
    steps: [
      promptStep("fetch_candidates", "Fetch market data and select candidates", buildPortfolioPrompt(resolution), {
        requiredInputs: ["symbols"],
        expectedOutputs: ["candidate_positions"],
      }),
      promptStep("risk_review", "Review risk and diversification", `Now review the risk and diversification of this draft portfolio:
1. Use analyze_correlation across all ${s.positionCount} candidates to check for concentration risk.
2. Use analyze_risk on each position for volatility and max drawdown.
3. If correlation is too high (>0.7 between any pair), suggest a replacement to improve diversification.
4. Confirm the portfolio fits a ${s.riskProfile} risk profile with ${s.timeHorizon} horizon.`, {
        skippable: true,
        requiredInputs: ["candidate_positions"],
        expectedOutputs: ["risk_assessment"],
      }),
      promptStep("synthesize", "Present final portfolio draft", `Present the final portfolio draft as a structured summary:
- State all assumptions at the top (which parameters were defaults vs user-specified vs saved preferences).
- Present an allocation table: symbol, allocation %, dollar amount ($${s.budget.toLocaleString("en-US")} total), and one-line rationale per position.
- Include overall portfolio risk summary: estimated volatility, diversification quality, largest single risk.
- Suggest what to change for more growth or more safety.
- End with the standard disclaimer.

Length constraints:
- Max 1 sentence of rationale per position in the allocation table.
- Risk summary: max 3 bullet points.
- Growth/safety suggestions: max 2 bullet points each.
- Keep total response under 40 lines.`, {
        requiredInputs: ["risk_assessment"],
        expectedOutputs: ["portfolio_summary"],
      }),
    ],
  };
}

/** @deprecated Use buildPortfolioWorkflowDefinition instead */
export function buildPortfolioWorkflow(resolution: SlotResolution<PortfolioSlots>): WorkflowPlan {
  const def = buildPortfolioWorkflowDefinition(resolution);
  return {
    initialPrompt: def.steps[0].prompt,
    followUps: def.steps.slice(1).map((s) => s.prompt),
  };
}
