**Testing discipline**: TDD is mandatory per project conventions. Every implementation task follows red-green-refactor: (1) write the failing test first, (2) implement the minimal code to make it pass, (3) refactor with tests green. Test tasks are listed before their corresponding implementation tasks to enforce this ordering. Never write implementation before a failing test.

## 1. Dependency Audit and Types

- [x] 1.1 Install `duck-duck-scrape` — `npm install duck-duck-scrape`. After install, audit the actual exports: verify enum names (`SearchType`, `SearchTimeType`, `SafeSearchType`), method signatures, and response shapes against the published package. Document any discrepancies from the spec before proceeding.
- [x] 1.2 **RED**: Write failing tests for `WebSearchResult` and `WebSearchEnvelope` type guards in `tests/unit/types/research.test.ts` — test that valid shapes pass, invalid shapes fail (missing fields, wrong types, out-of-range values)
- [x] 1.3 **GREEN**: Add `WebSearchResult` and `WebSearchEnvelope` interfaces to `src/types/sentiment.ts`. Export from `src/types/index.ts` barrel. Run tests — should pass.
- [x] 1.4 **RED**: Write failing test for config loading in `tests/unit/infra/config.test.ts` — test `braveApiKey` from env (`BRAVE_API_KEY`), from file (`providers.brave.apiKey`), env overrides file, absent returns undefined
- [x] 1.5 **GREEN**: Add optional `braveApiKey` to config in `src/config.ts` — add `brave?: { apiKey?: string }` under `OpenCandleFileConfig.providers`, add `braveApiKey?: string` to `Config` interface, resolve from env or file config. Run tests — should pass.
- [x] 1.6 Add `TTL.WEB_SEARCH` (300_000 ms) and `STALE_LIMIT.WEB_SEARCH` (3_600_000 ms) constants in `src/infra/cache.ts`
- [x] 1.7 Add rate limiter buckets in `src/infra/rate-limiter.ts` — `ddg`: 3 tokens, 0.1 tokens/sec (~6 req/min). `brave_search`: 5 tokens, 0.083 tokens/sec (~5 req/min)

## 2. DuckDuckGo Provider

- [x] 2.1 Add test fixtures in `tests/fixtures/web-search/ddg-news.json` and `tests/fixtures/web-search/ddg-general.json` — sample DDG responses for both search types (based on actual response shapes verified in 1.1)
- [x] 2.2 **RED**: Write failing tests for `ddgSearch` in `tests/unit/providers/web-search.test.ts` — mock `duck-duck-scrape` search function. Test cases:
  - news vs general search type mapping
  - freshness mapping (hours/day/week/month → DDG enums)
  - query normalization: bare ticker "AAPL" → "AAPL stock news", cashtag "$TSLA" → "TSLA stock news", free-form unchanged
  - result mapping to `WebSearchResult` (domain extraction from URL, date parsing to ISO 8601)
  - rate-limit detection (HTTP error / HTML response) vs legitimate zero results (valid empty response is NOT a failure)
  - cache hit returns without HTTP call
  - stale fallback on provider error
- [x] 2.3 **GREEN**: Implement `ddgSearch(query, opts)` in `src/providers/web-search.ts` — query normalization, DDG call with correct enums, result mapping, domain extraction, date parsing, cache, rate-limit detection. Run tests — should pass.
- [x] 2.4 **REFACTOR**: Review ddgSearch implementation — extract query normalization into a shared `normalizeFinancialQuery()` function (used by both DDG and Brave). Clean up.

## 3. Brave Search Provider

- [x] 3.1 Add test fixtures in `tests/fixtures/web-search/brave-news.json` and `tests/fixtures/web-search/brave-general.json` — sample Brave API responses
- [x] 3.2 **RED**: Write failing tests for `braveSearch` in `tests/unit/providers/web-search.test.ts` — mock httpGet. Test cases:
  - news endpoint routing (`/news/search`)
  - general endpoint routing (`/web/search`)
  - freshness mapping (hours→"ph", day→"pd", week→"pw", month→"pm")
  - `X-Subscription-Token` header set correctly
  - result mapping to `WebSearchResult`
  - 401 error → descriptive message about invalid key
  - 429 error → throws for cascade fallback
  - 5xx error → throws for cascade fallback
  - cache hit, stale fallback
- [x] 3.3 **GREEN**: Implement `braveSearch(query, opts, apiKey)` in `src/providers/web-search.ts`. Run tests — should pass.

## 4. Cascade Orchestration

