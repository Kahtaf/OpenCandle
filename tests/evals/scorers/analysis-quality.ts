import type { EvalTrace, LayerDetail } from "../types.js";

/**
 * Rubric items for analysis quality scoring.
 * Each is scored as binary pass/fail by an LLM judge.
 */
export const ANALYSIS_RUBRIC = [
  {
    id: "data_collection",
    name: "Data Collection Completeness",
    criterion: "The response references data from multiple tool categories (e.g., price data + fundamentals + technicals, not just one source).",
    examples: {
      pass: "Based on AAPL's current price of $185, P/E ratio of 29.3, and RSI of 62, the stock appears...",
      fail: "AAPL is trading at $185. I recommend buying.",
    },
  },
  {
    id: "quantitative_screen",
    name: "Quantitative Screen Present",
    criterion: "The response includes explicit quantitative screening criteria with PASS/FAIL or clear threshold-based assessments.",
    examples: {
      pass: "Valuation Check: P/E of 29.3 vs sector median 25.1 — ABOVE AVERAGE. Debt/Equity of 1.8 — PASS (below 2.0 threshold).",
      fail: "The valuation looks reasonable based on growth prospects.",
    },
  },
  {
    id: "risk_check",
    name: "Risk Check Present",
    criterion: "The response explicitly mentions risk metrics such as volatility, max drawdown, VaR, beta, or specific downside scenarios.",
    examples: {
      pass: "Key risk: 30-day volatility is 28%, above the 20% threshold. Max drawdown in the past year was -15%.",
      fail: "There are some risks to consider with this investment.",
    },
  },
  {
    id: "reasoning_chain",
    name: "Reasoning Chain Explicit",
    criterion: "The response follows a 'Because [data] + [data], I conclude [thesis]' pattern, explicitly connecting data points to conclusions.",
    examples: {
      pass: "Because revenue grew 8% YoY while the P/E ratio (29.3) remains below the 5-year average (32.1), and RSI (62) suggests the stock isn't overbought, I conclude AAPL presents a moderate buy opportunity.",
      fail: "AAPL is a good buy. The fundamentals are strong and the technicals look positive.",
    },
  },
  {
    id: "actionable_conclusion",
    name: "Actionable Conclusion",
    criterion: "The response provides a clear directional view (buy/hold/sell or equivalent) with a conviction level (high/medium/low).",
    examples: {
      pass: "Conclusion: MODERATE BUY with MEDIUM conviction. Consider a position size of 3-5% of portfolio.",
      fail: "Overall, AAPL has both positives and negatives. Do your own research.",
    },
  },
];

/**
 * Debate-specific rubric items — measure the quality improvement from
 * adversarial bull/bear debate. Used to compare debate-on vs debate-off.
 */
export const DEBATE_RUBRIC = [
  {
    id: "tension_resolution",
    name: "Tension Resolution",
    criterion: "The synthesis explicitly acknowledges competing viewpoints and explains why one outweighs the other, rather than averaging or ignoring disagreement.",
    examples: {
      pass: "The bull argued 25% DCF upside, but the bear correctly identified revenue deceleration. The bull case wins because FCF margins expanded from 24% to 28%, offsetting slower growth.",
      fail: "Overall the stock looks good based on fundamentals and technicals.",
    },
  },
  {
    id: "falsifiable_conclusion",
    name: "Falsifiable Conclusion",
    criterion: "The conclusion states a specific, testable condition (metric + threshold + timeframe) that would reverse the verdict.",
    examples: {
      pass: "Reversal: If Q2 earnings show FCF margin contraction below 25%, the thesis breaks.",
      fail: "Risks remain if the macro environment deteriorates significantly.",
    },
  },
  {
    id: "intellectual_honesty",
    name: "Intellectual Honesty",
    criterion: "The analysis concedes genuine weaknesses in its own position — naming specific data points that support the opposing view — rather than dismissing all counterarguments.",
    examples: {
      pass: "The bear correctly identified revenue deceleration (Q3: +12%, Q4: +9%, Q1: +6%) — this is a real risk, but offset by margin expansion.",
      fail: "All bearish concerns are minor and should not affect the investment thesis.",
    },
  },
];

/**
 * Score debate quality using the debate-specific rubric items.
 */
export async function scoreDebateQuality(
  trace: EvalTrace,
  judgeFn: (prompt: string) => Promise<string>,
  runs: number = 3,
): Promise<LayerDetail> {
  const itemScores: number[] = [];

  for (const item of DEBATE_RUBRIC) {
    const prompt = buildJudgePrompt(item, trace.text);
    let passCount = 0;

    for (let i = 0; i < runs; i++) {
      const response = await judgeFn(prompt);
      if (response.trim().toUpperCase().startsWith("PASS")) {
        passCount++;
      }
    }

    itemScores.push(passCount > runs / 2 ? 1 : 0);
  }

  const score = itemScores.reduce((a, b) => a + b, 0) / itemScores.length;
  const passedItems = DEBATE_RUBRIC.filter((_, i) => itemScores[i] === 1).map((r) => r.id);
  const failedItems = DEBATE_RUBRIC.filter((_, i) => itemScores[i] === 0).map((r) => r.id);

  return {
    passed: score >= 0.6,
    score,
    message: `Passed: ${passedItems.join(", ")}${failedItems.length > 0 ? ` | Failed: ${failedItems.join(", ")}` : ""}`,
  };
}

/**
 * Build the LLM judge prompt for a single rubric item.
 */
export function buildJudgePrompt(rubricItem: typeof ANALYSIS_RUBRIC[number], responseText: string): string {
  return `You are evaluating the quality of a financial analysis response.

## Rubric Item: ${rubricItem.name}

**Criterion**: ${rubricItem.criterion}

**Example of PASS**:
${rubricItem.examples.pass}

**Example of FAIL**:
${rubricItem.examples.fail}

## Response to Evaluate

${responseText}

## Instructions

Does this response satisfy the criterion above? Answer with exactly one word: PASS or FAIL.`;
}

/**
 * Score analysis quality using LLM-as-judge.
 * Each rubric item is scored as binary pass/fail.
 * Final score is the fraction of items passed (0–1).
 *
 * @param judgeFn - Function that sends a prompt to an LLM and returns the response text.
 *                  Must use temperature 0.1 for consistency.
 * @param runs - Number of independent runs to average (default 3).
 */
export async function scoreAnalysisQuality(
  trace: EvalTrace,
  judgeFn: (prompt: string) => Promise<string>,
  runs: number = 3,
): Promise<LayerDetail> {
  const itemScores: number[] = [];

  for (const item of ANALYSIS_RUBRIC) {
    const prompt = buildJudgePrompt(item, trace.text);
    let passCount = 0;

    for (let i = 0; i < runs; i++) {
      const response = await judgeFn(prompt);
      if (response.trim().toUpperCase().startsWith("PASS")) {
        passCount++;
      }
    }

    // Majority vote across runs
    itemScores.push(passCount > runs / 2 ? 1 : 0);
  }

  const score = itemScores.reduce((a, b) => a + b, 0) / itemScores.length;
  const passedItems = ANALYSIS_RUBRIC.filter((_, i) => itemScores[i] === 1).map((r) => r.id);
  const failedItems = ANALYSIS_RUBRIC.filter((_, i) => itemScores[i] === 0).map((r) => r.id);

  return {
    passed: score >= 0.6,
    score,
    message: `Passed: ${passedItems.join(", ")}${failedItems.length > 0 ? ` | Failed: ${failedItems.join(", ")}` : ""}`,
  };
}
