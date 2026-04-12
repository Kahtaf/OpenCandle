## ADDED Requirements

### Requirement: Exa search provider with MCP and API paths
The system SHALL provide an `exaSearch(query, opts)` function in `src/providers/exa-search.ts` that returns `WebSearchEnvelope`. When `EXA_API_KEY` is configured, it SHALL call `https://api.exa.ai/search` with the key as a Bearer token. When no key is configured, it SHALL call `https://mcp.exa.ai/mcp` using JSON-RPC 2.0. Both paths SHALL return the same `WebSearchEnvelope` shape.

#### Scenario: MCP path (no API key)
- **WHEN** `getConfig().exaApiKey` is undefined
- **THEN** the provider sends a POST to `https://mcp.exa.ai/mcp` with `method: "tools/call"`, `params.name: "web_search_exa"`, and parses the SSE response

#### Scenario: Direct API path (API key configured)
- **WHEN** `EXA_API_KEY` is set
- **THEN** the provider sends a POST to `https://api.exa.ai/search` with `Authorization: Bearer <key>` header and JSON body

#### Scenario: API key from env overrides file config
- **WHEN** both `EXA_API_KEY` env var and `providers.exa.apiKey` file config exist
- **THEN** the env var value is used

### Requirement: MCP JSON-RPC request format
The MCP request SHALL be a JSON-RPC 2.0 POST with `Content-Type: application/json` and `Accept: application/json, text/event-stream`. The body SHALL contain `method: "tools/call"` with `params.name: "web_search_exa"` and `params.arguments` containing `query`, `numResults`, `livecrawl: "fallback"`, `type: "auto"`, and `contextMaxCharacters: 1000`. The `id` field SHALL be a unique value per request (e.g., `Date.now()`).

#### Scenario: MCP request structure
- **WHEN** searching for `"AAPL earnings"` with `limit: 5` and `freshness: "day"`
- **THEN** the request body is `{ jsonrpc: "2.0", id: <unique>, method: "tools/call", params: { name: "web_search_exa", arguments: { query: "AAPL earnings past 24 hours", numResults: 5, livecrawl: "fallback", type: "auto", contextMaxCharacters: 1000 } } }`

### Requirement: MCP SSE response parsing
The MCP endpoint returns responses that may be SSE format or plain JSON. The provider SHALL:
1. Check the response `Content-Type` — if `application/json`, parse body directly as JSON-RPC
2. If SSE (`text/event-stream` or mixed), scan ALL `data:` lines for the one containing a valid JSON-RPC response with `result` or `error`
3. Fallback: attempt to parse the entire response body as JSON if no SSE framing found

The `result.content[0].text` field contains result blocks separated by `\n---\n`. Each block has line-start-anchored fields: `Title:`, `URL:`, `Published:`, `Author:`, `Highlights:`. The provider SHALL parse these with multiline-anchored regexes (`/^Title: (.+)/m`) and map to `WebSearchResult[]`. Snippets SHALL be truncated to 300 characters.

#### Scenario: Successful parse of 3 results
- **WHEN** the response payload contains 3 blocks separated by `\n---\n`
- **THEN** the provider returns a `WebSearchEnvelope` with `resultCount: 3` and 3 `WebSearchResult` items with title, url, snippet (from highlights, truncated to 300 chars), source (domain from URL), and published (ISO 8601 or null)

#### Scenario: Missing Published field
- **WHEN** a result block has no `Published:` line
- **THEN** the corresponding `WebSearchResult.published` is `null`

#### Scenario: Empty or malformed response
- **WHEN** the response contains no valid JSON-RPC payload, or the parsed text is empty
- **THEN** the provider throws an error with message `"Exa MCP returned empty content"`

#### Scenario: JSON-RPC error response
- **WHEN** the payload contains an `error` field instead of `result`
- **THEN** the provider throws with the error message from the response

#### Scenario: Zero valid results after parsing
- **WHEN** the text block parses to zero results (no blocks with valid URLs)
- **THEN** the provider returns a `WebSearchEnvelope` with `resultCount: 0` and empty `results` array (this is success, NOT an error, and does NOT trigger cascade fallthrough)

### Requirement: Direct API request format
When using the direct API path, the provider SHALL POST to `https://api.exa.ai/search` with JSON body containing `query`, `type: "auto"`, `numResults`, and `contents: { text: { maxCharacters: 1000 }, highlights: true }`. The body SHALL always include `startPublishedDate` as an ISO 8601 date computed as a rolling window from `Date.now()`: `"hours"` → 1 hour ago, `"day"` → 24 hours ago, `"week"` → 7 days ago, `"month"` → 30 days ago.

#### Scenario: API search with week freshness
- **WHEN** called with `freshness: "week"` at timestamp `2026-04-11T14:00:00Z`
- **THEN** the request body includes `startPublishedDate: "2026-04-04T14:00:00.000Z"`

