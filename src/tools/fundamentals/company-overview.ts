import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getOverview } from "../../providers/alpha-vantage.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { getConfig } from "../../config.js";
import type { CompanyOverview } from "../../types/fundamentals.js";

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL, MSFT)" }),
});

export const companyOverviewTool: AgentTool<typeof params, CompanyOverview> = {
  name: "get_company_overview",
  label: "Company Overview",
  description:
    "Get company fundamentals: P/E ratio, EPS, market cap, sector, dividend yield, profit margin, beta, and description. Requires ALPHA_VANTAGE_API_KEY.",
  parameters: params,
  async execute(toolCallId, args) {
    const apiKey = getConfig().alphaVantageApiKey;
    if (!apiKey) {
      throw new Error("Alpha Vantage API key not configured. Set ALPHA_VANTAGE_API_KEY or add ~/.opencandle/config.json.");
    }

    const result = await wrapProvider("alphavantage", () => getOverview(args.symbol.toUpperCase(), apiKey));
    if (result.status === "unavailable") {
      return {
        content: [{ type: "text", text: `⚠ Company overview unavailable for ${args.symbol.toUpperCase()} (${result.reason}). Analysis will proceed without fundamentals.` }],
        details: null as any,
      };
    }
    const ov = result.data;
    const text = [
      `**${ov.name}** (${ov.symbol}) — ${ov.exchange}`,
      `Sector: ${ov.sector} | Industry: ${ov.industry}`,
      `Market Cap: $${formatLargeNumber(ov.marketCap)} | P/E: ${ov.pe ?? "N/A"} | Fwd P/E: ${ov.forwardPe ?? "N/A"}`,
      `EPS: $${ov.eps ?? "N/A"} | Div Yield: ${ov.dividendYield ? (ov.dividendYield * 100).toFixed(2) + "%" : "N/A"}`,
      `Beta: ${ov.beta ?? "N/A"} | Profit Margin: ${ov.profitMargin ? (ov.profitMargin * 100).toFixed(1) + "%" : "N/A"}`,
      `52W: $${ov.week52Low.toFixed(2)} - $${ov.week52High.toFixed(2)}`,
      ``,
      ov.description.slice(0, 300) + (ov.description.length > 300 ? "..." : ""),
    ].join("\n");

    const prefix = result.stale
      ? `⚠ Using cached fundamentals from ${result.timestamp} (Alpha Vantage rate limited)\n`
      : "";
    return { content: [{ type: "text", text: prefix + text }], details: ov };
  },
};

function formatLargeNumber(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString();
}
