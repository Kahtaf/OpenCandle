# Web Search Specification

## Purpose
TBD - normalized from existing baseline requirements.

## Requirements

### Requirement: Web search provider with conditional cascade
The system SHALL provide a `searchWeb(query, opts)` function in `src/providers/web-search.ts` that returns `ProviderResult<WebSearchEnvelope>`. The provider uses `withFallback()` with a cascade order that depends on configuration and category:

- When `BRAVE_API_KEY` is configured and `category === "news"`: Brave first, DDG fallback (Brave has superior news results)
- When `BRAVE_API_KEY` is configured and `category === "general"`: DDG first, Brave fallback (DDG general results are adequate; saves Brave quota)
- When no `BRAVE_API_KEY`: DDG only

The provider SHALL NOT be additionally wrapped with `wrapProvider()` at the tool level — `withFallback()` already calls `wrapProvider` per entry internally.

#### Scenario: News search, Brave configured, Brave succeeds
- **WHEN** `category: "news"` and `BRAVE_API_KEY` is set and Brave returns results
- **THEN** Brave results are returned; DDG is not called

#### Scenario: News search, Brave configured, Brave fails (429)
- **WHEN** `category: "news"` and Brave returns HTTP 429 (quota exceeded)
- **THEN** the cascade falls through to DDG

#### Scenario: General search, Brave configured
- **WHEN** `category: "general"` and `BRAVE_API_KEY` is set
- **THEN** DDG is tried first; Brave is fallback only if DDG fails

#### Scenario: No Brave key configured
- **WHEN** `getConfig().braveApiKey` is undefined
- **THEN** only DDG is in the `withFallback` array (Brave is omitted entirely, not tried and failed)

#### Scenario: All providers fail, no stale cache
- **WHEN** all providers in the cascade fail and no stale cache exists
- **THEN** `withFallback` returns `{ status: "unavailable", reason: "all providers failed: ...", provider: "..." }`

#### Scenario: All providers fail, stale cache exists
- **WHEN** all providers fail but a cached result exists within `STALE_LIMIT.WEB_SEARCH` (1 hour)
- **THEN** the stale cached data is returned (stale flag propagated via `wrapProvider`)

### Requirement: WebSearchOpts type
The provider SHALL define `WebSearchOpts`: `{ category: "news" | "general"; freshness: "hours" | "day" | "week" | "month"; limit: number }`. The `searchWeb` function accepts `Partial<WebSearchOpts>` and applies defaults: `category: "news"`, `freshness: "day"`, `limit: 10`.

#### Scenario: Partial options use defaults
- **WHEN** `searchWeb("AAPL earnings", {})` is called without explicit options
- **THEN** the provider uses category `"news"`, freshness `"day"`, and limit `10`

### Requirement: DuckDuckGo search via ddg-kit
The system SHALL use the `ddg-kit` npm package for DuckDuckGo searches. Enum names and method signatures SHALL be verified against the published package before implementation (not assumed from the spec).

#### Scenario: News search with day freshness
- **WHEN** called with `category: "news"` and `freshness: "day"`
- **THEN** the function calls ddg-kit with news search type and day time range

#### Scenario: General search
- **WHEN** called with `category: "general"`
- **THEN** the function calls ddg-kit with default (web) search type

#### Scenario: Hours freshness (approximation)
- **WHEN** called with `freshness: "hours"`
- **THEN** the function uses DDG's closest available filter (past day), since DDG does not support hour-level recency

### Requirement: DuckDuckGo rate-limit detection
The system SHALL detect DDG rate limiting via HTTP status codes and response shape analysis (e.g., HTML error page instead of expected JSON/data). Zero results from a valid response SHALL NOT be treated as rate-limiting — that is a legitimate "no matches" outcome.

#### Scenario: DDG rate-limited (HTTP error)
- **WHEN** DDG returns an HTTP error or unexpected response shape
- **THEN** the provider throws a typed error; the cascade tries the next provider

