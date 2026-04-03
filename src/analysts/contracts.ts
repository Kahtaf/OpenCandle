import type { AnalystOutput, AnalystSignal } from "../runtime/workflow-types.js";
import type { EvidenceRecord } from "../runtime/evidence.js";

/** All analyst roles. */
export type AnalystRole =
  | "valuation"
  | "momentum"
  | "options"
  | "contrarian"
  | "risk";

/** Evidence fields expected per analyst role. */
export const ROLE_EXPECTED_EVIDENCE: Record<AnalystRole, string[]> = {
  valuation: ["P/E Ratio", "Forward P/E", "EPS", "Intrinsic Value", "Revenue Growth"],
  momentum: ["RSI", "MACD", "SMA 50", "SMA 200", "Volume Trend"],
  options: ["Put/Call Ratio", "IV Level", "Unusual Volume", "Max Pain"],
  contrarian: ["Fear & Greed Index", "Reddit Sentiment", "Sentiment Score"],
  risk: ["Annualized Volatility", "Sharpe Ratio", "Max Drawdown", "VaR 95%", "Position Size"],
};

/**
 * Parse an LLM response into a structured AnalystOutput.
 * Falls back to raw text if parsing fails.
 */
export function parseAnalystOutput(
  role: string,
  responseText: string,
): AnalystOutput {
  const signal = extractSignal(responseText);
  const conviction = extractConviction(responseText);
  const thesis = extractThesis(responseText);

  return {
    role,
    signal: signal ?? "HOLD",
    conviction: conviction ?? 5,
    thesis: thesis ?? "",
    evidence: [],
    rawText: responseText,
  };
}

function extractSignal(text: string): AnalystSignal | null {
  const match = text.match(/SIGNAL:\s*(BUY|HOLD|SELL)/i);
  if (match) return match[1].toUpperCase() as AnalystSignal;
  return null;
}

function extractConviction(text: string): number | null {
  const match = text.match(/CONVICTION:\s*(\d+)/i);
  if (match) {
    const value = parseInt(match[1], 10);
    if (value >= 1 && value <= 10) return value;
  }
  return null;
}

function extractThesis(text: string): string | null {
  const match = text.match(/THESIS:\s*(.+)/i);
  return match ? match[1].trim() : null;
}

/** Build a structured vote tally from analyst outputs. */
export function tallyVotes(outputs: AnalystOutput[]): {
  buy: number;
  hold: number;
  sell: number;
  weightedConviction: number;
  verdict: AnalystSignal;
} {
  let buy = 0;
  let hold = 0;
  let sell = 0;
  let totalWeight = 0;
  let weightedSum = 0;

  for (const output of outputs) {
    switch (output.signal) {
      case "BUY":
        buy++;
        break;
      case "HOLD":
        hold++;
        break;
      case "SELL":
        sell++;
        break;
    }
    totalWeight += output.conviction;
    const signalValue = output.signal === "BUY" ? 1 : output.signal === "SELL" ? -1 : 0;
    weightedSum += signalValue * output.conviction;
  }

  const weightedConviction = totalWeight > 0
    ? Math.round((totalWeight / outputs.length) * 10) / 10
    : 0;

  let verdict: AnalystSignal;
  if (weightedSum > 0) verdict = "BUY";
  else if (weightedSum < 0) verdict = "SELL";
  else verdict = "HOLD";

  return { buy, hold, sell, weightedConviction, verdict };
}

/** Collect all evidence from analyst outputs. */
export function collectEvidence(outputs: AnalystOutput[]): EvidenceRecord[] {
  const evidence: EvidenceRecord[] = [];
  for (const output of outputs) {
    evidence.push(...output.evidence);
  }
  return evidence;
}
