import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getQuote } from "../../providers/yahoo-finance.js";
import { getGlobalQuote } from "../../providers/alpha-vantage.js";
import { withFallback } from "../../providers/with-fallback.js";
import { getConfig } from "../../config.js";
import type { StockQuote } from "../../types/market.js";

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL, MSFT, TSLA)" }),
});

export const stockQuoteTool: AgentTool<typeof params, StockQuote> = {
  name: "get_stock_quote",
  label: "Stock Quote",
  description:
    "Get real-time stock price, volume, market cap, and 52-week range for a ticker symbol",
  parameters: params,
  async execute(toolCallId, args) {
    const symbol = args.symbol.toUpperCase();
    const apiKey = getConfig().alphaVantageApiKey;

    const entries = [
      { provider: "yahoo" as const, fn: () => getQuote(symbol) },
      ...(apiKey
        ? [{ provider: "alphavantage" as const, fn: () => getGlobalQuote(symbol, apiKey) }]
        : []),
    ];

    const result = await withFallback(entries);
    if (result.status === "unavailable") {
      return {
        content: [{ type: "text", text: `⚠ Stock quote unavailable for ${symbol} (${result.reason}).` }],
        details: null as any,
      };
    }
    const quote = result.data;
    const sign = quote.changePercent >= 0 ? "+" : "";

    const week52 = quote.week52High > 0 && quote.week52Low > 0
      ? `$${quote.week52Low.toFixed(2)} - $${quote.week52High.toFixed(2)}`
      : "N/A";
    const marketCapStr = quote.marketCap > 0 ? `$${formatLargeNumber(quote.marketCap)}` : "N/A";

    const text = [
      `${quote.symbol}: $${quote.price.toFixed(2)} (${sign}${quote.changePercent.toFixed(2)}%)`,
      `Open: $${quote.open.toFixed(2)} | High: $${quote.high.toFixed(2)} | Low: $${quote.low.toFixed(2)}`,
      `Volume: ${quote.volume.toLocaleString()} | Market Cap: ${marketCapStr}`,
      `52W Range: ${week52}`,
    ].join("\n");

    const prefix = result.stale
      ? `⚠ Using cached quote from ${result.timestamp} (provider rate limited)\n`
      : "";
    return { content: [{ type: "text", text: prefix + text }], details: quote };
  },
};

function formatLargeNumber(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString();
}
