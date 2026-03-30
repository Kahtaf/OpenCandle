import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getFinancials } from "../../providers/alpha-vantage.js";
import { getConfig } from "../../config.js";
import type { FinancialStatement } from "../../types/fundamentals.js";

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL, MSFT)" }),
});

export const financialsTool: AgentTool<typeof params, FinancialStatement[]> = {
  name: "get_financials",
  label: "Financial Statements",
  description:
    "Get annual income statement data: revenue, gross profit, operating income, net income, and EPS. Requires ALPHA_VANTAGE_API_KEY.",
  parameters: params,
  async execute(toolCallId, args) {
    const apiKey = getConfig().alphaVantageApiKey;
    if (!apiKey) {
      throw new Error("Alpha Vantage API key not configured. Set ALPHA_VANTAGE_API_KEY or add ~/.vantage/config.json.");
    }

    const statements = await getFinancials(args.symbol.toUpperCase(), apiKey);
    if (statements.length === 0) {
      return {
        content: [{ type: "text", text: `No financial data found for ${args.symbol}` }],
        details: [],
      };
    }

    const header = `${args.symbol.toUpperCase()} — Annual Income Statement (${statements.length} years)`;
    const rows = statements.map((s) =>
      `${s.fiscalDate} | Rev: $${fmt(s.revenue)} | GP: $${fmt(s.grossProfit)} | OpInc: $${fmt(s.operatingIncome)} | Net: $${fmt(s.netIncome)}`,
    );

    const text = [header, ...rows].join("\n");
    return { content: [{ type: "text", text }], details: statements };
  },
};

function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString();
}
