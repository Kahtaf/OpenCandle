import { buildCompareAssetsPrompt } from "../prompts/workflow-prompts.js";
import { areLikelyFundOrIndexSymbols, isFundOrIndexAssetScope } from "../routing/fund-symbols.js";
import { isLongInvestmentHorizon } from "../routing/horizon.js";
import type { CompareAssetsSlots, SlotResolution } from "../routing/types.js";
import type { WorkflowDefinition } from "../runtime/prompt-step.js";
import { promptStep } from "../runtime/prompt-step.js";

export function buildCompareAssetsWorkflowDefinition(
  resolution: SlotResolution<CompareAssetsSlots>,
): WorkflowDefinition {
  const symbols = resolution.resolved.symbols.join(", ");
  const timeHorizon = resolution.resolved.timeHorizon;
  const isMacroHedge = resolution.resolved.metrics?.includes("macro_hedge") ?? false;
  const isInterestRateSensitive = resolution.resolved.metrics?.includes("interest_rates") ?? false;
  const isOverlapComparison = resolution.resolved.metrics?.includes("overlap") ?? false;
  const hasFundContext =
    isFundOrIndexAssetScope(resolution.resolved.assetScope) ||
    areLikelyFundOrIndexSymbols(resolution.resolved.symbols);
  const shouldProbeFundOverlap =
    !isOverlapComparison && isLongInvestmentHorizon(timeHorizon) && hasFundContext;
  const evidenceList = resolution.resolved.metrics?.includes("sentiment")
    ? "price, technical, risk, and sentiment data"
    : isOverlapComparison
      ? "quote, holdings-overlap, and correlation data"
      : shouldProbeFundOverlap
        ? "price, technical, risk, correlation, and holdings-overlap data when applicable"
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
- Do not let missing asset-specific metrics turn into a shallow default winner. Explain what each missing metric would have shown and how that lowers confidence.
- Give actionable conditional guidance: conditions under which each asset is the better capital-preservation hedge, diversifier, inflation hedge, duration hedge, liquidity sleeve, or higher-volatility asymmetric-upside sleeve.`
    : "";
  const interestRateGuidance = isInterestRateSensitive
    ? `
- For the rate-sensitive premise, separate benign falling rates from recessionary cuts and sticky-inflation/rate-reversal scenarios before giving the final tilt.
- Discuss concentration or sector-exposure risk when one asset is narrower or more growth-heavy than the other.
- Say whether the rate evidence you used is historical/current data or forward-looking market-pricing evidence; do not treat historical Fed funds data as a forecast.`
    : "";
  const overlapGuidance = isOverlapComparison
    ? `
- For ETF overlap prompts, synthesize the holdings-overlap and shared-exposure evidence first, with correlation only as supporting diversification context.
- State the diversification implication directly: deliberate factor tilt, accidental duplication, or genuinely differentiated exposure.
- If provider holdings coverage was partial or unavailable, say that before giving the practical next step.`
    : shouldProbeFundOverlap
      ? `
- If these assets are ETFs, funds, or index products, synthesize holdings-overlap and shared-exposure evidence before correlation when that provider evidence is available.
- Compare fund role, broad style or sector tilt, dividend/income versus growth tradeoffs, taxable-account dividend drag, and any fetched expense ratio, yield, or AUM evidence.
- If expense ratio, yield, AUM, or constituent detail is unavailable, name that verification gap instead of filling it with approximate fund facts.
- If provider holdings coverage was partial or unavailable, say that before giving the practical next step.`
      : "";
  const verdictInstruction = isOverlapComparison
    ? "End with a concise verdict on whether the added fund improves diversification or mostly duplicates existing exposure."
    : shouldProbeFundOverlap
      ? "End with a concise verdict tied to the user's horizon, fund roles, and diversification needs rather than short-term timing."
      : timeHorizon
        ? `End with a concise verdict on which asset best fits the ${timeHorizon} horizon and why.`
        : "End with a concise verdict on which asset looks strongest right now and why.";
  const actionPlanGuidance = timeHorizon
    ? `\n- Required action section: immediately after the summary verdict and before caveats, add a section exactly titled "Cautious action plan" for the ${timeHorizon} horizon. Include preferred tilt, entry conditions, position-sizing caution, downside risk/invalidation trigger, and the missing data that would change the plan. Do not end at Caveats.`
    : "";
  return {
    workflowType: "compare_assets",
    steps: [
      promptStep("fetch_data", "Fetch data for all assets", buildCompareAssetsPrompt(resolution), {
        requiredInputs: ["symbols"],
        expectedOutputs: ["asset_data"],
      }),
      promptStep(
        "compare_and_present",
        "Present side-by-side comparison",
        `Now present the side-by-side comparison for ${symbols}:
- Keep any unavailable fundamentals marked as unavailable instead of retrying the same failed provider calls.
- Use the ${evidenceList} you already fetched to finish the comparison even if some fundamentals are missing.
- ${verdictInstruction}${horizonGuidance}${macroHedgeGuidance}${interestRateGuidance}${overlapGuidance}${actionPlanGuidance}`,
        {
          requiredInputs: ["asset_data"],
          expectedOutputs: ["comparison_summary"],
        },
      ),
    ],
  };
}
