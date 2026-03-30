import type { OptionsScreenerSlots, SlotResolution } from "../routing/types.js";
import { buildOptionsScreenerPrompt } from "../prompts/workflow-prompts.js";

export interface WorkflowPlan {
  initialPrompt: string;
  followUps: string[];
}

export function buildOptionsScreenerWorkflow(resolution: SlotResolution<OptionsScreenerSlots>): WorkflowPlan {
  const initialPrompt = buildOptionsScreenerPrompt(resolution);
  const s = resolution.resolved;
  const contractType = s.direction === "bullish" ? "calls" : "puts";

  const followUps = [
    `Now rank and present the top ${contractType} for ${s.symbol}:
1. From the option chain data, select the top 3-5 contracts matching: ${s.moneynessPreference} strikes, DTE near ${s.dteTarget}, with ${s.liquidityMinimum}.
2. Rank by ${s.objective}: balance premium cost, delta exposure, and probability of profit. Only include contracts with |delta| >= 0.20.
3. Present a table: strike, expiry, premium, delta, IV, open interest, bid-ask spread.
4. Explain why the #1 pick is ranked highest.
5. State all assumptions used (which were defaults vs user-specified vs saved preferences).
6. Include risk caveats: max loss = premium, IV crush risk, time decay (theta).

Length constraints:
- Max 1 sentence explaining the #1 pick.
- Risk caveats: max 3 bullet points.
- Keep total response under 30 lines.`,
  ];

  return { initialPrompt, followUps };
}
