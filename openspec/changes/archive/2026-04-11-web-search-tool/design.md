## Context

OpenCandle is a financial analysis agent with 20+ tools covering market data, fundamentals, macro, sentiment, and options — but zero web search capability. When the agent needs context beyond its structured APIs (breaking news, earnings recaps, company background, regulatory developments), it has no recourse.

Research into agent web search tools (fieldtheory-cli, pi-web-access, duck-duck-scrape, open-webSearch, mcp-searxng, web-search-mcp, Tavily, Daedra) revealed that free search engines have reliability and quality issues. DuckDuckGo rate-limits and has weaker news results; Brave has excellent news but requires an API key. The design uses DDG as a zero-config default with Brave as an optional upgrade, particularly for news.

The tool must also serve as infrastructure for the planned unified sentiment pipeline, which will use web search results as one of three signal sources (alongside Twitter and Reddit).

## Goals / Non-Goals

**Goals:**

- Provide the agent with general-purpose web search as an `AgentTool`
- Support news-specific searches with freshness filtering (critical for financial context)
- Work out-of-the-box with zero configuration (DuckDuckGo)
- Optionally upgrade to better news coverage via Brave Search API (`BRAVE_API_KEY`)
- When Brave is configured, prefer it for news queries (better quality than DDG news)
- Follow all existing OpenCandle patterns (Typebox params, `withFallback`, cache/stale, rate limiter, markdown output)
- Produce a `WebSearchEnvelope` type consistent with existing provider result patterns
- Default to finance-appropriate settings (category: news, freshness: day)

**Non-Goals:**

- Google/browser-based search fallback (deferred — needs a spike for consent pages, CAPTCHAs, and extraction stability before it can be a reliable provider)
- Full article text extraction / readability parsing (future `fetch_page` tool if needed)
- Embedding or indexing search results (that's the sentiment pipeline's job)
- Replacing any existing provider (Yahoo Finance, FRED, etc.) with web search
- MCP server integration (library import is simpler and sufficient)
- Real-time streaming of search results
- Source quality ranking or trust scoring (valuable but out of scope for v1)

## Decisions

### D1: duck-duck-scrape as zero-config default

**Decision**: Use `duck-duck-scrape` as an npm dependency imported directly into the provider. Not an MCP server, not a subprocess, not SearXNG.

**Rationale**: duck-duck-scrape is a TypeScript library that returns structured JSON with zero config and zero API keys. MCP servers add process management complexity. SearXNG requires an instance URL. The library approach fits our existing provider pattern.

**Risk**: Last commit was March 2025 (13 months ago). DDG could change their scraping surface. Mitigation: the provider interface is stable — swapping the DDG implementation doesn't change the tool contract. Must verify the actual API surface (enum names, method signatures) against the published npm package before implementing, not from memory.

### D2: Brave as optional upgrade, primary for news when configured

**Decision**: When `BRAVE_API_KEY` is configured, the provider prefers Brave for `category: "news"` (Brave has a dedicated news endpoint with superior financial coverage). DDG remains the fallback. For `category: "general"`, DDG is tried first with Brave as fallback.

**Rationale**: The original design used a fixed DDG-first cascade regardless of configuration. Codex review identified this as a flaw: users who configure Brave expect better results, not just a rescue path. Brave's `/news/search` endpoint returns higher-quality financial news than DDG's news search. The conditional ordering ensures the "upgrade" actually upgrades the experience.

```
category: "news"  + Brave configured → Brave first, DDG fallback
category: "news"  + no Brave key     → DDG only
category: "general" + Brave configured → DDG first, Brave fallback
category: "general" + no Brave key     → DDG only
```

**Alternative considered**: Always Brave-first when configured. Rejected because DDG general results are adequate and this preserves the free quota for news queries where Brave adds the most value.

### D3: withFallback only, no double-wrapping

**Decision**: The tool calls `withFallback()` directly. The tool does NOT additionally wrap the call with `wrapProvider()`. `withFallback` already calls `wrapProvider` internally for each provider in the chain (see `src/providers/with-fallback.ts:29`).

**Rationale**: Codex review identified that double-wrapping (withFallback inside, wrapProvider outside) would break stale-cache signaling and double-count circuit breaker failures. `withFallback` returns a `ProviderResult<T>` — the tool consumes it directly.

### D4: Snippets-only, no full-text extraction

**Decision**: The tool returns search result snippets (title, URL, snippet, date, source domain). It does not fetch or parse full article text.

**Rationale**: For financial context (news summaries, event confirmation, background), snippets are usually sufficient. For earnings recaps or regulatory details where snippets may be too thin, the agent can note the limitation and cite the source URL. Full-text extraction (readability, JS rendering, paywalls) is a separate concern for a future `fetch_page` tool.

### D5: Finance-tuned defaults

**Decision**: Default `category: "news"` and `freshness: "day"`. These differ from a general-purpose search tool but match OpenCandle's financial context.

**Rationale**: Codex review identified that `category: "general"` + `freshness: "any"` is actively bad for finance. Queries like "AAPL earnings" or "Fed rate decision" are almost always recency-driven. The financial agent context means most searches want recent news, not evergreen pages. The agent can override to `"general"` or `"week"` when it needs broader results.

### D6: Hour-level freshness for market-moving events

