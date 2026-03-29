import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getHistory } from "../../providers/yahoo-finance.js";
import type { OHLCV } from "../../types/market.js";

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL, MSFT)" }),
  range: Type.Optional(
    Type.String({
      description: "Time range: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, max. Default: 6mo",
    }),
  ),
  interval: Type.Optional(
    Type.String({
      description: "Data interval: 1m, 5m, 15m, 1h, 1d, 1wk, 1mo. Default: 1d",
    }),
  ),
});

export const stockHistoryTool: AgentTool<typeof params, OHLCV[]> = {
  name: "get_stock_history",
  label: "Stock History",
  description: "Get historical OHLCV (open, high, low, close, volume) data for a stock",
  parameters: params,
  async execute(toolCallId, args) {
    const symbol = args.symbol.toUpperCase();
    const range = args.range ?? "6mo";
    const interval = args.interval ?? "1d";
    const bars = await getHistory(symbol, range, interval);

    const summary = [
      `${symbol} — ${bars.length} bars (${range}, ${interval})`,
      `Period: ${bars[0]?.date} to ${bars[bars.length - 1]?.date}`,
    ];

    // Include last 10 bars as sample
    const recent = bars.slice(-10);
    const table = recent
      .map(
        (b) =>
          `${b.date} | O:${b.open.toFixed(2)} H:${b.high.toFixed(2)} L:${b.low.toFixed(2)} C:${b.close.toFixed(2)} V:${b.volume.toLocaleString()}`,
      )
      .join("\n");

    const text = [...summary, "", "Recent bars:", table].join("\n");
    return { content: [{ type: "text", text }], details: bars };
  },
};
