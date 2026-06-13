## 1. Types and Config

- [x] 1.1 Add `"exa"` to `WebSearchEnvelope["provider"]` union in `src/types/sentiment.ts`
- [x] 1.2 Add optional `exaApiKey` to config interface and loader in `src/config.ts` (env `EXA_API_KEY`, file `providers.exa.apiKey`)
- [x] 1.3 Add `exa` bucket to rate-limiter in `src/infra/rate-limiter.ts` (5 tokens, 0.1/sec refill)

## 2. Exa Provider

- [x] 2.1 Create `tests/fixtures/exa/` with MCP SSE fixture, plain JSON fixture, API response fixture, and error/challenge fixtures
- [x] 2.2 Write tests for `exaSearch()` in `tests/providers/exa-search.test.ts`: MCP SSE parsing, plain JSON parsing, Content-Type branching, API path, freshness enrichment (MCP) vs startPublishedDate (API), freshness post-filter, 5s timeout, 429/403/HTML challenge handling, zero-results-as-success, snippet truncation to 300 chars, unique request IDs
- [x] 2.3 Implement `src/providers/exa-search.ts`: `exaSearch(query, opts)` with MCP and direct API paths, Content-Type-aware response parsing, multi-line SSE scanning, line-start-anchored field regex, freshness post-filter, 300-char snippet truncation, 5s timeout, anti-abuse handling

## 3. Cascade Update

- [x] 3.1 Update cascade tests in `tests/providers/web-search.test.ts`: Exa-first ordering, fallback to Brave on Exa timeout, fallback to DDG, Exa zero-results does NOT trigger fallthrough, all-fail scenario
- [x] 3.2 Update `src/providers/web-search.ts` cascade: Exa always first, Brave second (if key), DDG last — same order for news and general

## 4. Verify

- [x] 4.1 Run full test suite (`npm test`) — all existing and new tests pass
- [x] 4.2 Add Exa MCP contract test in `tests/e2e/` and run against live endpoint to confirm real-world response shape
