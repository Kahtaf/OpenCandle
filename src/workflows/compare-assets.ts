import type { CompareAssetsSlots, SlotResolution } from "../routing/types.js";
import { buildCompareAssetsPrompt } from "../prompts/workflow-prompts.js";
import type { WorkflowPlan } from "./types.js";
import type { WorkflowDefinition } from "../runtime/prompt-step.js";
import { promptStep } from "../runtime/prompt-step.js";

export function buildCompareAssetsWorkflowDefinition(
  resolution: SlotResolution<CompareAssetsSlots>,
): WorkflowDefinition {
  const symbols = resolution.resolved.symbols.join(", ");
  const timeHorizon = resolution.resolved.timeHorizon;
  const isMacroHedge = resolution.resolved.metrics?.includes("macro_hedge") ?? false;
  const evidenceList = resolution.resolved.metrics?.includes("sentiment")
    ? "price, technical, risk, and sentiment data"
    : "price, technical, and risk data";
  const horizonGuidance = timeHorizon
    ? `
- Start by directly answering whether these assets are reasonable to compare for a ${timeHorizon} horizon.
- Rank the evidence for that horizon: near-term catalysts, earnings/guidance, estimate revisions, forward-looking valuation evidence, sentiment, macro sensitivity, and company-specific risks before long-term historical metrics.
- Treat unavailable forward-looking evidence as a caveat instead of replacing it with unrelated historical certainty.`
    : "";
  const macroHedgeGuidance = isMacroHedge
    ? `
- Treat this as a macro hedge decision: explain each asset's hedge role, correlation regime, volatility/drawdown profile, and sensitivity to real yields, USD/liquidity, geopolitical shocks, and risk-off drawdowns.
- Do not let missing BTC or ETF-specific metrics turn into a shallow default winner. Explain what the missing metric would have shown and how that lowers confidence.
- Give actionable conditional guidance: conditions under which GLD is the better capital-preservation hedge, and conditions under which BTC is only a higher-volatility debasement/asymmetric-upside sleeve.`
    : "";

  return {
    workflowType: "compare_assets",
    steps: [
      promptStep("fetch_data", "Fetch data for all assets", buildCompareAssetsPrompt(resolution), {
        requiredInputs: ["symbols"],
        expectedOutputs: ["asset_data"],
      }),
      promptStep("compare_and_present", "Present side-by-side comparison", `Now present the side-by-side comparison for ${symbols}:
- Keep any unavailable fundamentals marked as unavailable instead of retrying the same failed provider calls.
- Use the ${evidenceList} you already fetched to finish the comparison even if some fundamentals are missing.
- End with a concise verdict on which asset looks strongest right now and why.${horizonGuidance}${macroHedgeGuidance}`, {
        requiredInputs: ["asset_data"],
        expectedOutputs: ["comparison_summary"],
      }),
    ],
  };
}

/** @deprecated Use buildCompareAssetsWorkflowDefinition instead */
export function buildCompareAssetsWorkflow(
  resolution: SlotResolution<CompareAssetsSlots>,
): WorkflowPlan {
  const def = buildCompareAssetsWorkflowDefinition(resolution);
  return {
    initialPrompt: def.steps[0].prompt,
    followUps: def.steps.slice(1).map((s) => s.prompt),
  };
}
