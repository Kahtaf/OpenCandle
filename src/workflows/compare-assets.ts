import type { CompareAssetsSlots, SlotResolution } from "../routing/types.js";
import { buildCompareAssetsPrompt } from "../prompts/workflow-prompts.js";
import type { WorkflowPlan } from "./types.js";
import type { WorkflowDefinition } from "../runtime/prompt-step.js";
import { promptStep } from "../runtime/prompt-step.js";

export function buildCompareAssetsWorkflowDefinition(
  resolution: SlotResolution<CompareAssetsSlots>,
): WorkflowDefinition {
  const symbols = resolution.resolved.symbols.join(", ");

  return {
    workflowType: "compare_assets",
    steps: [
      promptStep("fetch_data", "Fetch data for all assets", buildCompareAssetsPrompt(resolution), {
        requiredInputs: ["symbols"],
        expectedOutputs: ["asset_data"],
      }),
      promptStep("compare_and_present", "Present side-by-side comparison", `Now present the side-by-side comparison for ${symbols}:
- Keep any unavailable fundamentals marked as unavailable instead of retrying the same failed provider calls.
- Use the price, technical, and risk data you already fetched to finish the comparison even if some fundamentals are missing.
- End with a concise verdict on which asset looks strongest right now and why.`, {
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
