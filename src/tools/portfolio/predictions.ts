import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getQuote } from "../../providers/yahoo-finance.js";
import { ensureParentDir, getPredictionsPath } from "../../infra/vantage-paths.js";

export interface Prediction {
  symbol: string;
  direction: "bullish" | "bearish" | "neutral";
  conviction: number; // 1-10
  entryPrice: number;
  targetPrice?: number;
  date: string;
  expiresAt: string;
  timeframeDays: number;
}

export interface PredictionCheckResult {
  total: number;
  open: number;
  correct: number;
  wrong: number;
  hitRate: number;
  weightedHitRate: number;
  details: Array<{
    symbol: string;
    direction: string;
    conviction: number;
    entryPrice: number;
    currentPrice: number;
    pnlPercent: number;
    correct: boolean;
    status: "open" | "resolved";
  }>;
}

function loadPredictions(): Prediction[] {
  const predictionsPath = getPredictionsPath();
  if (!existsSync(predictionsPath)) return [];
  try {
    return JSON.parse(readFileSync(predictionsPath, "utf-8"));
  } catch {
    return [];
  }
}

function savePredictions(predictions: Prediction[]): void {
  const predictionsPath = getPredictionsPath();
  ensureParentDir(predictionsPath);
  writeFileSync(predictionsPath, JSON.stringify(predictions, null, 2));
}

export function recordPrediction(params: {
  symbol: string;
  direction: "bullish" | "bearish" | "neutral";
  conviction: number;
  entryPrice: number;
  targetPrice?: number;
  timeframeDays: number;
}): Prediction {
  const predictions = loadPredictions();
  const now = new Date();
  const expires = new Date(now);
  expires.setDate(expires.getDate() + params.timeframeDays);

  const prediction: Prediction = {
    symbol: params.symbol.toUpperCase(),
    direction: params.direction,
    conviction: params.conviction,
    entryPrice: params.entryPrice,
    targetPrice: params.targetPrice,
    date: now.toISOString().split("T")[0],
    expiresAt: expires.toISOString().split("T")[0],
    timeframeDays: params.timeframeDays,
  };

  predictions.push(prediction);
  savePredictions(predictions);
  return prediction;
}

export function checkPredictions(
  predictions: Prediction[],
  currentPrices: Map<string, number>,
  now: Date = new Date(),
): PredictionCheckResult {
  if (predictions.length === 0) {
    return { total: 0, open: 0, correct: 0, wrong: 0, hitRate: 0, weightedHitRate: 0, details: [] };
  }

  const details: PredictionCheckResult["details"] = [];
  let totalConviction = 0;
  let correctConviction = 0;
  let openCount = 0;

  const nowStr = now.toISOString().split("T")[0];

  for (const p of predictions) {
    const currentPrice = currentPrices.get(p.symbol);
    if (currentPrice == null) continue;

    const isExpired = p.expiresAt <= nowStr;
    const pnlPercent = (currentPrice - p.entryPrice) / p.entryPrice;

    if (!isExpired) {
      openCount++;
      details.push({
        symbol: p.symbol,
        direction: p.direction,
        conviction: p.conviction,
        entryPrice: p.entryPrice,
        currentPrice,
        pnlPercent,
        correct: false,
        status: "open",
      });
      continue;
    }

    const correct =
      (p.direction === "bullish" && currentPrice > p.entryPrice) ||
      (p.direction === "bearish" && currentPrice < p.entryPrice) ||
      (p.direction === "neutral" && Math.abs(pnlPercent) < 0.02);

    details.push({
      symbol: p.symbol,
      direction: p.direction,
      conviction: p.conviction,
      entryPrice: p.entryPrice,
      currentPrice,
      pnlPercent,
      correct,
      status: "resolved",
    });

    totalConviction += p.conviction;
    if (correct) correctConviction += p.conviction;
  }

  const resolved = details.filter((d) => d.status === "resolved");
  const correctCount = resolved.filter((d) => d.correct).length;

  return {
    total: details.length,
    open: openCount,
    correct: correctCount,
    wrong: resolved.length - correctCount,
    hitRate: resolved.length > 0 ? correctCount / resolved.length : 0,
    weightedHitRate: totalConviction > 0 ? correctConviction / totalConviction : 0,
    details,
  };
}

