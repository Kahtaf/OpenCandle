import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getQuote } from "../../providers/yahoo-finance.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { initDefaultDatabase } from "../../memory/sqlite.js";
import { MarketStateService, type PredictionRecord } from "../../market-state/service.js";
import { isZeroFilledQuote, resolveYahooInstrument } from "../../market-state/resolve.js";
import { resolveInstrumentForMutation } from "../../market-state/resolve-for-mutation.js";

export interface Prediction {
  id?: number;
  instrumentId?: number;
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
    currentPrice: number | null;
    pnlPercent: number | null;
    correct: boolean;
    status: "open" | "resolved";
    dataGap?: string;
  }>;
}

export async function recordPrediction(params: {
  symbol: string;
  direction: "bullish" | "bearish" | "neutral";
  conviction: number;
  entryPrice: number;
  targetPrice?: number;
  timeframeDays: number;
}): Promise<Prediction> {
  const db = initDefaultDatabase();
  const service = new MarketStateService(db);
  try {
    const instrument = await resolveYahooInstrument(params.symbol);
    const record = service.recordPrediction({
      instrument,
      direction: params.direction,
      conviction: params.conviction,
      entryPrice: params.entryPrice,
      targetPrice: params.targetPrice,
      timeframeDays: params.timeframeDays,
    });
    return predictionRecordToPrediction(record, params.timeframeDays);
  } finally {
    db.close();
  }
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
    if (currentPrice == null) {
      openCount++;
      details.push({
        symbol: p.symbol,
        direction: p.direction,
        conviction: p.conviction,
        entryPrice: p.entryPrice,
        currentPrice: null,
        pnlPercent: null,
        correct: false,
        status: "open",
        dataGap: "quote unavailable",
      });
      continue;
    }

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
    [Type.Literal("record"), Type.Literal("check"), Type.Literal("cancel")],
    {
      description:
        "record: save a new prediction. check: evaluate all predictions against current prices. cancel: close an open prediction without scoring it.",
    },
  ),
  id: Type.Optional(Type.Number({ description: "Prediction id (required for cancel)" })),
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
  async execute(_toolCallId, args) {
    if (args.action === "cancel") {
      if (args.id == null) {
        throw new Error("id is required for cancel action.");
      }
      const db = initDefaultDatabase();
      try {
        const service = new MarketStateService(db);
        const existing = service.listPredictions().find((record) => record.id === args.id);
        if (existing == null) {
          return {
            content: [{ type: "text", text: `Prediction #${args.id} not found.` }],
            details: null,
          };
        }
        if (existing.status !== "open") {
          return {
            content: [{ type: "text", text: `Prediction #${args.id} is already ${existing.status}.` }],
            details: existing,
          };
        }
        const now = new Date().toISOString();
        const cancelled = service.updatePredictionOutcome({
          id: args.id,
          status: "cancelled",
          resolvedAt: now,
          result: { reason: "user_cancelled" },
        });
        return {
          content: [{ type: "text", text: `Cancelled prediction #${args.id} for ${cancelled.symbol}.` }],
          details: cancelled,
        };
      } finally {
        db.close();
      }
    }

    if (args.action === "record") {
      if (!args.symbol || !args.direction || !args.conviction || !args.entry_price) {
        throw new Error("symbol, direction, conviction, and entry_price are required for record action.");
      }

      const resolution = await resolveInstrumentForMutation(args.symbol);
      if (resolution.status === "needs_selection") {
        return {
          content: [{
            type: "text",
            text: `Could not verify ${resolution.query}. Choose one of the returned candidates before recording the prediction.`,
          }],
          details: resolution,
        };
      }

      const db = initDefaultDatabase();
      let prediction: Prediction;
      try {
        const service = new MarketStateService(db);
        const record = service.recordPrediction({
          instrument: resolution.instrument,
          direction: args.direction,
          conviction: args.conviction,
          entryPrice: args.entry_price,
          targetPrice: args.target_price,
          timeframeDays: args.timeframe_days ?? 30,
        });
        prediction = predictionRecordToPrediction(record, args.timeframe_days ?? 30);
      } finally {
        db.close();
      }

      return {
        content: [{ type: "text", text: `Recorded: ${prediction.symbol} ${prediction.direction} (conviction ${prediction.conviction}/10) at $${prediction.entryPrice}. Expires ${prediction.expiresAt}.` }],
        details: prediction,
      };
    }

    const db = initDefaultDatabase();
    try {
      const service = new MarketStateService(db);
      const records = service.listPredictions();
      const openRecords = records.filter((record) => record.status === "open");
      const predictions = openRecords.map((record) => predictionRecordToPrediction(record));
      if (records.length === 0) {
        return {
          content: [{ type: "text", text: "No predictions recorded yet. Use record action to track your calls." }],
          details: null,
        };
      }
      if (openRecords.length === 0) {
        return {
          content: [{ type: "text", text: "No open predictions to check." }],
          details: checkPredictions([], new Map()),
        };
      }

      const symbols = [...new Set(predictions.map((p) => p.symbol))];
      const priceMap = new Map<string, number>();
      await Promise.all(
        symbols.map(async (sym) => {
          const result = await wrapProvider("yahoo", () => getQuote(sym));
          if (result.status === "ok" && !result.stale && !isZeroFilledQuote(result.data)) {
            priceMap.set(sym, result.data.price);
          }
        }),
      );

      const result = checkPredictions(predictions, priceMap);
      persistPredictionOutcomes(service, openRecords, result);

      const resolved = result.correct + result.wrong;
      const lines = [
        `**Prediction Scorecard** — ${result.total} predictions (${resolved} resolved, ${result.open} open)`,
        ``,
        `Hit Rate: ${(result.hitRate * 100).toFixed(0)}% (${result.correct}/${resolved})`,
        `Weighted Hit Rate: ${(result.weightedHitRate * 100).toFixed(0)}% (by conviction)`,
        ``,
        ...result.details.map((d) => {
          const icon = d.status === "open" ? "~" : d.correct ? "+" : "-";
          if (d.currentPrice == null || d.pnlPercent == null) {
            return `${icon} ${d.symbol} ${d.direction}: quote unavailable (open)`;
          }
          const sign = d.pnlPercent >= 0 ? "+" : "";
          const label = d.status === "open" ? " (open)" : "";
          return `  [${icon}] ${d.symbol}: ${d.direction} (conv ${d.conviction}) → $${d.entryPrice.toFixed(2)} → $${d.currentPrice.toFixed(2)} (${sign}${(d.pnlPercent * 100).toFixed(1)}%)${label}`;
        }),
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: result,
      };
    } finally {
      db.close();
    }
  },
};

