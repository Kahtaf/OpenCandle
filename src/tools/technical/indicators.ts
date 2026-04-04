import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getHistory } from "../../providers/yahoo-finance.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import type { OHLCV } from "../../types/market.js";

// --- Volume-based indicators ---

export function computeOBV(bars: OHLCV[]): number[] {
  const obv: number[] = [0];
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].close > bars[i - 1].close) {
      obv.push(obv[i - 1] + bars[i].volume);
    } else if (bars[i].close < bars[i - 1].close) {
      obv.push(obv[i - 1] - bars[i].volume);
    } else {
      obv.push(obv[i - 1]);
    }
  }
  return obv;
}

export function computeVWAP(bars: OHLCV[]): number[] {
  const vwap: number[] = [];
  let cumPV = 0;
  let cumVol = 0;
  for (const bar of bars) {
    const tp = (bar.high + bar.low + bar.close) / 3;
    cumPV += tp * bar.volume;
    cumVol += bar.volume;
    vwap.push(cumVol === 0 ? 0 : cumPV / cumVol);
  }
  return vwap;
}

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL, MSFT)" }),
  range: Type.Optional(
    Type.String({ description: "Time range for data: 3mo, 6mo, 1y, 2y. Default: 1y" }),
  ),
});

export const technicalIndicatorsTool: AgentTool<typeof params> = {
  name: "get_technical_indicators",
  label: "Technical Indicators",
  description:
    "Compute technical indicators (SMA, EMA, RSI, MACD, Bollinger Bands) from historical price data. All computed locally — no API dependency.",
  parameters: params,
  async execute(toolCallId, args) {
    const symbol = args.symbol.toUpperCase();
    const range = args.range ?? "1y";
    const result = await wrapProvider("yahoo", () => getHistory(symbol, range, "1d"));
    if (result.status === "unavailable") {
      return {
        content: [{ type: "text", text: `⚠ Technical indicators unavailable for ${symbol} (${result.reason}).` }],
        details: null as any,
      };
    }
    const bars = result.data;
    const closes = bars.map((b) => b.close);

    if (closes.length < 26) {
      return {
        content: [{ type: "text", text: `Insufficient data for ${symbol} (need 26+ bars, got ${closes.length})` }],
        details: null,
      };
    }

    const sma20 = computeSMA(closes, 20);
    const sma50 = computeSMA(closes, 50);
    const ema12 = computeEMA(closes, 12);
    const ema26 = computeEMA(closes, 26);
    const rsi = computeRSI(closes, 14);
    const macd = computeMACD(closes);
    const bb = computeBollingerBands(closes, 20, 2);
    const obv = computeOBV(bars);
    const vwap = computeVWAP(bars);

    const latest = closes[closes.length - 1];
    const latestRsi = rsi[rsi.length - 1];
    const latestMacd = macd[macd.length - 1];
    const latestBB = bb[bb.length - 1];
    const latestVwap = vwap[vwap.length - 1];
    const obvTrend = obv.length >= 20
      ? (obv[obv.length - 1] > obv[obv.length - 20] ? "Rising" : "Falling")
      : "N/A";

    const lines = [
      `**${symbol} Technical Analysis** (${bars[0].date} to ${bars[bars.length - 1].date})`,
      `Price: $${latest.toFixed(2)}`,
      ``,
      `SMA(20): $${sma20[sma20.length - 1]?.toFixed(2) ?? "N/A"} | SMA(50): $${sma50[sma50.length - 1]?.toFixed(2) ?? "N/A"}`,
      `RSI(14): ${latestRsi?.toFixed(1) ?? "N/A"} ${rsiSignal(latestRsi)}`,
      `MACD: ${latestMacd?.macd.toFixed(2) ?? "N/A"} | Signal: ${latestMacd?.signal.toFixed(2) ?? "N/A"} | Histogram: ${latestMacd?.histogram.toFixed(2) ?? "N/A"}`,
      `Bollinger Bands: Upper $${latestBB?.upper.toFixed(2) ?? "N/A"} | Mid $${latestBB?.middle.toFixed(2) ?? "N/A"} | Lower $${latestBB?.lower.toFixed(2) ?? "N/A"}`,
      `OBV Trend: ${obvTrend} | VWAP (cumulative): $${latestVwap?.toFixed(2) ?? "N/A"}`,
      ``,
      trendSummary(latest, sma20, sma50, latestRsi, latestMacd, obvTrend, latestVwap),
    ];

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: { sma20, sma50, rsi, macd, bb, obv, vwap },
    };
  },
};

