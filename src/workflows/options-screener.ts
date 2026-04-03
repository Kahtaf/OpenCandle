import type { OptionsScreenerSlots, SlotResolution } from "../routing/types.js";
import { buildOptionsScreenerPrompt } from "../prompts/workflow-prompts.js";
import type { WorkflowPlan } from "./types.js";
import type { WorkflowDefinition } from "../runtime/prompt-step.js";
import { promptStep } from "../runtime/prompt-step.js";

export function buildOptionsScreenerWorkflowDefinition(resolution: SlotResolution<OptionsScreenerSlots>): WorkflowDefinition {
  const s = resolution.resolved;
  const contractType = s.direction === "bullish" ? "calls" : "puts";

  return {
    workflowType: "options_screener",
    steps: [
      promptStep("fetch_chain", "Fetch option chain data", buildOptionsScreenerPrompt(resolution), {
        requiredInputs: ["symbol"],
        expectedOutputs: ["option_chain"],
      }),
      promptStep("rank_and_present", "Rank and present top contracts", `Now rank and present the top ${contractType} for ${s.symbol}:
1. From the option chain data, select the top 3-5 contracts matching: ${s.moneynessPreference} strikes, DTE near ${s.dteTarget}, with ${s.liquidityMinimum}.
2. Rank by ${s.objective}: balance premium cost, delta exposure, and probability of profit. Only include contracts with |delta| >= 0.20.
3. Present a table: strike, expiry, premium, delta, IV, open interest, bid-ask spread.
4. Explain why the #1 pick is ranked highest.
5. State all assumptions used (which were defaults vs user-specified vs saved preferences).
6. Include risk caveats: max loss = premium, IV crush risk, time decay (theta).

Length constraints:
- Max 1 sentence explaining the #1 pick.
- Risk caveats: max 3 bullet points.
- Keep total response under 30 lines.`, {
        requiredInputs: ["option_chain"],
        expectedOutputs: ["ranked_contracts"],
      }),
    ],
  };
}

/** @deprecated Use buildOptionsScreenerWorkflowDefinition instead */
export function buildOptionsScreenerWorkflow(resolution: SlotResolution<OptionsScreenerSlots>): WorkflowPlan {
  const def = buildOptionsScreenerWorkflowDefinition(resolution);
  return {
    initialPrompt: def.steps[0].prompt,
    followUps: def.steps.slice(1).map((s) => s.prompt),
  };
}
