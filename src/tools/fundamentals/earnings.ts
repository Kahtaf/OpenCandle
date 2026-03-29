import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getEarnings } from "../../providers/alpha-vantage.js";
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
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) {
      return {
        content: [{ type: "text", text: "Error: ALPHA_VANTAGE_API_KEY not configured." }],
        details: { symbol: args.symbol, quarterly: [] },
      };
    }

    const earnings = await getEarnings(args.symbol.toUpperCase(), apiKey);
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
