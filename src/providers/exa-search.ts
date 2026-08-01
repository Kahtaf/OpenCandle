import { getConfig } from "../config.js";
import { cache, STALE_LIMIT, TTL } from "../infra/cache.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import type { WebSearchEnvelope, WebSearchResult } from "../types/sentiment.js";
import { ProviderCredentialError } from "./provider-credential-error.js";
import type { WebSearchOpts } from "./web-search.js";

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
const EXA_API_URL = "https://api.exa.ai/search";
const TIMEOUT_MS = 5_000;
const SNIPPET_MAX_CHARS = 300;
const CONTEXT_MAX_CHARS = 1_000;

let requestIdCounter = 0;

// ---------------------------------------------------------------------------
// Freshness helpers
// ---------------------------------------------------------------------------

function freshnessToMs(freshness: WebSearchOpts["freshness"]): number {
  switch (freshness) {
    case "hours":
      return 60 * 60 * 1000;
    case "day":
      return 24 * 60 * 60 * 1000;
    case "week":
      return 7 * 24 * 60 * 60 * 1000;
    case "month":
      return 30 * 24 * 60 * 60 * 1000;
  }
}

function enrichQueryForMcp(query: string, freshness: WebSearchOpts["freshness"]): string {
  switch (freshness) {
    case "hours":
      return `${query} past hour`;
    case "day":
      return `${query} past 24 hours`;
    case "week":
      return `${query} past week`;
    case "month":
      return `${query} past month`;
  }
}

function startPublishedDate(freshness: WebSearchOpts["freshness"]): string {
  return new Date(Date.now() - freshnessToMs(freshness)).toISOString();
}

// ---------------------------------------------------------------------------
// MCP response parsing
// ---------------------------------------------------------------------------

interface McpRpcResponse {
  result?: {
    content?: Array<{ type?: string; text?: string; _meta?: Record<string, unknown> }>;
  };
  error?: {
    code?: number;
    message?: string;
  };
}

function extractJsonRpcPayload(body: string, contentType: string): McpRpcResponse {
  // Path 1: plain JSON response
  if (contentType.includes("application/json")) {
    return JSON.parse(body) as McpRpcResponse;
  }

  // Path 2: SSE — scan all data: lines for valid JSON-RPC
  const dataLines = body.split("\n").filter((line) => line.startsWith("data:"));
  for (const line of dataLines) {
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const candidate = JSON.parse(payload) as McpRpcResponse;
      if (candidate?.result || candidate?.error) return candidate;
    } catch {
      // not valid JSON, try next line
    }
  }

  // Path 3: fallback — try parsing entire body
  try {
    const candidate = JSON.parse(body) as McpRpcResponse;
    if (candidate?.result || candidate?.error) return candidate;
  } catch {
    // not valid JSON
  }

  throw new Error("Exa MCP returned empty content");
}

interface ParsedResult {
  title: string;
  url: string;
  published: string | null;
  snippet: string;
}

function parseMcpResultBlocks(text: string): ParsedResult[] {
  const blocks = text.split(/\n---\n/).filter((b) => b.trim().length > 0);
  const results: ParsedResult[] = [];

  for (const block of blocks) {
    const title = block.match(/^Title: (.+)/m)?.[1]?.trim() ?? "";
    const url = block.match(/^URL: (.+)/m)?.[1]?.trim() ?? "";
    if (!url) continue;

    const published = block.match(/^Published: (.+)/m)?.[1]?.trim() ?? null;

    // Extract highlights/text content after the header fields
    let content = "";
    const hlMatch = block.match(/^Highlights:\n?/m);
    if (hlMatch?.index != null) {
      content = block.slice(hlMatch.index + hlMatch[0].length).trim();
    }
    const snippet = content.slice(0, SNIPPET_MAX_CHARS);

    results.push({ title, url, published, snippet });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Direct API response mapping
// ---------------------------------------------------------------------------

interface ExaApiResult {
  title?: string;
  url?: string;
  publishedDate?: string;
  text?: string;
  highlights?: string[];
}

interface ExaApiResponse {
  results?: ExaApiResult[];
}

function mapApiResults(results: ExaApiResult[]): ParsedResult[] {
  return results.flatMap((r) => {
    if (!r.url) return [];
    return {
      title: r.title ?? "",
      url: r.url,
      published: r.publishedDate ?? null,
      snippet: (r.highlights?.join(" ") || r.text || "").slice(0, SNIPPET_MAX_CHARS),
    };
  });
}

// ---------------------------------------------------------------------------
// Freshness post-filter
// ---------------------------------------------------------------------------

function filterByFreshness(
  results: ParsedResult[],
  freshness: WebSearchOpts["freshness"],
): ParsedResult[] {
  const cutoff = Date.now() - freshnessToMs(freshness);
  return results.filter((r) => {
    if (!r.published) return true; // benefit of the doubt
    const pubTime = new Date(r.published).getTime();
    return !Number.isNaN(pubTime) && pubTime >= cutoff;
  });
}

// ---------------------------------------------------------------------------
// Common helpers
// ---------------------------------------------------------------------------

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function toWebSearchResults(
  parsed: ParsedResult[],
  category: "news" | "general",
): WebSearchResult[] {
  return parsed.map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet,
    source: extractDomain(r.url),
    published: r.published,
    category,
  }));
}

