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
      promptStep("rank_and_present", "Rank and present top contracts", `Now rank and present the top ${contractType} for ${s.symbol}. You MUST produce a final text response — never end this turn with only tool calls.

1. From the option chain data already fetched, select the top 3-5 contracts matching: ${s.moneynessPreference} strikes, DTE near ${s.dteTarget}, with ${s.liquidityMinimum}.
2. Rank by ${s.objective}: balance premium cost, delta exposure, and probability of profit. Only include contracts with |delta| >= 0.20.
3. Present a table: strike, expiry, premium, delta, gamma, theta, vega, rho, IV, open interest, bid-ask spread.
4. Explain why the #1 pick is ranked highest.
5. State all assumptions used (which were defaults vs user-specified vs saved preferences).
6. Include risk caveats: max loss = premium, IV crush risk, time decay (theta).

If some or all of the option chain fetches returned "⚠ Options chain unavailable" or similar gaps, do NOT abort. Instead:
- Rank and present whatever contracts you did retrieve from the successful fetches, even if fewer than 3.
- If no chain data is usable at all, still produce a text response: reproduce the Assumptions block, state which expirations failed, and commit to a next step (e.g. "retry nearest monthly expiration", "use price/technicals instead"). Never end the turn with only tool calls.

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
