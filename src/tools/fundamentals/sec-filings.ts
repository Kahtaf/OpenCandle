import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { searchFilings } from "../../providers/sec-edgar.js";
import { wrapProvider } from "../../providers/wrap-provider.js";

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL, MSFT, TSLA)" }),
  form_types: Type.Optional(
    Type.Array(Type.String(), {
      description: "Filing types to search: 10-K (annual), 10-Q (quarterly), 8-K (material events). Default: all three.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of filings to return (default: 10)" }),
  ),
});

export const secFilingsTool: AgentTool<typeof params> = {
  name: "get_sec_filings",
  label: "SEC Filings",
  description:
    "Search SEC EDGAR for company filings (10-K annual reports, 10-Q quarterly reports, 8-K material events). Returns filing dates, types, and direct links to the documents. Free API, no key required.",
  parameters: params,
  async execute(toolCallId, args) {
    const symbol = args.symbol.toUpperCase();
    const formTypes = args.form_types ?? ["10-K", "10-Q", "8-K"];
    const limit = args.limit ?? 10;

    const result = await wrapProvider("sec-edgar", () => searchFilings(symbol, formTypes, limit));
    if (result.status === "unavailable") {
      return {
        content: [{ type: "text", text: `⚠ SEC filings unavailable for ${symbol} (${result.reason}).` }],
        details: null,
      };
    }
    const filings = result.data;

    if (filings.length === 0) {
      return {
        content: [{ type: "text", text: `No SEC filings found for ${symbol}. Verify the ticker is a US-listed company.` }],
        details: null,
      };
    }

    const lines = [
      `**${symbol} SEC Filings** (${filings.length} found)`,
      ``,
      ...filings.map((f) =>
        `  ${f.formType.padEnd(6)} | Filed: ${f.filedDate} | Period: ${f.periodOfReport || "N/A"} | ${f.entityName}`
      ),
      ``,
      `Links:`,
      ...filings.map((f) => `  ${f.formType} (${f.filedDate}): ${f.url}`),
    ];

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: { symbol, filings },
    };
  },
};