const params = Type.Object({
  action: Type.Union(
    [Type.Literal("record"), Type.Literal("check")],
    { description: "record: save a new prediction. check: evaluate all predictions against current prices." },
  ),
  symbol: Type.Optional(Type.String({ description: "Ticker symbol (required for record)" })),
  direction: Type.Optional(
    Type.Union(
      [Type.Literal("bullish"), Type.Literal("bearish"), Type.Literal("neutral")],
      { description: "Predicted direction (required for record)" },
    ),
  ),
  conviction: Type.Optional(
    Type.Number({ description: "Conviction 1-10 (required for record)" }),
  ),
  entry_price: Type.Optional(
    Type.Number({ description: "Entry price at time of prediction (required for record)" }),
  ),
  target_price: Type.Optional(
    Type.Number({ description: "Optional target price" }),
  ),
  timeframe_days: Type.Optional(
    Type.Number({ description: "Timeframe in days for the prediction (default: 30)" }),
  ),
});

export const predictionsTool: AgentTool<typeof params> = {
  name: "track_prediction",
  label: "Prediction Tracker",
  description:
    "Track your analysis predictions and measure accuracy over time. Record: save a directional prediction with conviction. Check: evaluate all predictions against current prices, compute hit rate and conviction-weighted accuracy. Inspired by ATLAS's Darwinian scoring approach.",
  parameters: params,
  async execute(toolCallId, args) {
    if (args.action === "record") {
      if (!args.symbol || !args.direction || !args.conviction || !args.entry_price) {
        throw new Error("symbol, direction, conviction, and entry_price are required for record action.");
      }

      const prediction = recordPrediction({
        symbol: args.symbol,
        direction: args.direction,
        conviction: args.conviction,
        entryPrice: args.entry_price,
        targetPrice: args.target_price,
        timeframeDays: args.timeframe_days ?? 30,
      });

      return {
        content: [{ type: "text", text: `Recorded: ${prediction.symbol} ${prediction.direction} (conviction ${prediction.conviction}/10) at $${prediction.entryPrice}. Expires ${prediction.expiresAt}.` }],
        details: prediction,
      };
    }

    // Check action
    const predictions = loadPredictions();
    if (predictions.length === 0) {
      return {
        content: [{ type: "text", text: "No predictions recorded yet. Use record action to track your calls." }],
        details: null,
      };
    }

    // Fetch current prices for all symbols
    const symbols = [...new Set(predictions.map((p) => p.symbol))];
    const priceMap = new Map<string, number>();
    await Promise.all(
      symbols.map(async (sym) => {
        try {
          const quote = await getQuote(sym);
          priceMap.set(sym, quote.price);
        } catch {
          // Skip symbols that fail
        }
      }),
    );

    const result = checkPredictions(predictions, priceMap);

    const resolved = result.correct + result.wrong;
    const lines = [
      `**Prediction Scorecard** — ${result.total} predictions (${resolved} resolved, ${result.open} open)`,
      ``,
      `Hit Rate: ${(result.hitRate * 100).toFixed(0)}% (${result.correct}/${resolved})`,
      `Weighted Hit Rate: ${(result.weightedHitRate * 100).toFixed(0)}% (by conviction)`,
      ``,
      ...result.details.map((d) => {
        const icon = d.status === "open" ? "~" : d.correct ? "+" : "-";
        const sign = d.pnlPercent >= 0 ? "+" : "";
        const label = d.status === "open" ? " (open)" : "";
        return `  [${icon}] ${d.symbol}: ${d.direction} (conv ${d.conviction}) → $${d.entryPrice.toFixed(2)} → $${d.currentPrice.toFixed(2)} (${sign}${(d.pnlPercent * 100).toFixed(1)}%)${label}`;
      }),
    ];

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: result,
    };
  },
};
