import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { hasCredential } from "../../onboarding/providers.js";
import { buildSoftDegradedTag } from "../../onboarding/tool-tags.js";
import { searchWeb } from "../../providers/web-search.js";
import type { WebSearchEnvelope } from "../../types/sentiment.js";
import {
  renderUntrustedText,
  renderUntrustedUrl,
  untrustedContentHeader,
} from "./untrusted-text.js";

export const webSearchParameters = Type.Object({
  query: Type.String({ description: "Search query — ticker, topic, or question" }),
  category: Type.Optional(
    Type.Union([Type.Literal("news"), Type.Literal("general")], {
      description:
        'Search category. "news" for recent articles, "general" for broader web. Default: "news"',
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
  provider: Type.Optional(
    Type.Union([Type.Literal("exa"), Type.Literal("brave"), Type.Literal("ddg")], {
      description: "Override search provider (skip cascade). Default: auto (Exa → Brave → DDG)",
    }),
  ),
});

/**
 * Build soft-degradation tags for search providers whose credentials are
 * missing at call time. Returns an empty string when nothing is degraded, or
 * a newline-terminated block of `[OPENCANDLE_SOFT_DEGRADED ...]` tags ready to
 * prepend to the tool result content. The extension's `tool_result` handler
 * records these into the per-turn degradation accumulator; the system prompt
 * instructs the LLM to surface them in a `**Data gaps**` section.
 *
 * Emission rules:
 *   - Brave: if `hasCredential("brave") === false` AND the envelope's
 *     provider is not `"brave"`, the cascade fell back from Brave.
 *   - Exa:   if `hasCredential("exa") === false` AND the envelope's provider
 *     is `"exa"`, the Exa provider used the keyless MCP path instead of the
 *     keyed API. Envelopes served by `ddg` are NOT tagged for Exa (Exa was
 *     tried first and failed for a reason unrelated to credentials).
 */
function buildSoftDegradedPrefix(data: WebSearchEnvelope): string {
  const tags: string[] = [];

  if (!hasCredential("brave") && data.provider !== "brave") {
    tags.push(
      buildSoftDegradedTag({
        provider: "brave",
        fallback: data.provider === "exa" ? "exa" : "ddg",
        remediation: "run /connect search to enable Brave",
      }),
    );
  }

  if (!hasCredential("exa") && data.provider === "exa") {
    tags.push(
      buildSoftDegradedTag({
        provider: "exa",
        fallback: "keyless-mcp",
        remediation: "run /connect search to enable keyed Exa",
      }),
    );
  }

  return tags.length === 0 ? "" : `${tags.join("\n")}\n\n`;
}

function buildOfficialSourceGapPrefix(query: string, data: WebSearchEnvelope): string {
  if (!hasOfficialFedSourceGap(query, data)) return "";

  return [
    '[OPENCANDLE_SOURCE_GAP source=fed_official evidence=missing remediation="verify against federalreserve.gov/FOMC before stating Fed announcements"]',
    "Hard source gap: no official Fed/FOMC source was returned. Do not present meeting announcements, votes, quotes, appointments, leadership changes, or named policy rationales as verified; treat results as market commentary only.",
    "",
  ].join("\n");
}

function hasOfficialFedSourceGap(query: string, data: WebSearchEnvelope): boolean {
  return (
    isFedAnnouncementQuery(query) &&
    !data.results.some(
      (result) => isOfficialFedSource(result.source) || isOfficialFedSource(result.url),
    )
  );
}

function isFedAnnouncementQuery(query: string): boolean {
  const lower = query.toLowerCase();
  const mentionsFed = /\b(?:fed|fomc|federal reserve)\b/.test(lower);
  const asksOfficialFact =
    /\b(?:announcement|meeting|minutes|statement|decision|vote|chair|governor|appointment|leadership)\b/.test(
      lower,
    );
  return mentionsFed && asksOfficialFact;
}

function isOfficialFedSource(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.includes("federalreserve.gov") || lower.includes("fomc.gov");
}

export function createWebSearchTool(
  allowedProviders?: readonly ("exa" | "brave" | "ddg")[],
): AgentTool<typeof webSearchParameters, WebSearchEnvelope | null> & {
  __hostedAllowedProviders?: readonly string[];
} {
  return {
    name: "search_web",
    label: "Web Search",
    description:
      "Search the web for financial news, earnings context, company events, regulatory developments, or general information. " +
      "NOT for real-time prices, historical data, fundamentals, macro data, SEC filings, or social sentiment — those have dedicated tools.",
    parameters: webSearchParameters,
    ...(allowedProviders ? { __hostedAllowedProviders: [...allowedProviders] } : {}),

    async execute(_toolCallId, args) {
      const query = args.query?.trim();
      if (!query) {
        return {
          content: [{ type: "text", text: "⚠ Cannot search with an empty query." }],
          details: null,
        };
      }

      const category = args.category ?? "news";
      const freshness = args.freshness ?? "day";
      const limit = Math.max(1, Math.min(args.limit ?? 10, 20));

      const provider = args.provider;
      const result = await searchWeb(query, {
        category,
        freshness,
        limit,
        provider,
        allowedProviders,
      });

      if (result.status === "unavailable") {
        return {
          content: [{ type: "text", text: `⚠ Web search unavailable (${result.reason}).` }],
          details: null,
        };
      }

      const data = result.data;

      if (data.resultCount === 0) {
        const zeroPrefix = buildSoftDegradedPrefix(data);
        const sourceGapPrefix = buildOfficialSourceGapPrefix(query, data);
        return {
          content: [
            {
              type: "text",
              text: `${zeroPrefix}${sourceGapPrefix}No results found for "${query}" (${category}, past ${freshness}).`,
            },
          ],
          details: data,
        };
      }

      const stalePrefix = result.stale ? `⚠ Using cached data from ${result.timestamp}\n\n` : "";

      const softDegradedPrefix = buildSoftDegradedPrefix(data);
      const sourceGapPrefix = buildOfficialSourceGapPrefix(query, data);
      const shouldOmitResults = hasOfficialFedSourceGap(query, data);

      const header = `**Web Search** — ${data.resultCount} results for "${query}" (${category}, past ${freshness}, via ${data.provider})`;
      const items = data.results.map((r) => {
        const title = renderUntrustedText(r.title);
        const snippet = renderUntrustedText(r.snippet);
        const source = renderUntrustedText(r.source, 120);
        const url = renderUntrustedUrl(r.url);
        const published = r.published ? renderUntrustedText(r.published, 80) : "unknown";
        const heading = url ? `[${title}](${url})` : title;
        return `• ${heading} — ${source}\n  ${snippet}\n  Published: ${published}`;
      });
      const body = shouldOmitResults
        ? "Non-official results were omitted from assistant-visible evidence for this Fed/FOMC announcement query. Verify against an official Federal Reserve or FOMC source before naming announcements or personnel changes."
        : `${untrustedContentHeader("web search results")}\n\n${items.join("\n\n")}`;

      const text = `${softDegradedPrefix}${sourceGapPrefix}${stalePrefix}${header}\n\n${body}`;

      return {
        content: [{ type: "text", text }],
        details: data,
      };
    },
  };
}

export const webSearchTool = createWebSearchTool();