- [x] 4.1 **RED**: Write failing tests for `searchWeb` cascade in `tests/unit/providers/web-search.test.ts` — mock both provider functions. Test cases:
  - News + Brave key → Brave called first, DDG not called on success
  - News + Brave key + Brave 429 → DDG called as fallback
  - News + no Brave key → DDG only (Brave never in fallback array)
  - General + Brave key → DDG called first, Brave fallback on DDG failure
  - General + no Brave key → DDG only
  - All providers fail → returns `{ status: "unavailable" }`
  - Confirms `wrapProvider` is NOT called at the orchestration level (only inside `withFallback`)
- [x] 4.2 **GREEN**: Implement `searchWeb(query, opts)` — apply defaults (news, day, 10), normalize query, build conditional `withFallback` array, call `withFallback` directly. Export from `src/providers/index.ts`. Run tests — should pass.

## 5. search_web Tool

- [x] 5.1 **RED**: Write failing tests for `search_web` tool in `tests/unit/tools/web-search.test.ts` — mock `searchWeb` provider. Test cases:
  - default params applied (category: news, freshness: day, limit: 10)
  - category/freshness override passed through
  - limit clamped to 1..20
  - empty/whitespace query → error content, provider NOT called
  - `status: "unavailable"` → `⚠` message in content
  - stale flag → warning prefix in content
  - markdown output format: header with query/count/provider, bulleted list with linked titles
  - markdown-sensitive characters escaped in titles and snippets
  - `details` is full `WebSearchEnvelope` (not bare array)
- [x] 5.2 **GREEN**: Implement `search_web` tool in `src/tools/sentiment/web-search.ts` — Typebox params, input validation, call searchWeb, format markdown, return content + details. Register in `src/tools/index.ts`. Run tests — should pass.
- [x] 5.3 **RED**: Write failing test in `tests/unit/prompts/context-builder.test.ts` — verify `search_web` appears in tool catalog output with correct guidance
- [x] 5.4 **GREEN**: Add web search to `TOOL_CATALOG` in `src/prompts/context-builder.ts`. Run tests — should pass.

## 6. E2E and Agent Harness Tests

- [x] 6.1 Run full unit test suite (`npm test`) — verify no regressions, all new tests green
- [x] 6.2 Add e2e provider test in `tests/e2e/providers.test.ts` — call `ddgSearch` against live DDG for query "AAPL stock news". Assert: returns `WebSearchEnvelope` with `resultCount > 0`, each result has non-empty `title`, `url`, `snippet`, and valid `source` domain. Wrap in try/catch for DDG rate-limiting in CI — skip with warning on rate limit, do not fail the suite.
- [x] 6.3 Add e2e tool test in `tests/e2e/tools.test.ts` — call `search_web` tool's `execute()` directly with `{ query: "Federal Reserve rate decision" }`. Assert: `content[0].text` contains result count, `details.resultCount > 0`, `details.provider` is `"ddg"` or `"brave"`. Same rate-limit graceful skip as 6.2.
- [x] 6.4 **Agent harness e2e — tool selection**: Run agent via harness with prompt: `"What happened at AAPL's most recent earnings call?"`. Assert from trace:
  - `toolSequence` includes `search_web`
  - `search_web` tool call args have `category: "news"` (or default)
  - `search_web` tool call result is not an error
  - `finalText` references information from search results
  ```bash
  npx tsx tests/harness/cli.ts run --prompt "What happened at AAPL's most recent earnings call?" --ipc /tmp/oc-web-search-1
  # poll with: npx tsx tests/harness/cli.ts wait --ipc /tmp/oc-web-search-1
  # read trace: npx tsx tests/harness/cli.ts trace --ipc /tmp/oc-web-search-1
  ```
- [x] 6.5 **Agent harness e2e — negative selection**: Run agent via harness with prompt: `"What is AAPL trading at right now?"`. Assert from trace:
  - `toolSequence` includes `get_stock_quote` (NOT `search_web`)
  - Agent uses the dedicated tool, not web search, for real-time prices
  ```bash
  npx tsx tests/harness/cli.ts run --prompt "What is AAPL trading at right now?" --ipc /tmp/oc-web-search-2
  ```
- [x] 6.6 **Agent harness e2e — news freshness**: Run agent via harness with prompt: `"Search for the latest news about semiconductor tariffs"`. Assert from trace:
  - `toolSequence` includes `search_web`
  - `search_web` args include `freshness: "day"` or `freshness: "hours"` (agent should pick recent)
  - Results are returned (not unavailable)
  ```bash
  npx tsx tests/harness/cli.ts run --prompt "Search for the latest news about semiconductor tariffs" --ipc /tmp/oc-web-search-3
  ```
