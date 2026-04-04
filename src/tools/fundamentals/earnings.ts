import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getEarnings } from "../../providers/alpha-vantage.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { getConfig } from "../../config.js";
import type { EarningsData } from "../../types/fundamentals.js";

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL, MSFT)" }),
});

export const earningsTool: AgentTool<typeof params, EarningsData> = {
  name: "get_earnings",
  label: "Earnings History",
  description:
    "Get quarterly earnings: reported EPS, estimated EPS, and surprise percentage for the last 8 quarters. Requires ALPHA_VANTAGE_API_KEY.",
  parameters: params,
  async execute(toolCallId, args) {
    const apiKey = getConfig().alphaVantageApiKey;
    if (!apiKey) {
      throw new Error("Alpha Vantage API key not configured. Set ALPHA_VANTAGE_API_KEY or add ~/.opencandle/config.json.");
    }

    const result = await wrapProvider("alphavantage", () => getEarnings(args.symbol.toUpperCase(), apiKey));
    if (result.status === "unavailable") {
      return {
        content: [{ type: "text", text: `⚠ Earnings data unavailable for ${args.symbol.toUpperCase()} (${result.reason}). Analysis will proceed without earnings history.` }],
        details: null as any,
      };
    }
    const earnings = result.data;
    if (earnings.quarterly.length === 0) {
      return {
        content: [{ type: "text", text: `No earnings data found for ${args.symbol}` }],
        details: earnings,
      };
    }

    const header = `${args.symbol.toUpperCase()} — Quarterly Earnings (last ${earnings.quarterly.length} quarters)`;
    const rows = earnings.quarterly.map((q) => {
      const sign = q.surprisePercent >= 0 ? "+" : "";
      return `${q.date} | Reported: $${q.reportedEPS.toFixed(2)} | Est: $${q.estimatedEPS.toFixed(2)} | Surprise: ${sign}${q.surprisePercent.toFixed(1)}%`;
    });

    const text = [header, ...rows].join("\n");
    return { content: [{ type: "text", text }], details: earnings };
  },
};
