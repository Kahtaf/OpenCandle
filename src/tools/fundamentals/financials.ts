import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { getConfig } from "../../config.js";
import { isOverSoftThreshold } from "../../infra/lse-byte-budget.js";
import { withCredentialCheck } from "../../onboarding/tool-helpers.js";
import { getFinancials } from "../../providers/alpha-vantage.js";
import { getLseFinancials } from "../../providers/lse.js";
import { ProviderCredentialError } from "../../providers/provider-credential-error.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import type { ProviderResult } from "../../runtime/evidence.js";
import type { FinancialStatement } from "../../types/fundamentals.js";

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL, MSFT)" }),
});

export const financialsTool: AgentTool<
  typeof params,
  FinancialStatement[] | { credentialRequired: unknown }
> = {
  name: "get_financials",
  label: "Financial Statements",
  description:
    "Get annual income statement data: revenue, gross profit, operating income, net income, and EPS. Uses London Strategic Edge or Alpha Vantage.",
  parameters: params,
  async execute(_toolCallId, args) {
    const symbol = args.symbol.toUpperCase();
    const config = getConfig();
    const renderResult = (
      result: ProviderResult<FinancialStatement[]>,
      source?: "London Strategic Edge" | "Alpha Vantage",
    ) => {
      if (result.status === "unavailable") {
        return {
          content: [
            {
              type: "text" as const,
              text: `⚠ Financial statements unavailable for ${symbol} (${result.reason}). Analysis will proceed without financials.`,
            },
          ],
          details: [],
        };
      }
      const statements = result.data;
      if (statements.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No financial data found for ${args.symbol}` }],
          details: [],
        };
      }

      const header = `${symbol} — Annual Income Statement (${statements.length} years)`;
      const rows = statements.map(
        (s) =>
          `${s.fiscalDate} | Rev: $${fmt(s.revenue)} | GP: $${fmt(s.grossProfit)} | OpInc: $${fmt(s.operatingIncome)} | Net: $${fmt(s.netIncome)}`,
      );
      const sourceLine = source ? [`Source: ${source}`] : [];
      const staleLine = result.stale
        ? [`Data status: stale cache from ${result.timestamp} (provider unavailable)`]
        : [];
      return {
        content: [
          {
            type: "text" as const,
            text: [header, ...sourceLine, ...staleLine, ...rows].join("\n"),
          },
        ],
        details: statements,
      };
    };
    const runAlphaVantageOnly = () =>
      withCredentialCheck("alpha_vantage", async () => {
        const apiKey = getConfig().alphaVantageApiKey;
        if (!apiKey) throw new Error("Alpha Vantage credential is missing.");
        const result = await wrapProvider("alphavantage", () => getFinancials(symbol, apiKey));
        return renderResult(result);
      });

    const lseEligible = !!config.lseApiKey && !isOverSoftThreshold();
    if (!lseEligible) return runAlphaVantageOnly();

    const lseEntry = {
      provider: "lse",
      fn: async () => {
        try {
          const statements = await getLseFinancials(symbol);
          if (statements.length === 0) throw new Error("no financial statements returned");
          return statements;
        } catch (error) {
          if (error instanceof ProviderCredentialError) {
            throw new Error(`London Strategic Edge credential ${error.reason}`);
          }
          throw error;
        }
      },
    };

    if (!config.alphaVantageApiKey) {
      const result = await wrapProvider(lseEntry.provider, lseEntry.fn);
      if (result.status === "ok") return renderResult(result, "London Strategic Edge");
      return runAlphaVantageOnly();
    }

    return withCredentialCheck("alpha_vantage", async () => {
      const apiKey = config.alphaVantageApiKey;
      if (!apiKey) throw new Error("Alpha Vantage credential is missing.");
      const lseResult = await wrapProvider(lseEntry.provider, lseEntry.fn);
      if (lseResult.status === "ok" && !lseResult.stale) {
        return renderResult(lseResult, "London Strategic Edge");
      }
      let alphaVantageResult: ProviderResult<FinancialStatement[]>;
      try {
        alphaVantageResult = await wrapProvider("alphavantage", () =>
          getFinancials(symbol, apiKey),
        );
      } catch (error) {
        if (error instanceof ProviderCredentialError && lseResult.status === "ok") {
          return renderResult(lseResult, "London Strategic Edge");
        }
        throw error;
      }
      if (alphaVantageResult.status === "ok" && !alphaVantageResult.stale) {
        return renderResult(alphaVantageResult, "Alpha Vantage");
      }
      if (lseResult.status === "ok") {
        return renderResult(lseResult, "London Strategic Edge");
      }
      if (alphaVantageResult.status === "ok") {
        return renderResult(alphaVantageResult, "Alpha Vantage");
      }
      return renderResult({
        status: "unavailable",
        provider: "fallback",
        reason: `lse: ${lseResult.reason}; alphavantage: ${alphaVantageResult.reason}`,
      });
    });
  },
};

function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString();
}
