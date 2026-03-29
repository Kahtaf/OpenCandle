import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { httpGet } from "../../infra/http-client.js";

const params = Type.Object({
  query: Type.String({
    description: "Search query — company name, ticker symbol, or crypto name (e.g. 'apple', 'AAPL', 'ethereum', 'bitcoin')",
  }),
});

interface YahooSearchResponse {
  quotes: Array<{
    symbol: string;
    shortname?: string;
    longname?: string;
    quoteType: string;
    exchange: string;
    score: number;
  }>;
}

export const searchTickerTool: AgentTool<typeof params> = {
  name: "search_ticker",
  label: "Search Ticker",
  description:
    "Search for any ticker symbol — stocks, crypto, ETFs, indices, forex. Returns matching symbols with names and exchange info. Use this when you don't know the exact ticker for an asset.",
  parameters: params,
  async execute(toolCallId, args) {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(args.query)}&quotesCount=10&newsCount=0`;
    const data = await httpGet<YahooSearchResponse>(url, {
      headers: { "User-Agent": "Vantage/1.0" },
    });

    const quotes = data.quotes ?? [];
    if (quotes.length === 0) {
      return {
        content: [{ type: "text", text: `No results found for "${args.query}"` }],
        details: quotes,
      };
    }

    const lines = [
      `**Search results for "${args.query}"** — ${quotes.length} matches`,
      "",
      ...quotes.map(
        (q) =>
          `  ${q.symbol} — ${q.longname || q.shortname || "N/A"} (${q.quoteType}, ${q.exchange})`,
      ),
    ];

    return { content: [{ type: "text", text: lines.join("\n") }], details: quotes };
  },
};