**Decision**: Add `freshness: "hours"` option alongside day/week/month. Maps to the tightest recency filter each engine supports (DDG: past day as closest approximation; Brave: `freshness=ph` for past hour).

**Rationale**: FOMC statements, earnings calls, FDA decisions, and after-hours filings need hour-level recency. Day-level is too coarse for events that happened "this afternoon."

### D7: Cache with dedicated TTL, not reusing TTL.SENTIMENT

**Decision**: Add `TTL.WEB_SEARCH` (5m) and `STALE_LIMIT.WEB_SEARCH` (1h) as dedicated constants rather than aliasing `TTL.SENTIMENT`.

**Rationale**: Web search and sentiment data have different freshness profiles. Even if the values are currently the same (5m/1h), dedicated constants allow independent tuning later without coupling unrelated features.

### D8: Config follows existing nested provider pattern

**Decision**: Brave API key is stored as `providers.brave.apiKey` in `~/.opencandle/config.json` and `BRAVE_API_KEY` as env var. This matches the existing `providers.alphaVantage.apiKey` and `providers.fred.apiKey` pattern in `src/config.ts`.

**Rationale**: Codex review identified that the original proposal specified a top-level `braveApiKey` which contradicts the existing nested `OpenCandleFileConfig` schema.

### D9: WebSearchEnvelope wraps results with metadata

**Decision**: The provider returns `WebSearchEnvelope` containing `query`, `results: WebSearchResult[]`, `fetchedAt`, `provider: "ddg" | "brave"`, and `resultCount`. The tool returns this as `details` for LLM consumption.

**Rationale**: Codex review identified that returning raw `WebSearchResult[]` as details loses context (which query, when fetched, which engine served it). Existing providers like `TwitterSentimentResult` and `RedditSentimentResult` include `query` and `fetchedAt`. The envelope is consistent with those patterns.

### D10: Tool lives in `src/tools/sentiment/`, not a new `research/` domain

**Decision**: Place the tool in `src/tools/sentiment/` rather than creating a new `src/tools/research/` domain.

**Rationale**: `src/tools/AGENTS.md` defines seven tool domains. Creating a new domain for a single tool is premature. Web search is most closely aligned with the sentiment domain (news, context, discussions) and will be consumed by the sentiment pipeline. If more research-oriented tools emerge later, a domain split can happen then.

### D11: Query normalization for financial context

**Decision**: The provider normalizes bare ticker patterns (`/^[A-Z]{1,5}$/`) by appending context: `"AAPL"` → `"AAPL stock news"`. Cashtag patterns (`$AAPL`) strip the `$` and append context. Free-form queries pass through unchanged.

**Rationale**: Codex review noted that the Twitter provider normalizes queries but the web search proposal did nothing comparable. Bare ticker searches on DDG/Brave return exchange pages and brokerage ads, not useful news. Adding "stock news" significantly improves result quality for the primary use case.

## Risks / Trade-offs

**[DuckDuckGo rate limiting]** DDG may rate-limit or block requests, especially from datacenter IPs. Mitigation: Brave fallback when configured; rate limiter configured conservatively (3 tokens, ~6 req/min); cache prevents redundant requests within 5-minute window.

**[duck-duck-scrape maintenance]** Package is 13 months stale. Mitigation: must verify actual API surface against published package before implementing (not from memory — the spec references enum names that may be wrong). The provider interface means DDG implementation is swappable without tool contract changes.

**[Brave free tier limits]** 2,000 queries/month. For an agent that may issue multiple searches per workflow, this is tight. Mitigation: DDG handles general queries; Brave is reserved for news where it adds the most value. No usage tracking in v1, but the rate limiter bucket prevents burst exhaustion.

**[Brave API errors]** Invalid key (401), expired quota (429), service outage. Mitigation: each error case is handled in the Brave provider function — 401 throws with a descriptive message; 429 throws (cascade falls through to DDG); 5xx throws (cascade falls through). All cases are specified in the spec.

**[Search result quality varies]** DDG news is weaker than Brave for financial topics. SEO spam and syndication farms may dominate results without source-quality ranking. Mitigation: the `source` field (extracted domain) lets the agent reason about quality; Brave configuration improves news quality; source ranking is a future enhancement.

**[Agent over-uses web search]** Adding search_web to the tool catalog may cause the agent to search for things that existing tools handle better (prices, fundamentals). Mitigation: explicit negative guidance in tool description and prompt catalog. Specific exclusion list in system prompt.

**[Empty results ambiguity]** DDG may return zero results either because the query has no matches OR because it's rate-limiting silently. Mitigation: DDG rate-limit detection uses HTTP status codes and response shape analysis, not result count. Zero results from a valid response is reported as "no results found," not a provider failure. The spec has distinct scenarios for each case.

## Open Questions

1. **duck-duck-scrape API verification**: The spec references `SearchType.NEWS`, `SearchTimeType.Day`, etc. These must be verified against the actual published package before implementation. A task is included to audit the dependency's actual exports.

2. **Rate limiter tuning**: Starting at 3 tokens / 0.1 tokens-per-sec (~6 req/min) for DDG. May need adjustment based on observed rate-limit behavior. Brave at 5 tokens / 0.083 tokens-per-sec (~5 req/min).

3. **Brave quota management**: Should we track Brave usage and warn when approaching the 2,000/month limit? Deferred to v2 — for now the rate limiter prevents burst exhaustion but doesn't track monthly totals.
