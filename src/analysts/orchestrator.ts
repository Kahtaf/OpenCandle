export type AnalystRole =
  | "valuation"
  | "momentum"
  | "options"
  | "contrarian"
  | "risk";

const SYMBOL_CAPTURE = "(\\$?[A-Za-z]{1,5}(?:[./-][A-Za-z]{1,2})?)";
const NORMALIZED_SYMBOL_PATTERN = /^[A-Z]{1,5}(?:[./-][A-Z]{1,2})?$/;

const VOTING_INSTRUCTION = `

End your analysis with this exact format:
SIGNAL: BUY | HOLD | SELL
CONVICTION: [1-10]
THESIS: [one sentence summary of your position]`;

const EXECUTION_GUARDRAILS = `
Execution rules:
- Reuse tool outputs that were already fetched earlier in the session. Do not call the same tool again for the same symbol unless you need a missing field.
- If a required provider returns unavailable or missing data, stop that leg quickly, label the missing metrics as unavailable, and continue with the remaining evidence.
- Do not retry the same failing fundamentals call multiple times.`;

const ANALYST_PROMPTS: Record<AnalystRole, (symbol: string) => string> = {
  valuation: (symbol) =>
    `**[Valuation Analyst]** You are a Damodaran-style valuation analyst. Your approach: connect the company's narrative to numbers, then compute intrinsic value. Analyze ${symbol}:
1. Start with get_company_overview for P/E, forward P/E, EPS, profit margin, and market cap.
2. If overview data is available, use get_financials for revenue, income, and free cash flow trends across years.
3. If financial statements are available, use get_earnings for EPS surprise patterns and growth trajectory.
4. Only use compute_dcf once you have the inputs needed to estimate intrinsic value.
Assess: What growth rate is the market implicitly pricing in? Is the current price above or below your intrinsic value range? Cite specific numbers with their source tool. Keep reasoning data-driven — every claim must reference a fetched number.${EXECUTION_GUARDRAILS}${VOTING_INSTRUCTION}`,

  momentum: (symbol) =>
    `**[Momentum Analyst]** You are a CAN SLIM-style momentum analyst. Price action and volume are your primary evidence. Analyze ${symbol}:
1. Use get_stock_history with 1y range, then get_technical_indicators.
2. Focus on: Is price making new highs or breaking down from a base? Is OBV rising (volume confirming) or diverging? Where is price relative to VWAP?
3. Check RSI (overbought >70 / oversold <30) and MACD histogram direction.
4. Identify key support/resistance from Bollinger Bands and SMA(20)/SMA(50).
5. Use get_earnings to check if earnings are accelerating quarter over quarter.
State specific price levels. A breakout on rising volume is bullish; a breakdown on high volume is bearish. No vague language — cite the numbers.${EXECUTION_GUARDRAILS}${VOTING_INSTRUCTION}`,

  options: (symbol) =>
    `**[Options Analyst]** You analyze what the derivatives market is pricing in. Analyze ${symbol}:
1. Use get_option_chain to review the full chain with strikes, volume, open interest, IV, and Greeks.
2. Compute the put/call ratio from volume data — above 1.0 is bearish bias, below 0.7 is bullish.
3. Look for unusually high volume contracts (>3x average OI) that signal institutional positioning.
4. Note the overall IV level — is it elevated (expecting a move) or compressed (quiet period)?
5. Check if smart money is positioning via deep ITM or OTM options with high volume.
What is the options market pricing in that the stock price alone doesn't show?${EXECUTION_GUARDRAILS}${VOTING_INSTRUCTION}`,

  contrarian: (symbol) =>
    `**[Contrarian Analyst]** You are a Burry-style contrarian. Your job is to find what the crowd is missing. Be terse and data-driven — cite concrete numbers like "FCF yield 14.7%" or "P/E 8.3x vs sector 22x." Analyze ${symbol}:
1. Use get_fear_greed for overall market mood — extreme readings signal opportunity.
2. Use get_reddit_sentiment on wallstreetbets and stocks — check the sentiment score. Extreme bullishness from retail is a warning; extreme bearishness may be opportunity.
3. Use get_reddit_discussions for ${symbol} to gauge retail narrative.
4. Cross-reference: Is sentiment overly bullish while fundamentals (revenue, margins, FCF) are deteriorating? Is everyone bearish while the numbers quietly improve?
5. Reuse get_company_overview or other fundamentals already fetched earlier in the session if available. If fundamentals are unavailable, say so and base the contrarian view on sentiment and price only.
Where is the consensus wrong? What is the market over-pricing or under-pricing?${EXECUTION_GUARDRAILS}${VOTING_INSTRUCTION}`,

  risk: (symbol) =>
    `**[Risk Manager]** You are the final check before capital is deployed. Your job is to quantify downside, not to have an opinion on direction. Analyze ${symbol}:
1. Use analyze_risk to compute annualized volatility, Sharpe ratio, max drawdown, and VaR(95%).
2. Position sizing: Using the 2% portfolio risk rule, compute max position size. Formula: position_size = (0.02 * portfolio_value) / (entry_price * stop_loss_pct). Assume $100K portfolio.
3. Risk/reward: Is potential upside at least 2x the max drawdown? If not, the trade is unfavorable regardless of thesis.
4. Correlation: If this is in a portfolio, would it add diversification or concentration risk?
5. Scenario analysis: What is the max realistic downside in a 1-sigma and 2-sigma move?
Be quantitative. Every assessment must include a number.${EXECUTION_GUARDRAILS}${VOTING_INSTRUCTION}`,
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

export function getInitialAnalysisPrompt(symbol: string): string {
  return `Begin comprehensive analysis of ${symbol}. Start by getting the current stock quote.`;
}

export function getComprehensiveAnalysisPrompts(symbol: string): string[] {
  const roles: AnalystRole[] = ["valuation", "momentum", "options", "contrarian", "risk"];
  const prompts = [getInitialAnalysisPrompt(symbol)];

  for (const role of roles) {
    prompts.push(ANALYST_PROMPTS[role](symbol));
  }

  prompts.push(SYNTHESIS_PROMPT(symbol));
  prompts.push(VALIDATION_PROMPT(symbol));

  return prompts;
}

import type { WorkflowDefinition } from "../runtime/prompt-step.js";
import { promptStep } from "../runtime/prompt-step.js";

export function buildComprehensiveAnalysisDefinition(symbol: string): WorkflowDefinition {
  const roles: AnalystRole[] = ["valuation", "momentum", "options", "contrarian", "risk"];

  const steps = [
    promptStep("initial_fetch", "Fetch initial quote data", getInitialAnalysisPrompt(symbol), {
      expectedOutputs: ["quote"],
    }),
    ...roles.map((role) =>
      promptStep(`analyst_${role}`, `${role} analysis`, ANALYST_PROMPTS[role](symbol), {
        skippable: true,
        requiredInputs: ["quote"],
        expectedOutputs: [`${role}_signal`],
      }),
    ),
    promptStep("synthesis", "Synthesize analyst signals", SYNTHESIS_PROMPT(symbol), {
      requiredInputs: roles.map((r) => `${r}_signal`),
      expectedOutputs: ["verdict"],
    }),
    promptStep("validation", "Validate cited numbers", VALIDATION_PROMPT(symbol), {
      skippable: true,
      requiredInputs: ["verdict"],
      expectedOutputs: ["validation_result"],
    }),
  ];

  return { workflowType: "comprehensive_analysis", steps };
}

export function runComprehensiveAnalysis(
  enqueueFollowUp: (prompt: string) => void,
  symbol: string,
): void {
  for (const prompt of getComprehensiveAnalysisPrompts(symbol).slice(1)) {
    enqueueFollowUp(prompt);
  }
}

export function isAnalysisRequest(input: string): { match: boolean; symbol?: string } {
  const patterns = [
    new RegExp(`^analyze\\s+${SYMBOL_CAPTURE}\\s*$`, "i"),
    new RegExp(`^full\\s+analysis\\s+(?:of\\s+)?${SYMBOL_CAPTURE}\\s*$`, "i"),
    new RegExp(`^deep\\s+dive\\s+(?:on\\s+)?${SYMBOL_CAPTURE}\\s*$`, "i"),
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      return { match: true, symbol: match[1].replace(/\$/g, "").toUpperCase() };
    }
  }

  return { match: false };
}

export function normalizeSymbol(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const candidate = trimmed.replace(/\$/g, "").toUpperCase();
  return NORMALIZED_SYMBOL_PATTERN.test(candidate) ? candidate : undefined;
}
