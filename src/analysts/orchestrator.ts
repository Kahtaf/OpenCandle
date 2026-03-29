import type { Agent } from "@mariozechner/pi-agent-core";

export type AnalystRole =
  | "valuation"
  | "momentum"
  | "options"
  | "contrarian"
  | "risk";

const VOTING_INSTRUCTION = `

End your analysis with this exact format:
SIGNAL: BUY | HOLD | SELL
CONVICTION: [1-10]
THESIS: [one sentence summary of your position]`;

const ANALYST_PROMPTS: Record<AnalystRole, (symbol: string) => string> = {
  valuation: (symbol) =>
    `**[Valuation Analyst]** You are a Damodaran-style valuation analyst. Your approach: connect the company's narrative to numbers, then compute intrinsic value. Analyze ${symbol}:
1. Use get_company_overview for P/E, forward P/E, EPS, profit margin, and market cap.
2. Use get_financials for revenue, income, and free cash flow trends across years.
3. Use get_earnings for EPS surprise patterns and growth trajectory.
4. Use compute_dcf to estimate intrinsic value — review the margin of safety and sensitivity table.
Assess: What growth rate is the market implicitly pricing in? Is the current price above or below your intrinsic value range? Cite specific numbers with their source tool. Keep reasoning data-driven — every claim must reference a fetched number.${VOTING_INSTRUCTION}`,

  momentum: (symbol) =>
    `**[Momentum Analyst]** You are a CAN SLIM-style momentum analyst. Price action and volume are your primary evidence. Analyze ${symbol}:
1. Use get_stock_history with 1y range, then get_technical_indicators.
2. Focus on: Is price making new highs or breaking down from a base? Is OBV rising (volume confirming) or diverging? Where is price relative to VWAP?
3. Check RSI (overbought >70 / oversold <30) and MACD histogram direction.
4. Identify key support/resistance from Bollinger Bands and SMA(20)/SMA(50).
5. Use get_earnings to check if earnings are accelerating quarter over quarter.
State specific price levels. A breakout on rising volume is bullish; a breakdown on high volume is bearish. No vague language — cite the numbers.${VOTING_INSTRUCTION}`,

  options: (symbol) =>
    `**[Options Analyst]** You analyze what the derivatives market is pricing in. Analyze ${symbol}:
1. Use get_option_chain to review the full chain with strikes, volume, open interest, IV, and Greeks.
2. Compute the put/call ratio from volume data — above 1.0 is bearish bias, below 0.7 is bullish.
3. Look for unusually high volume contracts (>3x average OI) that signal institutional positioning.
4. Note the overall IV level — is it elevated (expecting a move) or compressed (quiet period)?
5. Check if smart money is positioning via deep ITM or OTM options with high volume.
What is the options market pricing in that the stock price alone doesn't show?${VOTING_INSTRUCTION}`,

  contrarian: (symbol) =>
    `**[Contrarian Analyst]** You are a Burry-style contrarian. Your job is to find what the crowd is missing. Be terse and data-driven — cite concrete numbers like "FCF yield 14.7%" or "P/E 8.3x vs sector 22x." Analyze ${symbol}:
1. Use get_fear_greed for overall market mood — extreme readings signal opportunity.
2. Use get_reddit_sentiment on wallstreetbets and stocks — check the sentiment score. Extreme bullishness from retail is a warning; extreme bearishness may be opportunity.
3. Use get_news_sentiment for ${symbol} to gauge media narrative.
4. Cross-reference: Is sentiment overly bullish while fundamentals (revenue, margins, FCF) are deteriorating? Is everyone bearish while the numbers quietly improve?
5. Use get_company_overview to find metrics the crowd ignores (debt levels, margin trends, cash position).
Where is the consensus wrong? What is the market over-pricing or under-pricing?${VOTING_INSTRUCTION}`,

  risk: (symbol) =>
    `**[Risk Manager]** You are the final check before capital is deployed. Your job is to quantify downside, not to have an opinion on direction. Analyze ${symbol}:
1. Use analyze_risk to compute annualized volatility, Sharpe ratio, max drawdown, and VaR(95%).
2. Position sizing: Using the 2% portfolio risk rule, compute max position size. Formula: position_size = (0.02 * portfolio_value) / (entry_price * stop_loss_pct). Assume $100K portfolio.
3. Risk/reward: Is potential upside at least 2x the max drawdown? If not, the trade is unfavorable regardless of thesis.
4. Correlation: If this is in a portfolio, would it add diversification or concentration risk?
5. Scenario analysis: What is the max realistic downside in a 1-sigma and 2-sigma move?
Be quantitative. Every assessment must include a number.${VOTING_INSTRUCTION}`,
};

const SYNTHESIS_PROMPT = (symbol: string) =>
  `**[Synthesis]** You have received five analyst signals above for ${symbol}. Tally the SIGNAL votes (BUY/HOLD/SELL) and weight them by CONVICTION scores. Then provide:
1. **Vote Tally**: X BUY, Y HOLD, Z SELL — weighted average conviction
2. **Verdict**: Buy, Hold, or Sell — based on the signal consensus
3. **Key thesis** in 2-3 sentences
4. **Bull case** — what could go right
5. **Bear case** — what could go wrong
6. **Key levels** — entry, stop-loss, and target prices
7. **Position sizing recommendation** based on risk profile

Be direct and actionable. This is your final word on ${symbol}.`;

const VALIDATION_PROMPT = (symbol: string) =>
  `**[Validation Check]** Review your complete analysis of ${symbol} above. For each specific number you cited (price, P/E, revenue, RSI, intrinsic value, etc.), verify it matches the tool output data you received. Flag any inconsistencies. If you stated a number without fetching it first, call that out as UNVERIFIED. Output: VALIDATED if all numbers check out, or list specific corrections needed.`;

export function runComprehensiveAnalysis(agent: Agent, symbol: string): void {
  const roles: AnalystRole[] = ["valuation", "momentum", "options", "contrarian", "risk"];

  for (const role of roles) {
    agent.followUp({
      role: "user",
      content: [{ type: "text", text: ANALYST_PROMPTS[role](symbol) }],
      timestamp: Date.now(),
    });
  }

  agent.followUp({
    role: "user",
    content: [{ type: "text", text: SYNTHESIS_PROMPT(symbol) }],
    timestamp: Date.now(),
  });

  agent.followUp({
    role: "user",
    content: [{ type: "text", text: VALIDATION_PROMPT(symbol) }],
    timestamp: Date.now(),
  });
}

export function isAnalysisRequest(input: string): { match: boolean; symbol?: string } {
  const patterns = [
    /^analyze\s+(\$?[A-Za-z]{1,5})\s*$/i,
    /^full\s+analysis\s+(?:of\s+)?(\$?[A-Za-z]{1,5})\s*$/i,
    /^deep\s+dive\s+(?:on\s+)?(\$?[A-Za-z]{1,5})\s*$/i,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      return { match: true, symbol: match[1].replace("$", "").toUpperCase() };
    }
  }

  return { match: false };
}
