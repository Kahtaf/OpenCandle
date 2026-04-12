## Why

DuckDuckGo scraping (`duck-duck-scrape`) is fragile and returns thin results — no article content, unreliable dates, and keyword-only matching. Exa Search provides semantic search with content extraction via a free, unauthenticated MCP endpoint (`https://mcp.exa.ai/mcp`) that requires zero configuration. For financial queries ("companies with tariff exposure", "AAPL earnings outlook") the quality difference is substantial. Exa should replace DDG as the primary zero-config provider, with DDG demoted to fallback.

Note: Both DDG and Exa MCP send queries to external third-party services. This is inherent to web search functionality. The MCP endpoint is unauthenticated and has no published SLA — DDG remains as fallback for resilience.

## What Changes

- Add Exa search provider (`src/providers/exa-search.ts`) supporting two paths:
  - **MCP path** (default, zero-config): POST to `https://mcp.exa.ai/mcp` via JSON-RPC 2.0
  - **Direct API path** (optional): uses `EXA_API_KEY` for higher limits / faster responses
- Update cascade in `src/providers/web-search.ts`: Exa first → Brave (if key) → DDG (fallback)
- Add optional `EXA_API_KEY` / `exaApiKey` to config
- Add Exa rate-limit bucket and cache key pattern
- Extend `WebSearchEnvelope.provider` union with `"exa"`
- Tight timeout (5s) with fast fallback to prevent Exa outages from blocking searches
- Post-filter results by `Published` date to enforce freshness guarantees
- Handle 403/429/challenge responses from the unauthenticated endpoint

## Capabilities

### New Capabilities
- `exa-search`: Exa search provider with MCP and direct API paths, SSE response parsing, and result mapping to `WebSearchResult`

### Modified Capabilities
- `web-search`: Cascade order changes — Exa becomes primary, DDG becomes last-resort fallback

## Impact

- `src/providers/exa-search.ts` — new file
- `src/providers/web-search.ts` — cascade logic rewrite
- `src/config.ts` — add optional `exaApiKey`
- `src/infra/rate-limiter.ts` — add `exa` bucket
- `src/types/sentiment.ts` — extend `WebSearchEnvelope["provider"]` union
- `tests/fixtures/exa/` — new fixture directory
- `tests/providers/exa-search.test.ts` — new test file
- `tests/providers/web-search.test.ts` — update cascade tests
