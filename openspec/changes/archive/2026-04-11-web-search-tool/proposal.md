## Why

OpenCandle has no way to search the open web. Every data source is a structured API (Yahoo Finance, FRED, SEC EDGAR, Reddit JSON, Twitter scraper). When the agent encounters a question outside those APIs — breaking news, unfamiliar tickers, earnings context, company events, regulatory changes — it either hallucinates or says "I don't know." This is the single biggest capability gap: web search is foundational infrastructure that every other enrichment (including the planned sentiment pipeline) depends on.

The research behind this change studied fieldtheory-cli (a local-first Twitter bookmark indexing system), pi-web-access (Pi's web search extension with cascading providers), and 8+ open-source agent web search tools. The key insight: free search engines have reliability issues (rate limits, IP blocking, downtime), so a fallback option improves robustness when the primary engine degrades.

## What Changes

- **Add a `search_web` tool** in `src/tools/sentiment/` — a general-purpose web search tool with category (`"news"` | `"general"`), freshness (`"hours"` | `"day"` | `"week"` | `"month"`), and limit parameters. Defaults are tuned for financial context: `category: "news"`, `freshness: "day"`.
- **Add a `web-search` provider** in `src/providers/` — a two-tier search provider: DuckDuckGo (zero-config, via `duck-duck-scrape`) as default, Brave Search API as upgrade when `BRAVE_API_KEY` is configured. When Brave is configured and `category === "news"`, Brave is primary (better news results). When Brave is not configured, DDG handles everything.
- **Add a `WebSearchResult` type** in `src/types/sentiment.ts` (co-located with other sentiment types).
- **Add `WebSearchEnvelope` type** wrapping results with `query`, `fetchedAt`, `provider`, and stale metadata — consistent with existing provider result patterns.
- **Add `BRAVE_API_KEY` as an optional config key** in `src/config.ts` — nested under `providers.brave.apiKey` in file config, matching the existing `providers.alphaVantage.apiKey` pattern.
- **Register the tool** in `src/tools/index.ts` and add it to the tool catalog in `src/prompts/context-builder.ts`.
- **Add `duck-duck-scrape` as a dependency** — TypeScript library, zero-config, MIT, minimal deps (`html-entities` + `needle`).
- **Configure rate limiter** for `ddg` and `brave_search` provider buckets.

## Capabilities

### New Capabilities
- `web-search`: Web search with DDG as zero-config default and Brave as optional upgrade for news. Supports news-specific and freshness-filtered queries. Returns structured results (title, URL, snippet, publication date, source domain) in a `WebSearchEnvelope`.

### Modified Capabilities
- No existing capabilities modified. The web search provider infrastructure will be consumed by the future unified sentiment pipeline's web adapter.

## Impact

- **New files**: `src/tools/sentiment/web-search.ts`, `src/providers/web-search.ts`
- **Modified files**: `src/tools/index.ts` (register tool), `src/config.ts` (optional `braveApiKey` under `providers.brave`), `src/infra/rate-limiter.ts` (add `ddg` and `brave_search` buckets), `src/prompts/context-builder.ts` (add web search to `TOOL_CATALOG`), `src/types/sentiment.ts` (add `WebSearchResult` and `WebSearchEnvelope`)
- **Barrel exports**: Update `src/types/index.ts` and `src/providers/index.ts` to export new types/provider
- **Existing infra reused**: `cache`/`rateLimiter`/`httpGet` from `src/infra/`, `withFallback` from `src/providers/with-fallback.ts`
- **New dependency**: `duck-duck-scrape` (MIT, TypeScript, minimal deps)
- **Behavioral note**: Adding a new tool to the prompt changes the agent's tool-choice behavior. The tool description and system prompt guidance must be explicit about when NOT to use web search (prices, fundamentals, macro data all have dedicated tools).