#### Scenario: API response mapping
- **WHEN** the API returns `results[]` with `title`, `url`, `publishedDate`, `text`, `highlights`
- **THEN** each result maps to `WebSearchResult` with `snippet` from highlights or truncated text (300 chars max)

### Requirement: Exa query enrichment for freshness (MCP path)
Since the MCP path has no native freshness parameter, the provider SHALL append natural language recency to the query string: `"hours"` → `" past hour"`, `"day"` → `" past 24 hours"`, `"week"` → `" past week"`, `"month"` → `" past month"`. This enrichment SHALL only apply to the MCP path; the direct API path uses `startPublishedDate` instead.

#### Scenario: MCP query with day freshness
- **WHEN** query is `"AAPL earnings"` and `freshness: "day"` on the MCP path
- **THEN** the actual query sent is `"AAPL earnings past 24 hours"`

#### Scenario: API query with day freshness
- **WHEN** query is `"AAPL earnings"` and `freshness: "day"` on the API path
- **THEN** the query sent is `"AAPL earnings"` (unmodified) with `startPublishedDate` set to 24 hours ago

### Requirement: Freshness post-filter
After receiving results from either path, the provider SHALL post-filter by `Published` date. If a result's `Published` date is older than the requested freshness window (computed from `Date.now()`), it SHALL be dropped. Results without a `Published` date SHALL be kept (benefit of the doubt). The `resultCount` in the returned envelope reflects the post-filtered count.

#### Scenario: Stale result filtered out
- **WHEN** `freshness: "day"` and a result has `Published: 2026-04-09T10:00:00Z` (2 days old)
- **THEN** that result is dropped from the returned `WebSearchEnvelope`

#### Scenario: Result without Published date kept
- **WHEN** `freshness: "day"` and a result has no `Published` field
- **THEN** that result is kept in the returned `WebSearchEnvelope`

#### Scenario: All results filtered out
- **WHEN** all results are older than the freshness window
- **THEN** the provider returns `WebSearchEnvelope` with `resultCount: 0` (success, not error)

### Requirement: Exa HTTP timeout
All Exa HTTP requests (MCP and API) SHALL have a 5-second timeout via `AbortSignal.timeout(5000)`. Abort errors SHALL be re-thrown immediately (not caught by retry logic).

#### Scenario: MCP request times out
- **WHEN** the MCP endpoint does not respond within 5 seconds
- **THEN** the request is aborted and the provider throws a timeout error; the cascade tries the next provider

### Requirement: Anti-abuse response handling
The provider SHALL detect and handle non-standard responses from the unauthenticated MCP endpoint:

#### Scenario: HTTP 429 (rate limited)
- **WHEN** the MCP endpoint returns HTTP 429
- **THEN** the provider throws an error; if `Retry-After` header is present, the error message includes the retry delay

#### Scenario: HTTP 403 (blocked)
- **WHEN** the MCP endpoint returns HTTP 403
- **THEN** the provider throws an error with message indicating possible IP-based blocking

#### Scenario: HTML challenge page
- **WHEN** the response has `Content-Type` containing `text/html` instead of JSON or SSE
- **THEN** the provider throws an error with message `"Exa MCP returned HTML instead of JSON-RPC (possible challenge page)"`

#### Scenario: HTTP 5xx
- **WHEN** the MCP endpoint returns a 5xx status code
- **THEN** the provider throws an error with the status code; the cascade tries the next provider

### Requirement: Exa rate limiting and caching
The provider SHALL acquire `rateLimiter.acquire("exa")` before each HTTP call. The rate-limiter bucket for `exa` SHALL have 5 tokens with 0.1/sec refill (~6 req/min). Results SHALL be cached with key pattern `web:exa:{normalizedQuery}:{category}:{freshness}:{limit}` using `TTL.WEB_SEARCH` (5 minutes) and `STALE_LIMIT.WEB_SEARCH` (1 hour).

#### Scenario: Rate limiter delays request
- **WHEN** 6 Exa requests are made within 10 seconds
- **THEN** the 6th request waits for a token before proceeding

#### Scenario: Cached Exa result
- **WHEN** the same Exa query is made within 5 minutes
- **THEN** the cached result is returned without an HTTP call

### Requirement: Exa API key in config
The system SHALL support `EXA_API_KEY` as an environment variable and `providers.exa.apiKey` in `~/.opencandle/config.json`. Env var takes precedence. When absent, the MCP path is used with no degradation.

#### Scenario: Key from environment
- **WHEN** `EXA_API_KEY` is set as an environment variable
- **THEN** `getConfig().exaApiKey` returns the value and the direct API path is used

#### Scenario: No key configured
- **WHEN** neither env var nor file config contains an Exa key
- **THEN** `getConfig().exaApiKey` is undefined and the MCP path is used
