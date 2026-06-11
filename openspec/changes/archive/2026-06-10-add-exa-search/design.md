## Context

The web search provider (`src/providers/web-search.ts`) currently uses DDG via `duck-duck-scrape` as the zero-config primary and Brave Search API as an optional upgrade. DDG is a scraper — fragile, keyword-only, no content extraction. Exa Search offers semantic search with content via a free MCP endpoint that needs no API key. We verified the endpoint works: `POST https://mcp.exa.ai/mcp` returns structured results (title, URL, published date, highlights) in ~800-1400ms with zero configuration.

Both DDG and Exa MCP send queries to external services — this is inherent to web search. The MCP endpoint is unauthenticated with no published SLA, so DDG stays as a resilient fallback.

## Goals / Non-Goals

**Goals:**
- Replace DDG as primary zero-config search provider with Exa MCP
- Support optional `EXA_API_KEY` for users who want higher rate limits / direct API access
- Keep DDG as a reliable last-resort fallback
- Fast fallback (5s timeout) so Exa outages don't block searches
- Maintain existing `withFallback` / `wrapProvider` / cache / rate-limiter patterns
- Snippet length parity with DDG/Brave to avoid downstream sentiment distortion

**Non-Goals:**
- Removing DDG entirely (it stays as fallback)
- Adding Exa content extraction (full article fetching) — only search results
- Full MCP client with capability discovery / version negotiation (one hardcoded tool call is sufficient for this single-purpose endpoint)
- Changing the `search_web` tool interface or `WebSearchResult` type shape

## Decisions

### 1. Single provider module, two code paths

`src/providers/exa-search.ts` exports one `exaSearch(query, opts)` function. Internally it checks for `EXA_API_KEY`:
- **If key exists:** call `https://api.exa.ai/search` directly with auth header
- **If no key:** call `https://mcp.exa.ai/mcp` via JSON-RPC 2.0

**Why:** Keeps the provider interface identical to DDG/Brave — one function, one cache key pattern. The MCP vs API distinction is an implementation detail invisible to the cascade.

**Alternative considered:** Separate `exaMcpSearch` / `exaApiSearch` providers in the cascade. Rejected — unnecessary complexity, and the fallback between MCP and API isn't a cascade concern (if you have a key, always use the API).

### 2. SSE response parsing with Content-Type branching

The MCP endpoint returns SSE format. The parser SHALL:
1. Check `Content-Type` header — if `application/json`, parse body directly as JSON-RPC response
2. If `text/event-stream` or mixed, scan ALL `data:` lines (not just the first), find the one containing a valid JSON-RPC response with `result` or `error`
3. Fallback: attempt to parse the entire body as JSON if no SSE framing found

The JSON payload has `result.content[0].text` containing all results as a single text blob with `\n---\n` separators. Each block has `Title:`, `URL:`, `Published:`, `Author:`, `Highlights:` line-prefixed fields.

Parser strategy: split on `\n---\n`, then match each block's header fields (`/^Title: (.+)/m`, `/^URL: (.+)/m`, etc.) before extracting the remaining text as highlights. Field regexes only match at line start, so article content containing `Title:` mid-line won't corrupt the parse.

**Why line-start-anchored regex:** The MCP response is text, not JSON per-result. Anchoring to line start (`^` with multiline flag) is the pragmatic approach and matches pi-web-access's proven `parseMcpResults()`.

### 3. Cascade order: Exa → Brave → DDG (uniform)

The new `withFallback` array:
```
always:  [exaSearch]
if key:  [braveSearch]
always:  [ddgSearch]
```

Same order for both `"news"` and `"general"` categories. Exa is always first because its semantic search outperforms both DDG and Brave for all categories. The old DDG-first-for-general strategy was a Brave quota optimization — irrelevant when Exa is primary.

### 4. Freshness: query enrichment + post-filter

**MCP path:** Append natural language recency to the query string (`"past 24 hours"`, `"past week"`, `"past month"`). This is a hint, not a guarantee — Exa may still return older results.

**API path:** Use `startPublishedDate` as a rolling window from `Date.now()` (not midnight-rounded).

**Both paths:** Post-filter results by `Published` date. If a result's `Published` date is older than the requested freshness window, drop it. Results without a `Published` date are kept (benefit of the doubt). This ensures we never claim "past day" while showing week-old articles.

### 5. `contextMaxCharacters` parameter

Set to `1000`. This controls how much article text Exa returns. Lower than pi-web-access's 3000 because we only need enough for a good snippet (300 chars) and relevance ranking. Smaller payloads mean faster responses and less parsing surface.

### 6. Snippet length normalization

Exa highlights are truncated to **300 characters** when mapping to `WebSearchResult.snippet`, matching the typical length of DDG/Brave snippets. This prevents downstream sentiment distortion — the sentiment scorer weights by text length, so provider-dependent snippet sizes would change sentiment outputs.

### 7. Tight timeout with fast fallback

**5-second timeout** for all Exa HTTP requests (MCP and API). This is intentionally aggressive — a healthy Exa endpoint responds in 800-1400ms, so 5s gives ~3.5x headroom. If Exa is sick, we fall through to Brave/DDG quickly rather than making every search feel hung.

The existing `providerTracker` circuit breaker handles repeated failures within a session. Cross-session circuit breaking is a future consideration if Exa proves unreliable.

### 8. Anti-abuse response handling

The MCP endpoint is public and unauthenticated. The provider SHALL handle:
- **HTTP 429** — throw, let cascade fall through. Honor `Retry-After` header if present.
- **HTTP 403** — throw, let cascade fall through. Likely IP-based blocking.
- **Non-JSON response body** (HTML challenge page) — detect via Content-Type, throw with descriptive message.
- **HTTP 5xx** — throw, let cascade fall through.

All of these trigger the existing `providerTracker` failure recording for circuit breaking.

### 9. Rate limiting: conservative bucket

Add `exa` bucket to rate-limiter: 5 tokens, 0.1/sec refill (~6 req/min). We don't know Exa MCP's actual limits, so start conservative. Can be tuned up if no rate-limiting is observed.

### 10. Config: optional `EXA_API_KEY`

Add to config following existing pattern: env var `EXA_API_KEY`, file config `providers.exa.apiKey`. Env takes precedence. When absent, MCP path is used — no degradation.

## Risks / Trade-offs

**Exa MCP has no SLA** → Mitigated by 5s timeout + DDG fallback. If MCP is down, cascade falls through transparently within seconds.

**MCP response format could change** → Mitigated by defensive parsing (graceful handling of missing fields, Content-Type branching). Hardcoded `web_search_exa` tool name is a known coupling — acceptable for a single-purpose integration.

**MCP response time (~1s) is slower than DDG (~300ms)** → Acceptable. Quality improvement outweighs latency. Cache (5-min TTL) absorbs repeated queries.

**Unknown MCP rate limits** → Mitigated by conservative rate-limiter bucket (6 req/min) and cache. If we discover actual limits, we can adjust.

**Freshness is best-effort on MCP path** → Mitigated by post-filtering on `Published` date. We drop results that violate the freshness window rather than trusting the query enrichment alone.

**`duck-duck-scrape` becomes rarely exercised code** → Acceptable. It's still tested and maintained as fallback.