function persistPredictionOutcomes(
  service: MarketStateService,
  records: PredictionRecord[],
  result: PredictionCheckResult,
): void {
  const now = new Date().toISOString();
  const usedRecordIds = new Set<number>();

  for (const detail of result.details) {
    if (detail.status !== "resolved") continue;
    const record = findMatchingOpenRecord(records, detail, usedRecordIds);
    if (record == null) continue;
    usedRecordIds.add(record.id);
    service.updatePredictionOutcome({
      id: record.id,
      status: "resolved",
      resolvedAt: now,
      result: {
        currentPrice: detail.currentPrice,
        pnlPercent: detail.pnlPercent,
        correct: detail.correct,
      },
    });
  }

  for (const record of records) {
    if (usedRecordIds.has(record.id)) continue;
    if (record.expiresAt > now) continue;
    if (result.details.some((detail) => detail.status === "open" && matchesPredictionRecord(record, detail))) {
      continue;
    }
    service.updatePredictionOutcome({
      id: record.id,
      status: "expired",
      resolvedAt: now,
      result: { reason: "quote_unavailable" },
    });
  }
}

function findMatchingOpenRecord(
  records: PredictionRecord[],
  detail: PredictionCheckResult["details"][number],
  usedRecordIds: Set<number>,
): PredictionRecord | null {
  return records.find((record) => !usedRecordIds.has(record.id) && matchesPredictionRecord(record, detail)) ?? null;
}

function matchesPredictionRecord(
  record: PredictionRecord,
  detail: Pick<PredictionCheckResult["details"][number], "symbol" | "direction" | "conviction" | "entryPrice">,
): boolean {
  return (
    record.symbol === detail.symbol &&
    record.direction === detail.direction &&
    record.conviction === detail.conviction &&
    record.entryPrice === detail.entryPrice
  );
}

function predictionRecordToPrediction(
  record: PredictionRecord,
  explicitTimeframeDays?: number,
): Prediction {
  const openedAt = new Date(record.openedAt);
  const expiresAt = new Date(record.expiresAt);
  const timeframeDays =
    explicitTimeframeDays ?? Math.round((expiresAt.getTime() - openedAt.getTime()) / 86_400_000);

  return {
    id: record.id,
    instrumentId: record.instrumentId,
    symbol: record.symbol,
    direction: record.direction,
    conviction: record.conviction,
    entryPrice: record.entryPrice,
    targetPrice: record.targetPrice ?? undefined,
    date: record.openedAt.split("T")[0],
    expiresAt: record.expiresAt.split("T")[0],
    timeframeDays,
  };
}
