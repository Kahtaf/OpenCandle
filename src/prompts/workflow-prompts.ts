import type {
  PortfolioSlots,
  OptionsScreenerSlots,
  CompareAssetsSlots,
  SlotResolution,
  SlotSource,
} from "../routing/types.js";
import { parseDteTarget } from "../routing/defaults.js";

function tag(source: string | undefined): string {
  switch (source) {
    case "default":
      return " [DEFAULT]";
    case "preference":
      return " [SAVED PREFERENCE]";
    case "user":
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
  symbols: "symbols",
};

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
      case "default":
        defaults.push(display);
        break;
    }
  }

  const lines: string[] = [];
  lines.push("Assumptions (reproduce this block exactly — do not relabel sources):");
  if (userSpecified.length > 0) lines.push(`  User-specified: ${userSpecified.join(", ")}`);
  if (fromPreferences.length > 0) lines.push(`  From saved preferences: ${fromPreferences.join(", ")}`);
  if (defaults.length > 0) lines.push(`  Defaults: ${defaults.join(", ")}`);
  if (workflowConstraints && workflowConstraints.length > 0) {
    lines.push(`  Workflow constraints: ${workflowConstraints.join(", ")}`);
  }

  return lines.join("\n");
}

export function buildPortfolioPrompt(resolution: SlotResolution<PortfolioSlots>): string {
  const { resolved: s, sources } = resolution;
  const isEtfOnly = s.assetScope.toLowerCase().startsWith("etf");

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

  const toolSteps = isEtfOnly
    ? `1. Identify ${s.positionCount} diverse ETF candidates appropriate for a ${s.riskProfile} ${s.timeHorizon} portfolio.
2. Use get_stock_quote for each candidate to get current prices.
3. Use analyze_risk on each candidate for volatility, Sharpe, and max drawdown.
4. Use analyze_correlation across all candidates to check diversification.`
    : `1. Identify ${s.positionCount} diverse candidates appropriate for a ${s.riskProfile} ${s.timeHorizon} portfolio.
2. Use get_stock_quote for each candidate to get current prices.
3. Use get_company_overview for fundamentals on each candidate.
4. Use analyze_risk on each candidate for volatility, Sharpe, and max drawdown.
5. Use analyze_correlation across all candidates to check diversification.`;

  return `Current date: ${todayStr()}

Build a draft portfolio under these parameters:
- Budget: ${formatBudget(s.budget)}
- Risk profile: ${s.riskProfile}${tag(sources.riskProfile)}
- Time horizon: ${s.timeHorizon}${tag(sources.timeHorizon)}
- Positions: ${s.positionCount}${tag(sources.positionCount)}
- Asset scope: ${s.assetScope}${tag(sources.assetScope)}
- Max single position: ${s.maxSinglePositionPct}%${tag(sources.maxSinglePositionPct)}

Steps:
${toolSteps}

${disclosureBlock}

Response format:
- Start with the assumptions block above exactly as written. Do not relabel source attribution anywhere else in your response.
- This is an educational sample allocation request. Build the draft portfolio and include the standard disclaimer instead of refusing.
- Present an allocation table: symbol, allocation %, dollar amount, and rationale for each position.
- Include a risk summary (portfolio volatility, diversification quality).
- Suggest what to change for more growth or more safety.
- Include the standard disclaimer.`;
}

export function buildOptionsScreenerPrompt(resolution: SlotResolution<OptionsScreenerSlots>): string {
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

  const disclosureBlock = buildDisclosureBlock(
    {
      symbol: s.symbol,
      direction: s.direction,
      dteTarget: s.dteTarget,
      objective: s.objective,
      moneynessPreference: s.moneynessPreference,
      liquidityMinimum: s.liquidityMinimum,
    },
    sources as Record<string, SlotSource | undefined>,
    workflowConstraints,
  );

  return `Current date: ${dateStr}
Do NOT invent or assume a different current date.${expirationSection}

Screen and rank options contracts for ${s.symbol}:
- Direction: ${s.direction}${tag(sources.direction)}
- DTE target: ${s.dteTarget}${tag(sources.dteTarget)}
- Objective: ${s.objective}${tag(sources.objective)}
- Moneyness: ${s.moneynessPreference}${tag(sources.moneynessPreference)}
- Liquidity: ${s.liquidityMinimum}${tag(sources.liquidityMinimum)}${s.budget ? `\n- Budget: ${formatBudget(s.budget)}` : ""}${s.maxPremium ? `\n- Max premium: ${formatBudget(s.maxPremium)}` : ""}

Steps:
1. Use get_stock_quote for ${s.symbol} to get current price and recent movement.
2. Use get_option_chain for ${s.symbol} to get the full chain with Greeks. If you filter by contract type, pass \`type: "call"\` or \`type: "put"\` in lowercase.
3. Filter contracts matching: ${s.direction === "bullish" ? "calls" : "puts"}, DTE near ${s.dteTarget}, ${s.moneynessPreference} strikes.
4. Rank by ${s.objective}: balance premium cost, delta exposure, and probability of profit.
5. Filter for ${s.liquidityMinimum}: high open interest and tight bid-ask spread.
${rankingConstraints}
${disclosureBlock}

Response format:
- Start with the assumptions block above exactly as written. Do not relabel source attribution anywhere else in your response.
- Present top 3-5 ranked contracts in a table: strike, expiry, premium, delta, IV, OI, bid-ask spread.
- Explain why the top pick is ranked #1.
- Include risk caveats (max loss = premium, IV crush risk, time decay).`;
}

export function buildCompareAssetsPrompt(resolution: SlotResolution<CompareAssetsSlots>): string {
  const symbols = resolution.resolved.symbols;
  const symbolList = symbols.join(", ");

  const disclosureBlock = buildDisclosureBlock(
    { symbols: symbolList },
    resolution.sources as Record<string, SlotSource | undefined>,
  );

  return `Current date: ${todayStr()}

Compare these assets side by side: ${symbolList}

Steps:
1. Use get_stock_quote for each of: ${symbolList}.
2. Use compare_companies with symbols [${symbols.map((s) => `"${s}"`).join(", ")}] for peer metrics. If some fundamentals are unavailable, continue the comparison with the available symbols and mark missing metrics as unavailable.
3. Use get_technical_indicators for each to compare momentum and trend.
4. Use analyze_risk for each to compare risk metrics.
5. Use analyze_correlation across [${symbolList}] to check diversification.

${disclosureBlock}

Response format:
- Start with the assumptions block above exactly as written. Do not relabel source attribution anywhere else in your response.
- Present a comparison table with key metrics: price, P/E, revenue growth, profit margin, RSI, Sharpe, max drawdown.
- Highlight which asset is stronger on each metric.
- Provide a summary verdict: which is most attractive and why.
- Note any caveats (different sectors, market cap disparity, unavailable fundamentals, etc.).`;
}
