import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { getCryptoHistory } from "../../providers/coingecko.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import type { OHLCV } from "../../types/market.js";
import { computeRiskMetrics } from "../portfolio/risk-analysis.js";

const params = Type.Object({
  id: Type.String({
    description: "CoinGecko coin ID (e.g. bitcoin, ethereum, solana)",
  }),
  days: Type.Optional(
    Type.Number({
      description: "Number of days of history: 1, 7, 14, 30, 90, 180, 365, max. Default: 180",
    }),
  ),
});

export const cryptoHistoryTool: AgentTool<typeof params, OHLCV[]> = {
  name: "get_crypto_history",
  label: "Crypto History",
  description: "Get historical OHLC data for a cryptocurrency",
  parameters: params,
  async execute(_toolCallId, args) {
    const id = args.id.toLowerCase();
    const days = args.days ?? 180;
    const result = await wrapProvider("coingecko", () => getCryptoHistory(id, days));
    if (result.status === "unavailable") {
      return {
        content: [
          { type: "text", text: `⚠ Crypto history unavailable for ${id} (${result.reason}).` },
        ],
        details: [],
      };
    }
    const bars = result.data;

    const summary = [
      `${id} — ${bars.length} bars (${days} days)`,
      `Period: ${bars[0]?.date} to ${bars[bars.length - 1]?.date}`,
    ];

    const recent = bars.slice(-10);
    const table = recent
      .map(
        (b) =>
          `${b.date} | O:${b.open.toFixed(2)} H:${b.high.toFixed(2)} L:${b.low.toFixed(2)} C:${b.close.toFixed(2)}`,
      )
      .join("\n");

    const riskLines = buildRiskLines(id, bars);
    const text = [...summary, ...riskLines, "", "Recent bars:", table].join("\n");
    return { content: [{ type: "text", text }], details: bars };
  },
};

function buildRiskLines(id: string, bars: OHLCV[]): string[] {
  if (bars.length < 30) return [];
  const metrics = computeRiskMetrics(
    id.toUpperCase(),
    bars.map((bar) => bar.close),
  );
  return [
    "",
    "Risk metrics from crypto history:",
    `Annualized Return: ${(metrics.annualizedReturn * 100).toFixed(2)}%`,
    `Annualized Volatility: ${(metrics.annualizedVolatility * 100).toFixed(2)}%`,
    `Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}`,
    `Max Drawdown: ${(metrics.maxDrawdown * 100).toFixed(2)}%`,
    `Value at Risk (95%, daily): ${(metrics.var95 * 100).toFixed(2)}%`,
  ];
}
