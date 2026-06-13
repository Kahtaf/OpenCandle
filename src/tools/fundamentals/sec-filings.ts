import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { searchFilings } from "../../providers/sec-edgar.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { renderUntrustedText, untrustedContentHeader } from "../sentiment/untrusted-text.js";

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL, MSFT, TSLA)" }),
  form_types: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Filing types to search: 10-K (annual), 10-Q (quarterly), 8-K (material events). Default: all three.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of filings to return (default: 10)" }),
  ),
  include_snippets: Type.Optional(
    Type.Boolean({
      description:
        "Include short filing-text evidence snippets for risk/MD&A/litigation themes. Default: true.",
    }),
  ),
});

export const secFilingsTool: AgentTool<typeof params> = {
  name: "get_sec_filings",
  label: "SEC Filings",
  description:
    "Search SEC EDGAR for company filings (10-K annual reports, 10-Q quarterly reports, 8-K material events). Returns filing dates, types, and direct links to the documents. Free API, no key required.",
  parameters: params,
  async execute(_toolCallId, args) {
    const symbol = args.symbol.toUpperCase();
    const formTypes = args.form_types ?? ["10-K", "10-Q", "8-K"];
    const limit = args.limit ?? 10;
    const includeSnippets = args.include_snippets ?? true;

    const result = await wrapProvider("sec-edgar", () =>
      searchFilings(symbol, formTypes, limit, { includeSnippets, snippetLimitPerFiling: 2 }),
    );
    if (result.status === "unavailable") {
      return {
        content: [
          { type: "text", text: `⚠ SEC filings unavailable for ${symbol} (${result.reason}).` },
        ],
        details: null,
      };
    }
    const filings = result.data;

    if (filings.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No SEC filings found for ${symbol}. Verify the ticker is a US-listed company.`,
          },
        ],
        details: null,
      };
    }

    const lines = [
      `**${symbol} SEC Filings** (${filings.length} found)`,
      ``,
      ...filings.map(
        (f) =>
          `  ${f.formType.padEnd(6)} | Filed: ${f.filedDate} | Period: ${f.periodOfReport || "N/A"} | ${f.entityName}`,
      ),
      ``,
      `Links:`,
      ...filings.map((f) => `  ${f.formType} (${f.filedDate}): ${f.url}`),
      ``,
      `Primary documents:`,
      ...filings.flatMap((f) => [
        `  ${f.formType} (${f.filedDate}): ${f.primaryDocumentUrl ?? "N/A"}`,
        ...(f.items?.length ? [`    8-K items: ${f.items.join(", ")}`] : []),
      ]),
      ...(includeSnippets
        ? [
            ``,
            `Evidence snippets (short excerpts; review source filing for full context):`,
            untrustedContentHeader("SEC filing snippets"),
            ...filings.flatMap((f) =>
              f.evidenceWarning
                ? [`  ${f.formType} ${f.filedDate}: ${f.evidenceWarning}`]
                : f.evidenceSnippets?.length
                  ? f.evidenceSnippets.map(
                      (snippet) =>
                        `  ${f.formType} ${f.filedDate}: ${renderUntrustedText(snippet, 500)}`,
                    )
                  : [
                      `  ${f.formType} ${f.filedDate}: No keyword snippet found in fetched primary document.`,
                    ],
            ),
          ]
        : []),
    ];

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: { symbol, filings },
    };
  },
};