#### Scenario: DDG returns zero results (legitimate)
- **WHEN** DDG returns a valid response with zero matching results
- **THEN** the provider returns an empty `WebSearchEnvelope` with `resultCount: 0`; this is NOT treated as a failure and the cascade does NOT fall through

### Requirement: Brave Search API (optional)
The system SHALL support Brave Search API when `BRAVE_API_KEY` is configured. It SHALL call `https://api.search.brave.com/res/v1/news/search` for news and `https://api.search.brave.com/res/v1/web/search` for general queries. The `freshness` parameter SHALL map: `"hours"` → `"ph"`, `"day"` → `"pd"`, `"week"` → `"pw"`, `"month"` → `"pm"`.

#### Scenario: Brave news search with freshness
- **WHEN** called with `category: "news"`, `freshness: "week"`, and a valid API key
- **THEN** calls `https://api.search.brave.com/res/v1/news/search?q=...&freshness=pw` with `X-Subscription-Token` header

#### Scenario: Brave 401 (invalid key)
- **WHEN** Brave returns HTTP 401
- **THEN** the provider throws an error with a descriptive message indicating the API key may be invalid or expired

#### Scenario: Brave 429 (quota exceeded)
- **WHEN** Brave returns HTTP 429
- **THEN** the provider throws; the cascade falls through to DDG

#### Scenario: Brave 5xx (service error)
- **WHEN** Brave returns a 5xx status
- **THEN** the provider throws; the cascade falls through to DDG

### Requirement: Query normalization
The provider SHALL normalize queries for financial search context: bare ticker patterns (`/^[A-Z]{1,5}$/`) → append `" stock news"`. Cashtag patterns (`/^\$[A-Z]{1,5}$/`) → strip `$`, append `" stock news"`. Free-form queries → pass unchanged.

#### Scenario: Bare ticker
- **WHEN** query is `"AAPL"`
- **THEN** the provider searches for `"AAPL stock news"`

#### Scenario: Cashtag
- **WHEN** query is `"$TSLA"`
- **THEN** the provider searches for `"TSLA stock news"`

#### Scenario: Free-form query
- **WHEN** query is `"Fed rate decision impact on banks"`
- **THEN** the provider searches for `"Fed rate decision impact on banks"` unchanged

### Requirement: search_web tool
The system SHALL expose a `search_web` AgentTool in `src/tools/sentiment/web-search.ts` with parameters:
- `query` (required string)
- `category` (optional, `"news"` | `"general"`, default `"news"`)
- `freshness` (optional, `"hours"` | `"day"` | `"week"` | `"month"`, default `"day"`)
- `limit` (optional number, min 1, max 20, default 10)

#### Scenario: Default parameters
- **WHEN** the agent calls `search_web` with `query: "AAPL earnings"`
- **THEN** the tool searches with category `"news"`, freshness `"day"`, limit 10

#### Scenario: General search override
- **WHEN** the agent calls with `query: "what is a SPAC"`, `category: "general"`, `freshness: "month"`
- **THEN** the tool searches general web results from the past month

#### Scenario: Limit clamping
- **WHEN** the agent calls with `limit: 50`
- **THEN** the tool clamps to 20

#### Scenario: Empty query
- **WHEN** the agent calls with `query: ""` or `query: "   "`
- **THEN** the tool returns an error content message without calling the provider

### Requirement: WebSearchResult type
The system SHALL define `WebSearchResult` in `src/types/sentiment.ts`: `{ title: string; url: string; snippet: string; source: string; published: string | null; category: "news" | "general" }`. The `source` field SHALL be the domain extracted from `url` (e.g., `"reuters.com"`, `"cnbc.com"`).

#### Scenario: News result with date
- **WHEN** a news result has a publication date
- **THEN** `published` is an ISO 8601 timestamp, `category` is `"news"`, `source` is the domain

#### Scenario: Web result without date
- **WHEN** a general web result has no discoverable publication date
- **THEN** `published` is `null`

