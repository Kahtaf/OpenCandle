import type { Agent } from "@mariozechner/pi-agent-core";

export type AnalystRole =
  | "fundamental"
  | "technical"
  | "options"
  | "sentiment"
  | "risk";

const ANALYST_PROMPTS: Record<AnalystRole, (symbol: string) => string> = {
  fundamental: (symbol) =>
    `**[Fundamental Analyst]** Analyze ${symbol} fundamentals. Use get_company_overview to get valuation metrics (P/E, EPS, market cap, profit margin). Use get_financials for revenue and income trends. Use get_earnings for recent EPS surprises. Assess: Is ${symbol} overvalued, fairly valued, or undervalued? What are the growth drivers and risks? Be data-driven and concise.`,

  technical: (symbol) =>
    `**[Technical Analyst]** Analyze ${symbol} technicals. Use get_stock_history with 1y range, then use get_technical_indicators. Identify: current trend (bullish/bearish/sideways), key support and resistance levels, momentum signals (RSI, MACD), and any notable patterns. What does the chart say about timing?`,

  options: (symbol) =>
    `**[Options Analyst]** Analyze the options chain for ${symbol}. Use get_option_chain to review strikes, volume, open interest, implied volatility, and Greeks. Look at the put/call ratio for directional bias. Identify contracts with unusually high volume or IV. What is the options market pricing in? Any notable positioning?`,

  sentiment: (symbol) =>
    `**[Sentiment Analyst]** Analyze market sentiment for ${symbol}. Use get_fear_greed for overall market mood. Use get_reddit_sentiment on wallstreetbets and stocks subreddits. Use get_news_sentiment for ${symbol}. What is retail sentiment? Is there unusual interest or concern?`,

  risk: (symbol) =>
    `**[Risk Manager]** Assess the risk profile of ${symbol}. Use analyze_risk to compute volatility, Sharpe ratio, max drawdown, and VaR. Consider the fundamental, technical, and sentiment analyses above. What are the key risks? What position sizing would you recommend? Is the risk/reward favorable?`,
};

const SYNTHESIS_PROMPT = (symbol: string) =>
  `**[Synthesis]** Based on all the analyses above (fundamental, technical, options, sentiment, risk), provide a unified investment thesis for ${symbol}. Include:
1. **Verdict**: Buy, Hold, or Sell — with conviction level (High/Medium/Low)
2. **Key thesis** in 2-3 sentences
3. **Bull case** — what could go right
4. **Bear case** — what could go wrong
5. **Key levels** — entry, stop-loss, and target prices
6. **Position sizing recommendation** based on risk profile

Be direct and actionable. This is your final word.`;

export function runComprehensiveAnalysis(agent: Agent, symbol: string): void {
  const roles: AnalystRole[] = ["fundamental", "technical", "options", "sentiment", "risk"];

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
