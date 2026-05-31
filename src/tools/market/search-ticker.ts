import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { searchYahooInstruments } from "../../market-state/resolve.js";

const params = Type.Object({
  query: Type.String({
    description: "Search query — company name, ticker symbol, or crypto name (e.g. 'apple', 'AAPL', 'ethereum', 'bitcoin')",
  }),
});

export const searchTickerTool: AgentTool<typeof params> = {
  name: "search_ticker",
  label: "Search Ticker",
  description:
    "Search for any ticker symbol — stocks, crypto, ETFs, indices, forex. Returns matching symbols with names and exchange info. Use this when you don't know the exact ticker for an asset.",
  parameters: params,
  async execute(_toolCallId, args) {
    const quotes = await searchYahooInstruments(args.query);
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
          `  ${q.symbol} — ${q.name || "N/A"} (${q.quoteType}, ${q.exchange || "N/A"})`,
      ),
    ];

    return { content: [{ type: "text", text: lines.join("\n") }], details: quotes };
  },
};
