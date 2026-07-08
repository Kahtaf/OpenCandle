import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { getConfig } from "../../config.js";
import { withCredentialCheck } from "../../onboarding/tool-helpers.js";
import { getEarnings } from "../../providers/alpha-vantage.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import type { EarningsData } from "../../types/fundamentals.js";

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL, MSFT)" }),
});

export const earningsTool: AgentTool<
  typeof params,
  EarningsData | { credentialRequired: unknown } | null
> = {
  name: "get_earnings",
  label: "Earnings History",
  description:
    "Get quarterly earnings: reported EPS, estimated EPS, and surprise percentage for the last 8 quarters. Requires Alpha Vantage.",
  parameters: params,
  async execute(_toolCallId, args) {
    return withCredentialCheck("alpha_vantage", async () => {
      const apiKey = getConfig().alphaVantageApiKey;
      if (!apiKey) throw new Error("Alpha Vantage credential is missing.");
      const result = await wrapProvider("alphavantage", () =>
        getEarnings(args.symbol.toUpperCase(), apiKey),
      );
      if (result.status === "unavailable") {
        return {
          content: [
            {
              type: "text",
              text: `⚠ Earnings data unavailable for ${args.symbol.toUpperCase()} (${result.reason}). Analysis will proceed without earnings history.`,
            },
          ],
          details: null,
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
    });
  },
};
