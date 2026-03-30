import type { CompareAssetsSlots, SlotResolution } from "../routing/types.js";
import { buildCompareAssetsPrompt } from "../prompts/workflow-prompts.js";
import type { WorkflowPlan } from "./types.js";

export function buildCompareAssetsWorkflow(
  resolution: SlotResolution<CompareAssetsSlots>,
): WorkflowPlan {
  const symbols = resolution.resolved.symbols.join(", ");

  return {
    initialPrompt: buildCompareAssetsPrompt(resolution),
    followUps: [
      `Now present the side-by-side comparison for ${symbols}:
- Keep any unavailable fundamentals marked as unavailable instead of retrying the same failed provider calls.
- Use the price, technical, and risk data you already fetched to finish the comparison even if some fundamentals are missing.
- End with a concise verdict on which asset looks strongest right now and why.`,
    ],
  };
}