function exaCacheKey(query: string, opts: WebSearchOpts): string {
  return `web:exa:${query}:${opts.category}:${opts.freshness}:${opts.limit}`;
}

// ---------------------------------------------------------------------------
// MCP path
// ---------------------------------------------------------------------------

async function exaMcpSearch(query: string, opts: WebSearchOpts): Promise<WebSearchEnvelope> {
  const enrichedQuery = enrichQueryForMcp(query, opts.freshness);

  const response = await fetch(EXA_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++requestIdCounter,
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: {
          query: enrichedQuery,
          numResults: opts.limit,
          livecrawl: "fallback",
          type: "auto",
          contextMaxCharacters: CONTEXT_MAX_CHARS,
        },
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  // Anti-abuse handling
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      throw new Error(
        `Exa MCP rate limited (429)${retryAfter ? ` — retry after ${retryAfter}s` : ""}`,
      );
    }
    if (response.status === 403) {
      throw new Error("Exa MCP blocked (403) — possible IP-based blocking");
    }
    throw new Error(`Exa MCP HTTP ${response.status} ${response.statusText}`);
  }

  if (contentType.includes("text/html")) {
    throw new Error("Exa MCP returned HTML instead of JSON-RPC (possible challenge page)");
  }

  const body = await response.text();
  const payload = extractJsonRpcPayload(body, contentType);

  if (payload.error) {
    throw new Error(payload.error.message ?? `Exa MCP error: code ${payload.error.code}`);
  }

  const text = payload.result?.content?.find(
    (item) => item.type === "text" && typeof item.text === "string",
  )?.text;

  if (!text || text.trim().length === 0) {
    // Legitimate zero results
    return {
      query,
      results: [],
      resultCount: 0,
      fetchedAt: new Date().toISOString(),
      provider: "exa",
    };
  }

  const parsed = parseMcpResultBlocks(text);
  const filtered = filterByFreshness(parsed, opts.freshness);
  const results = toWebSearchResults(filtered, opts.category);

  return {
    query,
    results: results.slice(0, opts.limit),
    resultCount: Math.min(results.length, opts.limit),
    fetchedAt: new Date().toISOString(),
    provider: "exa",
  };
}

// ---------------------------------------------------------------------------
// Direct API path
// ---------------------------------------------------------------------------

async function exaApiSearch(
  query: string,
  opts: WebSearchOpts,
  apiKey: string,
): Promise<WebSearchEnvelope> {
  const response = await fetch(EXA_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: opts.limit,
      startPublishedDate: startPublishedDate(opts.freshness),
      contents: {
        text: { maxCharacters: CONTEXT_MAX_CHARS },
        highlights: true,
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ProviderCredentialError("exa", "stale", response.status);
    }
    const body = await response.text().catch(() => "");
    throw new Error(`Exa API HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as ExaApiResponse;
  const parsed = mapApiResults(data.results ?? []);
  const filtered = filterByFreshness(parsed, opts.freshness);
  const results = toWebSearchResults(filtered, opts.category);

  return {
    query,
    results: results.slice(0, opts.limit),
    resultCount: Math.min(results.length, opts.limit),
    fetchedAt: new Date().toISOString(),
    provider: "exa",
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function exaSearch(query: string, opts: WebSearchOpts): Promise<WebSearchEnvelope> {
  const key = exaCacheKey(query, opts);
  const cached = cache.get<WebSearchEnvelope>(key);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("exa");

    const config = getConfig();
    const envelope = config.exaApiKey
      ? await exaApiSearch(query, opts, config.exaApiKey)
      : await exaMcpSearch(query, opts);

    cache.set(key, envelope, TTL.WEB_SEARCH);
    return envelope;
  } catch (error) {
    // Re-throw abort errors immediately
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (error instanceof DOMException && error.name === "TimeoutError") throw error;
    // Re-throw credential errors so the tool layer can convert them to the
    // tagged content block. Stale cache must not mask a real auth failure.
    if (error instanceof ProviderCredentialError) throw error;

    const stale = cache.getStale<WebSearchEnvelope>(key, STALE_LIMIT.WEB_SEARCH);
    if (stale) return stale.value;
    throw error;
  }
}

export type { ExaApiResponse, McpRpcResponse, ParsedResult };
// Exported for testing
export {
  enrichQueryForMcp,
  extractJsonRpcPayload,
  filterByFreshness,
  mapApiResults,
  parseMcpResultBlocks,
};