### Requirement: WebSearchEnvelope type
The system SHALL define `WebSearchEnvelope` in `src/types/sentiment.ts`: `{ query: string; results: WebSearchResult[]; resultCount: number; fetchedAt: string; provider: "ddg" | "brave" }`.

#### Scenario: Envelope fields populated
- **WHEN** DDG returns 8 results
- **THEN** the envelope has `query` (the normalized query), `results` (8 items), `resultCount: 8`, `fetchedAt` (ISO 8601), `provider: "ddg"`

### Requirement: Caching and rate limiting
Each provider function SHALL cache results independently with key pattern `web:{provider}:{normalizedQuery}:{category}:{freshness}:{limit}`. TTL: `TTL.WEB_SEARCH` (5 minutes). Stale fallback: `STALE_LIMIT.WEB_SEARCH` (1 hour). Rate limiting: `rateLimiter.acquire("ddg")` before DDG calls, `rateLimiter.acquire("brave_search")` before Brave calls.

#### Scenario: Repeated query within TTL
- **WHEN** the same query with same parameters is requested within 5 minutes
- **THEN** cached data is returned; no HTTP calls are made; the cascade is not entered

#### Scenario: Provider failure with stale cache
- **WHEN** a provider fails but has a stale cached result from 30 minutes ago
- **THEN** the stale data is returned with the stale flag (stale warning surfaced by the tool)

### Requirement: Tool output format
The tool SHALL return `content` as markdown and `details` as the raw `WebSearchEnvelope`. Markdown format: header with query, result count, provider, and freshness window, followed by a bulleted list. Markdown-sensitive characters in titles and snippets (brackets, pipes) SHALL be escaped.

#### Scenario: Results found
- **WHEN** 8 results are returned from Brave
- **THEN** content header: `**Web Search** — 8 results for "AAPL earnings" (news, past day, via brave)`, followed by bulleted list with `• [Title](url) — source\n  snippet\n  Published: date`

#### Scenario: No results
- **WHEN** the provider returns zero results (valid response)
- **THEN** content says `No results found for "AAPL earnings" (news, past day)` and details has `resultCount: 0`

#### Scenario: Stale results
- **WHEN** results are served from stale cache
- **THEN** content has `⚠ Using cached data from {timestamp}` prefix before the results

### Requirement: Brave API key in config
The system SHALL support `BRAVE_API_KEY` as an environment variable and `providers.brave.apiKey` in `~/.opencandle/config.json`, following the existing nested provider config pattern (`providers.alphaVantage.apiKey`, `providers.fred.apiKey`).

#### Scenario: Key from environment
- **WHEN** `BRAVE_API_KEY` is set as an environment variable
- **THEN** `getConfig().braveApiKey` returns the value

#### Scenario: Key from file config
- **WHEN** `~/.opencandle/config.json` contains `{ "providers": { "brave": { "apiKey": "..." } } }`
- **THEN** `getConfig().braveApiKey` returns the value

#### Scenario: Env overrides file
- **WHEN** both env var and file config have different values
- **THEN** env var takes precedence

#### Scenario: No key
- **WHEN** neither env var nor file config contains a Brave key
- **THEN** `getConfig().braveApiKey` is undefined

### Requirement: System prompt tool catalog
The system SHALL add `search_web` to the `TOOL_CATALOG` in `src/prompts/context-builder.ts` with explicit guidance on when to use it and when NOT to use it. Negative guidance SHALL list: real-time prices (get_stock_quote), historical data (get_stock_history), fundamentals (get_financials), macro data (get_economic_data), SEC filings (get_sec_filings), and social sentiment (get_twitter_sentiment, get_reddit_sentiment).

#### Scenario: Agent asked for AAPL stock price
- **WHEN** the agent sees "what's AAPL trading at?"
- **THEN** the system prompt guidance directs it to use `get_stock_quote`, not `search_web`

#### Scenario: Agent asked about earnings surprise
- **WHEN** the agent sees "what happened at AAPL earnings yesterday?"
- **THEN** the system prompt guidance makes `search_web` the appropriate tool (no dedicated earnings-recap tool exists)
