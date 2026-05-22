import type { OptionsScreenerSlots, SlotResolution } from "../routing/types.js";
import { buildOptionsScreenerPrompt } from "../prompts/workflow-prompts.js";
import type { WorkflowPlan } from "./types.js";
import type { WorkflowDefinition } from "../runtime/prompt-step.js";
import { promptStep } from "../runtime/prompt-step.js";

export function buildOptionsScreenerWorkflowDefinition(resolution: SlotResolution<OptionsScreenerSlots>): WorkflowDefinition {
  const s = resolution.resolved;
  const isProtectivePutContext = s.optionStrategy === "protective_put";
  const contractType = s.direction === "bullish" && !isProtectivePutContext ? "calls" : "puts";
  const isCoveredCallContext = !isProtectivePutContext && (
    s.optionStrategy === "covered_call" ||
    s.costBasis !== undefined ||
    (s.catalystSymbols?.length ?? 0) > 0
  );
  const rankingInstruction = isProtectivePutContext
    ? "Rank by protection per dollar of premium, expiration fit, moneyness, hedge floor, live liquidity, and premium as a percent of the stock position."
    : isCoveredCallContext
    ? "Rank by premium collected, strike above cost basis, assignment risk, event risk, live liquidity, and probability of expiring out of the money."
    : `Rank by ${s.objective}: balance premium cost, delta exposure, and probability of profit. Only include contracts with |delta| >= 0.20.`;
  const maxPremiumInstruction = s.maxPremium !== undefined
    ? ` Do not rank contracts above the user's max premium of $${s.maxPremium.toLocaleString("en-US")} unless no contracts under that cap are liquid; if so, say the cap could not be met.`
    : "";
  const riskInstruction = isProtectivePutContext
    ? "Include protective-put hedge risks: premium decay/cost, imperfect hedge before the strike, liquidity, and opportunity cost. Long protective puts do not have short-option assignment risk."
    : isCoveredCallContext
    ? "Include covered-call sale risks: assignment risk, upside is capped at the strike plus premium, share-price downside in the owned stock less premium received, IV/event risk, and exit liquidity. Do not say max loss = premium or describe max loss as the option premium paid."
    : "Include risk caveats: max loss = premium, IV crush risk, time decay (theta).";
  const coveredCallFallback = isCoveredCallContext
    ? `
Covered call requirements:
- Treat the option premium as premium received, not premium paid.
- Do not say max loss = premium. For a covered call, downside remains tied to the shares less premium received, upside is capped at the strike plus premium, and assignment risk rises with delta.
${s.costBasis !== undefined
  ? `- Use the user's ${s.costBasis} cost basis to calculate return-if-assigned: (strike - cost basis + premium received) / cost basis.`
  : "- If no cost basis is available, state that return-if-assigned needs the user's basis."}
`
    : "";
  const coveredCallNoDataGuidance = isCoveredCallContext
    ? "- For covered-call requests in that no-data fallback, explain how to evaluate covered calls: compare 1-week vs 2-week theta/gamma tradeoffs, use delta as an assignment-risk proxy, avoid strikes where assignment would violate the user's cost basis unless premium offsets it, calculate static premium yield and return-if-assigned, and flag catalyst/IV-crush risk."
    : "";
  const protectivePutFallback = isProtectivePutContext
    ? `
Protective-put requirements:
- Treat this as buying puts to hedge an existing long ${s.symbol} share position, not buying calls.
- The final answer MUST discuss hedge floor, premium as a percent of position value, expiration fit, moneyness, and liquidity.
- If share quantity is available, translate shares into approximate contract count using 1 put contract per 100 shares.
- For cost-sensitive requests, explain the tradeoff between cheaper lower-strike puts and weaker protection.
- Mention lower-cost alternatives such as collars or put spreads when outright put premium is high.
- Do not frame assignment risk like a short option sale.
`
    : "";

  return {
    workflowType: "options_screener",
    steps: [
      promptStep("fetch_chain", "Fetch option chain data", buildOptionsScreenerPrompt(resolution), {
        requiredInputs: ["symbol"],
        expectedOutputs: ["option_chain"],
      }),
      promptStep("rank_and_present", "Rank and present top contracts", `Now rank and present the top ${contractType} for ${s.symbol}. You MUST produce a final text response — never end this turn with only tool calls.

1. From the option chain data already fetched, select the top 3-5 contracts matching: ${s.moneynessPreference} strikes, DTE near ${s.dteTarget}, with ${s.liquidityMinimum}.
2. ${rankingInstruction}${maxPremiumInstruction}
3. Present a table: strike, expiry, premium, delta, gamma, theta, vega, rho, IV, open interest, bid-ask spread.
4. Explain why the #1 pick is ranked highest.
5. State all assumptions used (which were defaults vs user-specified vs saved preferences).
6. Include risk caveats appropriate to the user's strategy. If the user asked about selling a covered call, do not say max loss = premium; explain that downside remains tied to the shares less premium received, upside is capped at the strike plus premium, and assignment risk rises with delta.
${coveredCallInstructions}

If some or all of the option chain fetches returned "⚠ Options chain unavailable" or similar gaps, do NOT abort. Instead:
- Rank and present whatever contracts you did retrieve from the successful fetches, even if fewer than 3.
- If no chain data is usable at all, still produce a text response: reproduce the Assumptions block, state which expirations failed, and give actionable fallback guidance for the requested DTE instead of ranking nonexistent contracts. Do not promise to retry later. Never end the turn with only tool calls.
${coveredCallNoDataGuidance}
${coveredCallFallback}
${protectivePutFallback}

Length constraints:
- Max 1 sentence explaining the #1 pick.
- Risk section: max 3 bullets.
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
