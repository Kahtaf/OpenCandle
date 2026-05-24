import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getFinancials } from "../../providers/alpha-vantage.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { getConfig } from "../../config.js";
import { withCredentialCheck } from "../../onboarding/tool-helpers.js";
import type { FinancialStatement } from "../../types/fundamentals.js";

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL, MSFT)" }),
});

export const financialsTool: AgentTool<typeof params, FinancialStatement[] | { credentialRequired: unknown }> = {
  name: "get_financials",
  label: "Financial Statements",
  description:
    "Get annual income statement data: revenue, gross profit, operating income, net income, and EPS. Requires Alpha Vantage.",
  parameters: params,
  async execute(_toolCallId, args) {
    return withCredentialCheck("alpha_vantage", async () => {
      const apiKey = getConfig().alphaVantageApiKey!;
      const result = await wrapProvider("alphavantage", () =>
        getFinancials(args.symbol.toUpperCase(), apiKey),
      );
      if (result.status === "unavailable") {
        return {
          content: [{ type: "text", text: `⚠ Financial statements unavailable for ${args.symbol.toUpperCase()} (${result.reason}). Analysis will proceed without financials.` }],
          details: [],
        };
      }
      const statements = result.data;
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
    });
  },
};

function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString();
}
