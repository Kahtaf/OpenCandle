import { parseDteTarget } from "../routing/defaults.js";
import { areLikelyFundOrIndexSymbols, isFundOrIndexAssetScope } from "../routing/fund-symbols.js";
import { isLongInvestmentHorizon } from "../routing/horizon.js";
import type { RouterOutput } from "../routing/router-types.js";
import type {
  CompareAssetsSlots,
  OptionsScreenerSlots,
  PortfolioSlots,
  SlotResolution,
  SlotSource,
} from "../routing/types.js";

function tag(source: string | undefined): string {
  switch (source) {
    case "default":
      return " [DEFAULT]";
    case "preference":
      return " [SAVED PREFERENCE]";
    default:
      return "";
  }
}

function formatBudget(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayStr(): string {
  return formatLocalDate(new Date());
}

const DISPLAY_NAMES: Record<string, string> = {
  budget: "budget",
  riskProfile: "risk profile",
  timeHorizon: "time horizon",
  assetScope: "asset scope",
  positionCount: "positions",
  maxSinglePositionPct: "max single position",
  symbol: "symbol",
  direction: "direction",
  dteTarget: "DTE target",
  objective: "objective",
  moneynessPreference: "moneyness",
  liquidityMinimum: "liquidity",
  optionStrategy: "option strategy",
  costBasis: "cost basis",
  shareQuantity: "share quantity",
  symbols: "symbols",
  metrics: "metrics",
};

const ASSUMPTIONS_RESPONSE_INSTRUCTION =
  "- Start with the assumptions block above exactly as written. Do not relabel source attribution anywhere else in your response.";

function currentDateLine(date = todayStr()): string {
  return `Current date: ${date}`;
}

/**
 * Build a deterministic assumption disclosure block from resolution.sources.
 * This is the single authoritative provenance representation.
 */
export function buildDisclosureBlock(
  slotValues: Record<string, unknown>,
  slotSources: Record<string, SlotSource | undefined>,
  workflowConstraints?: string[],
): string {
  const userSpecified: string[] = [];
  const fromPreferences: string[] = [];
  const fromPriorContext: string[] = [];
  const fromMemory: string[] = [];
  const defaults: string[] = [];

  for (const [key, source] of Object.entries(slotSources)) {
    const val = slotValues[key];
    const label = DISPLAY_NAMES[key] ?? key;
    const display = `${label} (${val})`;
    switch (source) {
      case "user":
        userSpecified.push(display);
        break;
      case "preference":
        fromPreferences.push(display);
        break;
      case "prior_context":
        fromPriorContext.push(display);
        break;
      case "memory":
        fromMemory.push(display);
        break;
      case "default":
        defaults.push(display);
        break;
    }
  }

  const lines: string[] = [];
  lines.push("Assumptions (reproduce this block exactly — do not relabel sources):");
  if (userSpecified.length > 0) lines.push(`  User-specified: ${userSpecified.join(", ")}`);
  if (fromPreferences.length > 0)
    lines.push(`  From saved preferences: ${fromPreferences.join(", ")}`);
  if (fromPriorContext.length > 0)
    lines.push(`  From prior context: ${fromPriorContext.join(", ")}`);
  if (fromMemory.length > 0) lines.push(`  From memory: ${fromMemory.join(", ")}`);
  if (defaults.length > 0) lines.push(`  Defaults: ${defaults.join(", ")}`);
  if (workflowConstraints && workflowConstraints.length > 0) {
    lines.push(`  Workflow constraints: ${workflowConstraints.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Render the Assumptions block directly from router output. Workflow and
 * fallback routes both call this so provenance labels render consistently.
 * Matches `buildDisclosureBlock` labels verbatim (`User-specified` /
 * `From saved preferences` / `Defaults`).
 */
export function buildAssumptionsBlockFromRouter(
  slots: RouterOutput["slots"],
  workflowConstraints?: string[],
): string {
  const slotValues: Record<string, unknown> = {};
  const slotSources: Record<string, SlotSource | undefined> = {};
  for (const [key, slot] of Object.entries(slots)) {
    slotValues[key] = formatSlotValue(slot.value);
    slotSources[key] = slot.source;
  }
  return buildDisclosureBlock(slotValues, slotSources, workflowConstraints);
}

// Router slot values are `unknown` and may include arrays (e.g. symbols)
// or nested objects. Default `${val}` coercion renders arrays as "a,b"
// (no space) and objects as "[object Object]" — normalize here so the
// shared disclosure renderer sees readable strings.
function formatSlotValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => formatSlotValue(v)).join(", ");
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function buildPortfolioPrompt(resolution: SlotResolution<PortfolioSlots>): string {
  const { resolved: s, sources } = resolution;
  const normalizedScope = s.assetScope.toLowerCase();
  const isStocksOnly = /(?:^|_)stocks?_only(?:$|_)/.test(normalizedScope);
  const isStocksAndEtfs = normalizedScope.includes("stocks_and_etfs");
  const isStocksAndCrypto = normalizedScope.includes("stocks_and_crypto");
  const isFundBuildingBlocks =
    (!isStocksAndEtfs && normalizedScope.includes("etf")) ||
    normalizedScope.includes("fund") ||
    normalizedScope.includes("building_blocks");

  const disclosureBlock = buildDisclosureBlock(
    {
      budget: formatBudget(s.budget),
      riskProfile: s.riskProfile,
      timeHorizon: s.timeHorizon,
      positionCount: s.positionCount,
      assetScope: s.assetScope,
      maxSinglePositionPct: `${s.maxSinglePositionPct}%`,
    },
    sources as Record<string, SlotSource | undefined>,
  );

  const candidateInstruction = isStocksOnly
    ? `Identify exactly ${s.positionCount} individual listed common-stock candidates. Exclude ETFs, funds, indexes, cryptocurrencies, commodities, and cash products.`
    : isStocksAndEtfs
      ? `Identify exactly ${s.positionCount} candidates drawn only from individual listed stocks and exchange-traded funds. Exclude cryptocurrencies and commodity spot products.`
      : isStocksAndCrypto
        ? `Identify exactly ${s.positionCount} candidates drawn only from individual listed stocks and cryptocurrencies. Exclude ETFs and mutual funds.`
        : isFundBuildingBlocks
          ? `Identify exactly ${s.positionCount} diversified fund/ETF building-block candidates appropriate for a ${s.riskProfile} ${s.timeHorizon} portfolio.`
          : `Identify exactly ${s.positionCount} diverse candidates appropriate for a ${s.riskProfile} ${s.timeHorizon} portfolio.`;

  const toolSteps = isFundBuildingBlocks
    ? `1. Identify ${s.positionCount} diversified fund/ETF building-block candidates appropriate for a ${s.riskProfile} ${s.timeHorizon} portfolio.
   Include distinct asset-class roles such as core domestic equity, international equity, fixed income, short-duration or cash-like stability, and inflation-sensitive ballast when appropriate.
2. Use get_stock_quote for each candidate to get current prices.
3. Use analyze_risk on each candidate for volatility, Sharpe, and max drawdown.
4. Use analyze_correlation across all candidates to check diversification.`
    : isStocksAndEtfs
      ? `1. ${candidateInstruction}
2. Use get_stock_quote for each candidate to get current prices.
3. Use get_company_overview only for individual-stock candidates; do not require company fundamentals for ETF candidates.
4. Use analyze_risk on each candidate for volatility, Sharpe, and max drawdown.
5. Use analyze_correlation across all candidates to check diversification.`
      : isStocksAndCrypto
        ? `1. ${candidateInstruction}
   Label every candidate as stock or cryptocurrency. For cryptocurrency candidates, include the canonical CoinGecko id used by the crypto tools.
2. For each stock candidate, use get_stock_quote for current price, get_company_overview for fundamentals, and analyze_risk for volatility, Sharpe, and max drawdown.
3. For each cryptocurrency candidate, use get_crypto_price with its canonical CoinGecko id for current price and get_crypto_history with that same id for dated price history. Do not send cryptocurrencies to stock-only quote, company, or risk tools.
4. Use analyze_correlation only across the stock candidates. Assess stock/crypto diversification from the dated evidence available and explicitly disclose that a cross-asset correlation matrix is unavailable instead of substituting stock symbols for crypto ids.`
        : `1. ${candidateInstruction}
2. Use get_stock_quote for each candidate to get current prices.
3. Use get_company_overview for fundamentals on each candidate.
4. Use analyze_risk on each candidate for volatility, Sharpe, and max drawdown.
5. Use analyze_correlation across all candidates to check diversification.`;

  return `${currentDateLine()}

Build a draft portfolio under these parameters:
- Budget: ${formatBudget(s.budget)}
- Risk profile: ${s.riskProfile}${tag(sources.riskProfile)}
- Time horizon: ${s.timeHorizon}${tag(sources.timeHorizon)}
- Positions: ${s.positionCount}${tag(sources.positionCount)}
- Asset scope: ${s.assetScope}${tag(sources.assetScope)}
- Max single position: ${s.maxSinglePositionPct}%${tag(sources.maxSinglePositionPct)}

Steps:
${toolSteps}

Portfolio construction guardrails:
- Treat asset scope, position count, and maximum position size as hard constraints, not preferences.
- Use exactly ${s.positionCount} eligible positions, make allocations sum to 100%, and keep every position at or below ${s.maxSinglePositionPct}%.
- The eligible universe is "${s.assetScope}". Do not introduce an asset outside that universe during candidate selection or risk review.
- For broad balanced portfolio requests, prefer diversified building blocks over individual-company concentration unless the user explicitly asks for stocks.
- For horizons under 5 years, include enough fixed-income, short-duration, cash-like, or inflation-sensitive ballast to make the drawdown risk match the horizon.
- If a candidate's risk metrics undermine its role (for example materially negative risk-adjusted returns, high drawdown, or excessive correlation), lower the allocation, name a role-equivalent replacement, or explain why you are keeping it.
- Keep rationale tied to each holding's role in this portfolio; do not paste company descriptions or generic issuer background.

${disclosureBlock}

Response format:
${ASSUMPTIONS_RESPONSE_INSTRUCTION}
- Then start the analysis with "Bottom line:" and directly say what portfolio you would build for the user.
- Commit to the draft: give concrete percentages for each position, not ranges, and not "consider allocating X-Y%".
- Present an allocation table: symbol, allocation %, dollar amount, current price used, estimated shares, role, and a one-line analyst rationale for each position (what the data showed and why it belongs in this portfolio).
- After the table, add a brief "Why this fits the horizon" summary explaining the growth/stability tradeoff and horizon-specific risks for the stated time horizon.
- Include a risk summary (portfolio volatility, diversification quality) and an invalidation condition for the overall draft ("revisit if correlation exceeds 0.7 across the core ETFs" or equivalent).
- Include practical implementation notes: rebalance cadence, low-cost/liquid implementation, and tax/account caveats where relevant.
- Suggest what to change for more growth or more safety.`;
}

export function buildOptionsScreenerPrompt(
  resolution: SlotResolution<OptionsScreenerSlots>,
): string {
  const { resolved: s, sources } = resolution;

  const dateStr = todayStr();
  const dteWindow = parseDteTarget(s.dteTarget);
  let expirationSection = "";
  if (dteWindow) {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() + dteWindow.minDays);
    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + dteWindow.maxDays);
    expirationSection = `\nTarget expiration window: ${formatLocalDate(windowStart)} to ${formatLocalDate(windowEnd)}`;
  }

  const isBalanced = s.objective.includes("balanced");
  const workflowConstraints = isBalanced
    ? ["delta >= 0.20 (balanced objective)", "prefer ATM to slightly OTM"]
    : [];

  const rankingConstraints = isBalanced
    ? `
Ranking constraints:
- Only include contracts with |delta| >= 0.20.
- Prefer ATM to slightly OTM before farther OTM.
- Do NOT rank ultra-cheap near-zero-delta contracts as "best."
`
    : "";
  const longDatedInstructions =
    s.dteTarget === "180_plus_days"
      ? `
For LEAPS / long-dated options:
- First call get_option_chain without an expiration to inspect available expirations.
- Choose available expirations inside the target window, then call get_option_chain again with explicit \`expiration\` dates before ranking contracts.
- Do not rank the nearest-expiration chain as a LEAPS result.
`
      : "";

  const disclosureBlock = buildDisclosureBlock(
    {
      symbol: s.symbol,
      direction: s.direction,
      dteTarget: s.dteTarget,
      objective: s.objective,
      moneynessPreference: s.moneynessPreference,
      liquidityMinimum: s.liquidityMinimum,
      ...(s.maxPremium !== undefined ? { maxPremium: formatBudget(s.maxPremium) } : {}),
      ...(s.optionStrategy ? { optionStrategy: s.optionStrategy } : {}),
      ...(s.costBasis !== undefined ? { costBasis: formatBudget(s.costBasis) } : {}),
      ...(s.shareQuantity !== undefined ? { shareQuantity: `${s.shareQuantity} shares` } : {}),
      ...(s.catalystSymbols?.length ? { catalystSymbols: s.catalystSymbols.join(", ") } : {}),
    },
    sources as Record<string, SlotSource | undefined>,
    workflowConstraints,
  );

  const coveredCallContext = [
    s.optionStrategy
      ? `\n- Option strategy: ${s.optionStrategy}${tag(sources.optionStrategy)}`
      : "",
    s.costBasis !== undefined
      ? `\n- Cost basis: ${formatBudget(s.costBasis)} (Position cost basis: ${formatBudget(s.costBasis)})${tag(sources.costBasis)}`
      : "",
    s.shareQuantity !== undefined
      ? `\n- Share quantity: ${s.shareQuantity} shares${tag(sources.shareQuantity)}`
      : "",
    s.catalystSymbols?.length
      ? `\n- Catalyst/context tickers: ${s.catalystSymbols.join(", ")}${tag(sources.catalystSymbols)}`
      : "",
  ].join("");

  const isProtectivePutContext = s.optionStrategy === "protective_put";
  const isCoveredCallContext =
    !isProtectivePutContext &&
    (s.optionStrategy === "covered_call" ||
      s.costBasis !== undefined ||
      (s.catalystSymbols?.length ?? 0) > 0);
  const coveredCallInstructions = isCoveredCallContext
    ? `
Covered-call sale guidance:
- Treat this as selling covered calls against an existing ${s.symbol} share position, not buying calls.
- Treat ${s.symbol} as the option-chain underlying.
- Because the user phrased ${s.symbol} as an existing holding, briefly state that you are treating ${s.symbol} as the held ticker. If they meant memory exposure or a different ticker, tell them to clarify and do not silently switch to another underlying.
- Do not substitute catalyst/context tickers as the option-chain underlying.
- Use catalyst/context tickers only to frame event risk, sympathy moves, and whether a nearer expiration is appropriate.
- Rank by premium collected, strike above cost basis, assignment risk, event risk, and live liquidity.
- Do not describe max loss as the option premium paid. Covered-call sale risks are assignment/capped upside, share-price downside in the owned stock, IV/event risk, and poor exit liquidity.
- If the option-chain tool reports closed_market_or_stale_quotes, do not treat zero bid/ask as confirmed live illiquidity; say the chain was checked outside regular options trading and recheck after regular options trading opens.
- If retrieved contracts have zero bid/ask, zero open interest, or otherwise unusable live quotes, the final answer MUST still include "Best action:" and "Conditional candidate:".
- In that fallback, "Best action:" should be no trade unless the user's broker shows a real bid, and "Conditional candidate:" should be a strike above cost basis labeled conditional on live bid/ask.
`
    : "";
  const protectivePutInstructions = isProtectivePutContext
    ? `
Protective-put hedge guidance:
- Treat this as buying puts to hedge an existing long ${s.symbol} share position, not buying calls.
- Treat ${s.symbol} as the option-chain underlying.
- Rank put contracts by protection per dollar of premium: expiration fit, hedge floor, moneyness, liquidity, and premium as a percent of the stock position.
- For "doesn't cost too much" or similar cost-sensitive language, prefer liquid puts modestly below the current stock price before far-OTM lottery hedges; explain the tradeoff between cheaper premium and weaker protection.
- If share quantity is provided, use 1 put contract per 100 shares when discussing coverage and contract count.
- If share quantity is provided, state total premium for the required number of contracts in the ranked table or top-pick explanation.
- Include the hedge floor: approximate protected stock value at strike, net of premium where possible.
- Mention lower-cost alternatives such as a collar or put spread when outright put premium is high.
- Long protective puts have premium/decay risk and exercise/exit choices; do not frame assignment risk like a short option sale.
`
    : "";
  const topPickExplanation = isCoveredCallContext
    ? `Explain why the top pick is ranked #1. For covered calls with a cost basis, include the effective assignment sale price (strike + premium collected) and compare it with the ${s.costBasis !== undefined ? formatBudget(s.costBasis) : "user's"} cost basis.`
    : "Explain why the top pick is ranked #1.";

  return `${currentDateLine(dateStr)}
Do NOT invent or assume a different current date.${expirationSection}

Screen and rank options contracts for ${s.symbol}:
- Direction: ${s.direction}${tag(sources.direction)}
- DTE target: ${s.dteTarget}${tag(sources.dteTarget)}
- Objective: ${s.objective}${tag(sources.objective)}
- Moneyness: ${s.moneynessPreference}${tag(sources.moneynessPreference)}
- Liquidity: ${s.liquidityMinimum}${tag(sources.liquidityMinimum)}${coveredCallContext}${s.budget ? `\n- Budget: ${formatBudget(s.budget)}` : ""}${s.maxPremium ? `\n- Max premium: ${formatBudget(s.maxPremium)}` : ""}

Steps:
1. Use get_stock_quote for ${s.symbol} to get current price and recent movement.
2. Use get_option_chain for ${s.symbol} to get the full chain with Greeks. If you filter by contract type, pass \`type: "call"\` or \`type: "put"\` in lowercase.
3. Filter contracts matching: ${s.direction === "bullish" && !isProtectivePutContext ? "calls" : "puts"}, DTE near ${s.dteTarget}, ${s.moneynessPreference} strikes.
4. ${isProtectivePutContext ? "Rank by hedge quality: protection per dollar of premium, expiration fit, moneyness, liquidity, and hedge floor." : `Rank by ${s.objective}: balance premium cost, delta exposure, and probability of profit.`}${s.maxPremium !== undefined ? ` Do not rank contracts above the user's max premium of ${formatBudget(s.maxPremium)} unless no contracts under that cap are liquid; if so, say the cap could not be met.` : ""}
5. Filter for ${s.liquidityMinimum}: high open interest and tight bid-ask spread.
${
  s.optionStrategy === "covered_call"
    ? `6. Covered call framing: treat option premium as premium received, not paid. Use the user's cost basis when provided, and include return-if-assigned and assignment/downside risk instead of long-call max-loss framing.
`
    : ""
}${
  isCoveredCallContext && s.costBasis !== undefined
    ? `Cost-basis math: if assigned, share gain/loss is strike minus ${formatBudget(s.costBasis)} before premium. Total return if assigned is (strike - cost basis + premium received) / cost basis.
`
    : ""
}
${longDatedInstructions}
${coveredCallInstructions}
${protectivePutInstructions}
${rankingConstraints}
${disclosureBlock}

Response format:
${ASSUMPTIONS_RESPONSE_INSTRUCTION}
- ${isCoveredCallContext ? `Start with an Interpretation line: "Interpretation: Treating ${s.symbol} as the held ticker because you phrased it as an existing position. If you meant ${s.symbol} as memory exposure or another ticker, clarify before trading."` : isProtectivePutContext ? `Start with an Interpretation line: "Interpretation: Treating this as buying protective puts on an existing long ${s.symbol} share position."` : "State the interpretation only if the user's requested underlying is ambiguous."}
- Present top 3-5 ranked contracts in a table: strike, expiry, premium, delta, gamma, theta, vega, rho, IV, OI, bid-ask spread${isProtectivePutContext ? ", hedge floor, premium % of position" : ""}.
- ${topPickExplanation}
- Verify bid/ask and open interest in the user's broker before trading, even when OC shows live values.
- Include ${isCoveredCallContext ? "covered-call sale risks (assignment/capped upside, share-price downside in the owned stock, IV/event risk, exit liquidity). Do not describe max loss as the option premium paid" : isProtectivePutContext ? "protective-put risks (premium decay/cost, imperfect hedge before the strike, liquidity, and opportunity cost). Do not discuss short-option assignment risk" : "risk caveats (max loss = premium, IV crush risk, time decay)"}.`;
}

export function buildCompareAssetsPrompt(resolution: SlotResolution<CompareAssetsSlots>): string {
  const symbols = resolution.resolved.symbols;
  const symbolList = symbols.join(", ");
  const timeHorizon = resolution.resolved.timeHorizon;
  const budget = resolution.resolved.budget;
  const includeSentiment = resolution.resolved.metrics?.includes("sentiment") ?? false;
  const isMacroHedge = resolution.resolved.metrics?.includes("macro_hedge") ?? false;
  const isInterestRateSensitive = resolution.resolved.metrics?.includes("interest_rates") ?? false;
  const isOverlapComparison = resolution.resolved.metrics?.includes("overlap") ?? false;
  const hasFundContext =
    isFundOrIndexAssetScope(resolution.resolved.assetScope) || areLikelyFundOrIndexSymbols(symbols);
  const shouldProbeFundOverlap =
    !isOverlapComparison && isLongInvestmentHorizon(timeHorizon) && hasFundContext;
  const technicalEndStep = shouldProbeFundOverlap ? 7 : 6;
  const sentimentStep = includeSentiment
    ? `\n${technicalEndStep + 1}. Use get_sentiment_summary for each of: ${symbolList} to compare retail/news sentiment and note source availability.`
    : "";
  const interestRateStep = isInterestRateSensitive
    ? `\n${technicalEndStep + (includeSentiment ? 2 : 1)}. Use get_economic_data for the current Fed funds backdrop. Treat this as historical/current context unless you also have explicit futures or forecast evidence.`
    : "";
  const sentimentMetric = includeSentiment ? ", sentiment score/summary" : "";
  const interestRateGuidance = isInterestRateSensitive
    ? `
interest-rate comparison guidance:
- Separate the user's conditional premise from observed data: if the prompt says rates "start falling," state that the recommendation depends on why rates fall and whether market pricing confirms it.
- Give a compact scenario split: benign disinflation/soft landing, recession or earnings shock, and sticky inflation or renewed rate pressure. State which asset type should benefit in each case and why.
- Connect rates to asset mechanics: duration-like sensitivity of future earnings, cost of capital, earnings resilience, valuation multiples, and risk appetite.
- For ETF or fund comparisons, include concentration and sector-exposure risk when one asset is meaningfully narrower or more growth/technology-heavy than the other.
- If forward valuation, earnings estimates, or rate-futures evidence is unavailable, say that directly and avoid treating historical Fed funds data as a forecast.`
    : "";
  const overlapGuidance = isOverlapComparison
    ? `
ETF overlap guidance:
- Treat this as an ETF overlap and diversification question, not a generic return ranking.
- Lead with whether adding the second ETF creates a mega-cap technology tilt, growth-factor tilt, or real diversification.
- Explain that holdings overlap and sector concentration are not the same as correlation; correlation is supporting evidence, not the answer.
- Use provider top holdings and overlap weights when available. If provider coverage is partial or unavailable, say so directly and fall back to plain-language fund structure.
- Discuss top holdings, shared mega-cap names, sector concentration, and whether the position is a deliberate tilt or accidental duplication.
- avoid treating price, RSI, or generic risk metrics as the main answer.`
    : shouldProbeFundOverlap
      ? `
ETF/fund overlap check:
- If these assets are ETFs, funds, or index products, use provider-backed holdings-overlap evidence before making diversification claims.
- Compare fund role, style/factor tilt, concentration, and broad sector exposure when available; do not invent exact holdings or weights.
- For dividend/income funds versus growth funds over multi-year horizons, explain taxable account dividend drag: dividends can be taxed annually even when reinvested, while more return may be deferred as capital gains in growth-oriented funds. Contrast that with tax-advantaged accounts.
- Include expense ratios, dividend yields, and AUM only when fetched evidence supports them; otherwise tell the user to verify current fund facts before acting.
- Treat holdings overlap and sector concentration as different from correlation; correlation is supporting evidence, not a substitute for constituent exposure.
- If provider holdings coverage is partial or unavailable, say so directly and continue with the available price, risk, and correlation evidence.`
      : "";
  const macroHedgeSteps = isMacroHedge
    ? `
macro hedge decision guidance:
- Treat this as a hedge-role comparison, not a generic "which asset has better recent technicals" ranking.
- Prioritize what each asset hedges: inflation, falling real yields, USD weakness, geopolitical/systemic shocks, liquidity stress, and risk-asset drawdowns.
- Compare volatility, drawdown, and correlation regime stability. If a metric is unavailable for one asset, explain how that limits confidence instead of awarding the other asset by default.
- Use current macro evidence where available: real yields or Fed-rate direction, inflation trend, USD/liquidity backdrop, and risk-on/risk-off conditions.
- Include a compact scenario map for stagflation, rising real yields, liquidity crunch/risk-off, USD debasement, and geopolitical shock. State which asset is likely the better hedge in each scenario and why.
- End with conditional guidance: prefer the steadier hedge for capital preservation; prefer the higher-volatility asset only for debasement/asymmetric-upside exposure.`
    : "";
  const tableInstruction = isMacroHedge
    ? "- Present a comparison table with hedge-relevant columns: hedge role, macro drivers, volatility/drawdown evidence, correlation regime, liquidity/risk-on sensitivity, current data, and missing evidence."
    : isOverlapComparison
      ? "- Present an ETF overlap table with columns: fund role, shared top holdings/overlap weight from provider when available, sector concentration, what exposure is duplicated, what exposure is new, and diversification implication."
      : shouldProbeFundOverlap
        ? "- Present a long-horizon fund comparison table with columns: fund role/style, dividend/income versus growth tradeoff, risk evidence, holdings-overlap availability, tax and expense/yield/AUM verification gaps, and horizon fit."
        : `- Present a comparison table with key metrics: price, P/E, revenue growth, profit margin, RSI, Sharpe, max drawdown${sentimentMetric}.
- Highlight which asset is stronger on each metric.`;
  const technicalRiskSteps = isOverlapComparison
    ? `4. Use analyze_holdings_overlap with symbols [${symbolList}] to fetch provider top holdings and compute pairwise overlap by weight.
5. Use analyze_correlation across [${symbolList}] only as supporting diversification evidence; do not substitute correlation for holdings overlap.
6. Skip momentum/risk tool calls unless the user asks about timing or trade setup; the core question is top holdings and sector overlap.`
    : shouldProbeFundOverlap
      ? `4. Use analyze_holdings_overlap with symbols [${symbolList}] to fetch provider top holdings and compute pairwise overlap by weight.
5. Use analyze_correlation across [${symbolList}] as supporting diversification evidence.
6. Use analyze_risk for each to compare long-horizon risk context.
7. Use get_technical_indicators only as secondary timing context; do not let RSI or short-term momentum dominate the long-horizon fund decision.`
      : `4. Use get_technical_indicators for each to compare momentum and trend.
5. Use analyze_risk for each to compare risk metrics.
6. Use analyze_correlation across [${symbolList}] to check diversification.`;
  const horizonLine = timeHorizon ? `\nTime horizon: ${timeHorizon}` : "";
  const budgetLine = budget !== undefined ? `\nBudget: ${formatBudget(budget)}` : "";
  const horizonSteps = timeHorizon
    ? `
${technicalEndStep + (includeSentiment ? 1 : 0) + (isInterestRateSensitive ? 1 : 0) + 1}. Adapt the comparison to the ${timeHorizon} horizon: prioritize near-term catalysts, earnings/guidance, estimate revisions, sentiment, and forward-looking valuation evidence over long-term historical averages.
${technicalEndStep + (includeSentiment ? 1 : 0) + (isInterestRateSensitive ? 1 : 0) + 2}. Use historical risk and technical metrics as context, but explain what they do and do not imply over ${timeHorizon}.`
    : "";
  const horizonResponse = timeHorizon
    ? `
- Start the verdict by directly answering whether the assets should compare for a ${timeHorizon} horizon and why.
- Prioritize the evidence that matters most over ${timeHorizon}: near-term catalysts, earnings/guidance, forward-looking valuation/estimates, sentiment, macro sensitivity, and company-specific risks.
- Call out evidence that is missing or unavailable, especially forward-looking estimates or company-specific catalysts.`
    : "";
  const actionPlanResponse = timeHorizon
    ? `
- REQUIRED ACTION SECTION: Immediately after the summary verdict and before caveats, include a section exactly titled "### Cautious action plan". Use bullets for preferred tilt, entry conditions, position-sizing caution, downside risk/invalidation trigger, and the missing data that would change the plan for the ${timeHorizon} horizon. If this section is missing, the answer is incomplete.`
    : "";
  const responseHeadingOrder = timeHorizon
    ? `
Use these response headings in this order:
1. Assumptions
2. Comparison table
3. Summary Verdict
4. Cautious action plan
5. Caveats`
    : "";

  const disclosureBlock = buildDisclosureBlock(
    {
      symbols: symbolList,
      ...(timeHorizon ? { timeHorizon } : {}),
      ...(budget !== undefined ? { budget: formatBudget(budget) } : {}),
      ...(resolution.resolved.assetScope ? { assetScope: resolution.resolved.assetScope } : {}),
      ...(resolution.resolved.metrics ? { metrics: resolution.resolved.metrics.join(", ") } : {}),
    },
    resolution.sources as Record<string, SlotSource | undefined>,
  );

  return `${currentDateLine()}

Compare these assets side by side: ${symbolList}${horizonLine}${budgetLine}

Steps:
1. Use get_stock_quote for each of: ${symbolList}.
2. Use compare_companies with symbols [${symbols.map((s) => `"${s}"`).join(", ")}] for peer metrics. If some fundamentals are unavailable, continue the comparison with the available symbols and mark missing metrics as unavailable.
3. Use get_price_comparison with symbols [${symbolList}] and a range that fits the resolved time horizon; use the default comparison range when no time horizon is resolved so the answer includes an indexed price comparison.
${technicalRiskSteps}${sentimentStep}${interestRateStep}${horizonSteps}
${macroHedgeSteps}
${interestRateGuidance}
${overlapGuidance}

${disclosureBlock}

Response format:
${responseHeadingOrder}
${ASSUMPTIONS_RESPONSE_INSTRUCTION}
${tableInstruction}
- Provide a summary verdict: which is most attractive and why.
${actionPlanResponse}
- Note any caveats (different sectors, concentration, market cap disparity, unavailable fundamentals, unavailable forward-looking estimates, etc.).${horizonResponse}`;
}