// --- Indicator computations (all pure functions) ---

export function computeSMA(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(sum / period);
  }
  return result;
}

export function computeEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  // Seed with SMA of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  let ema = sum / period;
  result.push(ema);
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

export function computeRSI(data: number[], period: number = 14): number[] {
  const result: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  if (gains.length < period) return result;

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(100 - 100 / (1 + rs));

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }

  return result;
}

export function computeMACD(
  data: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { macd: number; signal: number; histogram: number }[] {
  if (data.length < slowPeriod + signalPeriod) return [];

  const emaFast = computeEMA(data, fastPeriod);
  const emaSlow = computeEMA(data, slowPeriod);

  // Align: emaFast starts at index fastPeriod-1, emaSlow at slowPeriod-1
  const offset = slowPeriod - fastPeriod;
  const macdLine: number[] = [];
  for (let i = 0; i < emaSlow.length; i++) {
    macdLine.push(emaFast[i + offset] - emaSlow[i]);
  }

  if (macdLine.length < signalPeriod) return [];

  const signalLine = computeEMA(macdLine, signalPeriod);
  const signalOffset = signalPeriod - 1;

  const result: { macd: number; signal: number; histogram: number }[] = [];
  for (let i = 0; i < signalLine.length; i++) {
    const m = macdLine[i + signalOffset];
    const s = signalLine[i];
    result.push({ macd: m, signal: s, histogram: m - s });
  }

  return result;
}

export function computeBollingerBands(
  data: number[],
  period: number = 20,
  stdDev: number = 2,
): { upper: number; middle: number; lower: number }[] {
  const result: { upper: number; middle: number; lower: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    result.push({
      upper: mean + stdDev * sd,
      middle: mean,
      lower: mean - stdDev * sd,
    });
  }
  return result;
}

function rsiSignal(rsi: number | undefined): string {
  if (rsi == null) return "";
  if (rsi >= 70) return "(Overbought)";
  if (rsi <= 30) return "(Oversold)";
  return "(Neutral)";
}

function trendSummary(
  price: number,
  sma20: number[],
  sma50: number[],
  rsi: number | undefined,
  macd: { macd: number; signal: number; histogram: number } | undefined,
  obvTrend?: string,
  vwap?: number,
): string {
  const signals: string[] = [];

  const latestSma20 = sma20[sma20.length - 1];
  const latestSma50 = sma50[sma50.length - 1];

  if (latestSma20 && price > latestSma20) signals.push("Price above SMA(20) — short-term bullish");
  if (latestSma20 && price < latestSma20) signals.push("Price below SMA(20) — short-term bearish");
  if (latestSma20 && latestSma50 && latestSma20 > latestSma50) signals.push("Golden cross pattern (SMA20 > SMA50)");
  if (latestSma20 && latestSma50 && latestSma20 < latestSma50) signals.push("Death cross pattern (SMA20 < SMA50)");
  if (rsi != null && rsi >= 70) signals.push("RSI overbought — potential reversal");
  if (rsi != null && rsi <= 30) signals.push("RSI oversold — potential bounce");
  if (macd && macd.histogram > 0) signals.push("MACD bullish (histogram positive)");
  if (macd && macd.histogram < 0) signals.push("MACD bearish (histogram negative)");
  if (obvTrend === "Rising" && price > (latestSma20 ?? 0)) signals.push("Volume confirming price advance (OBV rising)");
  if (obvTrend === "Falling" && price < (latestSma20 ?? Infinity)) signals.push("Volume confirming price decline (OBV falling)");
  if (vwap != null && price > vwap) signals.push("Price above cumulative VWAP — bullish volume-weighted bias");
  if (vwap != null && price < vwap) signals.push("Price below cumulative VWAP — bearish volume-weighted bias");

  return signals.length > 0 ? "Signals: " + signals.join(" | ") : "No strong signals";
}
