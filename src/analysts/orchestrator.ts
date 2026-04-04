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

export function buildBullPrompt(symbol: string): string {
  return `**[Bull Researcher]** You have received five analyst perspectives above for ${symbol}.
Build the strongest possible case FOR this position.

Rules:
- Cite analyst outputs and underlying tool evidence where available.
- Address any bearish signals (SELL votes, high VaR, negative sentiment) and explain why they are less concerning than they appear.
- You may call up to 2 tools if you identify a specific gap in the existing evidence. State the gap before calling the tool.
- Reuse data already fetched in the session.
${EXECUTION_GUARDRAILS}

End with this exact format:
BULL THESIS: [2-3 sentences building the case for the position]
KEY RISK TO THIS THESIS: [one sentence — the single thing that would invalidate your case]`;
}

export function buildBearPrompt(symbol: string): string {
  return `**[Bear Researcher]** You have received five analyst perspectives and a bull case above for ${symbol}. Your job is to dismantle the bull thesis.

Rules:
- Attack the weakest assumptions in the bull case above.
- Cite analyst outputs and underlying tool evidence where available.
- If the bull case ignored negative data points, surface them.
- You may call up to 2 tools if you identify a specific gap in the existing evidence. State the gap before calling the tool.
- Reuse data already fetched in the session.
${EXECUTION_GUARDRAILS}

End with this exact format:
BEAR THESIS: [2-3 sentences arguing against the position]
WHAT WOULD CHANGE MY MIND: [one sentence — what data would make you concede to the bull]`;
}

export function buildRebuttalPrompt(symbol: string): string {
  return `**[Bull Rebuttal]** First, check the five analyst SIGNAL: lines above for ${symbol} (each analyst ended with "SIGNAL: BUY", "SIGNAL: HOLD", or "SIGNAL: SELL").
If there is NO case where at least one analyst said SIGNAL: BUY and at least one said SIGNAL: SELL, respond with ONLY:
REBUTTAL SKIPPED — consensus reached.

Otherwise, the bear raised specific concerns above. Address each one directly.

Rules:
- Concede any point where the bear is factually correct.
- For points you rebut, cite specific data from the analysts above.
- Do not repeat your original thesis — respond to the bear's NEW arguments.
- No tool calls in the rebuttal. Work with existing evidence only.
${EXECUTION_GUARDRAILS}

End with this exact format:
CONCESSIONS: [bullet list of points you concede]
REMAINING CONVICTION: [1-10, where 10 = fully confident despite bear case]`;
}

export function buildSynthesisPrompt(symbol: string): string {
  return `**[Synthesis]** You have received five analyst signals with conviction scores for ${symbol}, a bull case arguing FOR the position, and a bear case arguing AGAINST.
If a bull rebuttal with concessions appears above (not a line starting with "REBUTTAL SKIPPED"), treat the concessions as validated risks that must be addressed.

Your job is NOT to average opinions. Your job is to RESOLVE THE DEBATE.

1. **Vote Tally**: X BUY, Y HOLD, Z SELL — weighted average conviction
2. **Verdict**: BUY, HOLD, or SELL
3. **Debate winner**: Which side had the stronger argument, and why
4. **Strongest counterpoint**: Address the losing side's best argument directly — explain why it's outweighed, or acknowledge it as a real risk
5. **Reversal condition**: State the SPECIFIC, TESTABLE condition under which your verdict would reverse (the bear's "what would change my mind" or the bull's "key risk")
6. **Key levels**: Entry, stop-loss, and target prices
7. **Position sizing**: Based on risk manager's analysis

Be direct and actionable. This is your final word on ${symbol}.

End with this exact format:
VERDICT: [BUY|HOLD|SELL]
CONFIDENCE: [1-10]
DEBATE WINNER: [BULL|BEAR]
REVERSAL CONDITION: [specific, testable condition]`;
}

const VALIDATION_PROMPT = (symbol: string) =>
  `**[Validation Check]** Review the complete analysis of ${symbol} above, including the debate. For each specific number cited by any analyst, bull, or bear researcher, verify it matches tool output data received in the session. Flag any inconsistencies. If a number was stated without being fetched first, call it out as UNVERIFIED.

Additionally check:
1. Did the bull/bear cite real numbers from analyst outputs (not hallucinated)?
2. If a rebuttal occurred (not a line starting with "REBUTTAL SKIPPED"), are the concessions genuine (did the bull actually give ground on the bear's specific points)?
3. Is the reversal condition specific and testable (not vague like "if macro deteriorates")?

Output: VALIDATED if all checks pass, or list specific corrections needed.`;

export function getInitialAnalysisPrompt(symbol: string): string {
  return `Begin comprehensive analysis of ${symbol}. Start by getting the current stock quote.`;
}

export function getComprehensiveAnalysisPrompts(symbol: string): string[] {
  const roles: AnalystRole[] = ["valuation", "momentum", "options", "contrarian", "risk"];
  const prompts = [getInitialAnalysisPrompt(symbol)];

  for (const role of roles) {
    prompts.push(ANALYST_PROMPTS[role](symbol));
  }

  prompts.push(buildBullPrompt(symbol));
  prompts.push(buildBearPrompt(symbol));
  prompts.push(buildRebuttalPrompt(symbol));
  prompts.push(buildSynthesisPrompt(symbol));
  prompts.push(VALIDATION_PROMPT(symbol));

  return prompts;
}

import type { WorkflowDefinition } from "../runtime/prompt-step.js";
import { promptStep } from "../runtime/prompt-step.js";

export function buildComprehensiveAnalysisDefinition(symbol: string): WorkflowDefinition {
  const roles: AnalystRole[] = ["valuation", "momentum", "options", "contrarian", "risk"];

  const analystOutputs = roles.map((r) => `${r}_signal`);

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
    promptStep("debate_bull", "Bull researcher case", buildBullPrompt(symbol), {
      requiredInputs: analystOutputs,
      expectedOutputs: ["bull_thesis"],
    }),
    promptStep("debate_bear", "Bear researcher case", buildBearPrompt(symbol), {
      requiredInputs: [...analystOutputs, "bull_thesis"],
      expectedOutputs: ["bear_thesis"],
    }),
    promptStep("debate_rebuttal", "Bull rebuttal (self-gating)", buildRebuttalPrompt(symbol), {
      requiredInputs: [...analystOutputs, "bull_thesis", "bear_thesis"],
      expectedOutputs: ["rebuttal"],
    }),
    promptStep("synthesis", "Resolve the debate", buildSynthesisPrompt(symbol), {
      requiredInputs: [...analystOutputs, "bull_thesis", "bear_thesis", "rebuttal"],
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
