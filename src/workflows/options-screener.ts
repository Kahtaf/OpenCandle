import { buildOptionsScreenerPrompt } from "../prompts/workflow-prompts.js";
import type { OptionsScreenerSlots, SlotResolution } from "../routing/types.js";
import type { WorkflowDefinition } from "../runtime/prompt-step.js";
import { promptStep } from "../runtime/prompt-step.js";

export function buildOptionsScreenerWorkflowDefinition(
  resolution: SlotResolution<OptionsScreenerSlots>,
): WorkflowDefinition {
  const s = resolution.resolved;
  const isProtectivePutContext = s.optionStrategy === "protective_put";
  const contractType = s.direction === "bullish" && !isProtectivePutContext ? "calls" : "puts";
  const horizonPhrase = describeDteTarget(s.dteTarget);
  const isCoveredCallContext =
    !isProtectivePutContext &&
    (s.optionStrategy === "covered_call" ||
      s.costBasis !== undefined ||
      (s.catalystSymbols?.length ?? 0) > 0);
  const rankingInstruction = isProtectivePutContext
    ? "Rank by protection per dollar of premium, expiration fit, moneyness, hedge floor, live liquidity, and premium as a percent of the stock position."
    : isCoveredCallContext
      ? "Rank by premium collected, strike above cost basis, assignment risk, event risk, live liquidity, and probability of expiring out of the money."
      : `Rank by ${s.objective}: balance premium cost, delta exposure, and probability of profit. Only include contracts with |delta| >= 0.20.`;
  const maxPremiumInstruction =
    s.maxPremium !== undefined
      ? ` Do not rank contracts above the user's max premium of $${s.maxPremium.toLocaleString("en-US")} unless no contracts under that cap are liquid; if so, say the cap could not be met.`
      : "";
  const riskInstruction = isProtectivePutContext
    ? "Include protective-put hedge risks: premium decay/cost, imperfect hedge before the strike, liquidity, and opportunity cost. Long protective puts do not have short-option assignment risk."
    : isCoveredCallContext
      ? "Include covered-call sale risks: assignment risk, upside is capped at the strike plus premium, share-price downside in the owned stock less premium received, IV/event risk, and exit liquidity. Do not say max loss = premium or describe max loss as the option premium paid."
      : "Include risk caveats: max loss = premium, IV crush risk, time decay (theta).";
  const coveredCallFallback = isCoveredCallContext
    ? `
	Covered-call fallback:
- Treat this as selling covered calls against an existing ${s.symbol} share position, not buying calls.
- Briefly state that you are treating ${s.symbol} as the held ticker because the user phrased it as an existing holding. If they meant memory exposure or a different ticker, tell them to clarify and do not silently switch to another underlying.
- If retrieved contracts have zero bid/ask, zero open interest, or otherwise unusable live quotes, do not stop at "cannot rank."
- This fallback overrides the normal ranking/table requirements and the delta >= 0.20 filter.
- Do NOT conclude with "I cannot provide a recommendation" in this fallback case.
- The final answer MUST include:
  - "Best action:" no trade unless the user's broker shows a real bid.
  - "Conditional candidate:" a conditional limit-order candidate using the user's cost basis and catalyst context.
- If you cannot compute an exact premium, say "premium: use live broker bid/ask" rather than omitting the candidate.
- Choose a conditional candidate strike above cost basis that the user would accept for assignment, prefer near-term expirations around the catalyst, and label it as conditional on live bid/ask and premium collected.
- For the top pick, include the effective assignment sale price (strike + premium collected) and compare it with the ${s.costBasis !== undefined ? `$${s.costBasis}` : "user's"} cost basis.
- Include return-if-assigned when cost basis is available: (strike - cost basis + premium received) / cost basis.
- Verify bid/ask and open interest in the user's broker before trading, even when OC shows live values.
- Mention the catalyst only as event/sympathy risk; do not switch the underlying away from ${s.symbol}.
- Do not describe max loss as the option premium paid; covered-call sale risk is assignment risk, upside is capped at strike plus premium, share-price downside in the owned stock less premium received, IV/event risk, and poor exit liquidity.
- If the tool reports closed_market_or_stale_quotes, do not treat zero bid/ask as confirmed live illiquidity; say the chain was checked outside regular options trading and recheck after regular options trading opens.
- Required fallback format:
  Interpretation: Treating ${s.symbol} as the held ticker because you phrased it as an existing position. If you meant ${s.symbol} as memory exposure or another ticker, clarify before trading.
  Best action: ...
  Conditional candidate: ...
  Why: ...
  Risk: ...
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
- If share quantity is available, state total premium for the required number of contracts.
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
      promptStep(
        "rank_and_present",
        "Rank and present top contracts",
        `Now rank and present the top ${contractType} for ${s.symbol}. You MUST produce a final text response — never end this turn with only tool calls.

1. From the option chain data already fetched, select the top 3-5 contracts matching: ${s.moneynessPreference} strikes, DTE near ${s.dteTarget}, with ${s.liquidityMinimum}.
2. ${rankingInstruction}${maxPremiumInstruction}
3. Present a table: strike, expiry, premium, delta, gamma, theta, vega, rho, IV, open interest, bid-ask spread.
4. Explain why the #1 pick is ranked highest.
5. Reproduce the exact Assumptions block from the initial prompt; keep the provenance label text intact and do not shorten it to "Assumptions:".
6. State the requested option horizon in plain language (${horizonPhrase}) in the bottom line or table intro; use the user's horizon wording or approximate DTE window without forcing a fixed sentence.
7. ${riskInstruction}

If some or all of the option chain fetches returned "⚠ Options chain unavailable" or similar gaps, do NOT abort. Instead:
- Rank and present whatever contracts you did retrieve from the successful fetches, even if fewer than 3.
- If no chain data is usable at all, still produce a text response: reproduce the Assumptions block, state which expirations failed, and give actionable fallback guidance for the requested DTE instead of ranking nonexistent contracts. Do not promise to retry later. Never end the turn with only tool calls.
${coveredCallNoDataGuidance}
${coveredCallFallback}
${protectivePutFallback}

Length constraints:
- Max 1 sentence explaining the #1 pick.
- Risk section: max 3 bullets.
- Keep total response under 30 lines.`,
        {
          requiredInputs: ["option_chain"],
          expectedOutputs: ["ranked_contracts"],
        },
      ),
    ],
  };
}

function describeDteTarget(dteTarget: string): string {
  if (dteTarget === "25_to_45_days") return "25-45 day target, roughly one month";
  if (dteTarget === "7_to_14_days") return "1-2 week horizon";
  if (dteTarget === "0_to_7_days") return "event-week or 0-7 day horizon";
  if (dteTarget === "180_plus_days") return "LEAPS or long-dated horizon";
  const range = dteTarget.match(/^(\d+)_to_(\d+)_days$/);
  if (range) return `${range[1]}-${range[2]} day horizon`;
  const plus = dteTarget.match(/^(\d+)_plus_days$/);
  if (plus) return `${plus[1]}+ day horizon`;
  return `${dteTarget} horizon`;
}
