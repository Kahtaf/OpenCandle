import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { searchWeb } from "../../providers/web-search.js";
import type { WebSearchEnvelope } from "../../types/sentiment.js";

const params = Type.Object({
  query: Type.String({ description: "Search query — ticker, topic, or question" }),
  category: Type.Optional(
    Type.Union([Type.Literal("news"), Type.Literal("general")], {
      description: 'Search category. "news" for recent articles, "general" for broader web. Default: "news"',
    }),
  ),
  freshness: Type.Optional(
    Type.Union(
      [Type.Literal("hours"), Type.Literal("day"), Type.Literal("week"), Type.Literal("month")],
      { description: 'Time range filter. Default: "day"' },
    ),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Number of results (1-20). Default: 10", minimum: 1, maximum: 20 }),
  ),
});

function escapeMd(text: string): string {
  return text.replace(/([[\]|])/g, "\\$1");
}

function safeUrl(url: string): string {
  if (url.startsWith("https://") || url.startsWith("http://")) return url;
  return `https://${url}`;
}

export const webSearchTool: AgentTool<typeof params, WebSearchEnvelope> = {
  name: "search_web",
  label: "Web Search",
  description:
    "Search the web for financial news, earnings context, company events, regulatory developments, or general information. " +
    "NOT for real-time prices, historical data, fundamentals, macro data, SEC filings, or social sentiment — those have dedicated tools.",
  parameters: params,

  async execute(toolCallId, args) {
    const query = args.query?.trim();
    if (!query) {
      return {
        content: [{ type: "text", text: "⚠ Cannot search with an empty query." }],
        details: null as any,
      };
    }

    const category = args.category ?? "news";
    const freshness = args.freshness ?? "day";
    const limit = Math.max(1, Math.min(args.limit ?? 10, 20));

    const result = await searchWeb(query, { category, freshness, limit });

    if (result.status === "unavailable") {
      return {
        content: [{ type: "text", text: `⚠ Web search unavailable (${result.reason}).` }],
        details: null as any,
      };
    }

    const data = result.data;

    if (data.resultCount === 0) {
      return {
        content: [{ type: "text", text: `No results found for "${query}" (${category}, past ${freshness}).` }],
        details: data,
      };
    }

    const stalePrefix = result.stale
      ? `⚠ Using cached data from ${result.timestamp}\n\n`
      : "";

    const header = `**Web Search** — ${data.resultCount} results for "${query}" (${category}, past ${freshness}, via ${data.provider})`;
    const items = data.results.map((r) => {
      const title = escapeMd(r.title);
      const snippet = escapeMd(r.snippet);
      const url = safeUrl(r.url);
      const pub = r.published ? `Published: ${r.published}` : "Published: unknown";
      return `• [${title}](${url}) — ${r.source}\n  ${snippet}\n  ${pub}`;
    });

    const text = `${stalePrefix}${header}\n\n${items.join("\n\n")}`;

    return {
      content: [{ type: "text", text }],
      details: data,
    };
  },
};
