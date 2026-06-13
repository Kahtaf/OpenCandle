## ADDED Requirements

### Requirement: Finnhub company news provider
The system SHALL provide a `getCompanyNews(symbol, from, to, apiKey)` function in `src/providers/finnhub.ts` that calls Finnhub's `/api/v1/company-news` endpoint and returns `FinnhubArticle[]`. The function SHALL use `httpGet` from `src/infra/http-client.ts`, `rateLimiter.acquire("finnhub")` before each call, and cache results with key pattern `finnhub:news:{symbol}:{from}:{to}`.

#### Scenario: Successful company news fetch
- **WHEN** called with `symbol: "AAPL"`, valid date range, and valid API key
- **THEN** returns an array of `FinnhubArticle` objects with fields: `headline`, `summary`, `source`, `datetime` (UNIX timestamp), `url`, `related` (ticker string), `id`, `category`, `image`

#### Scenario: No articles found
- **WHEN** Finnhub returns an empty array for the given symbol and date range
- **THEN** returns an empty `FinnhubArticle[]`

#### Scenario: Invalid API key (401)
- **WHEN** Finnhub returns HTTP 401
- **THEN** throws an error with message indicating the API key may be invalid

#### Scenario: Rate limited (429)
- **WHEN** Finnhub returns HTTP 429
- **THEN** throws an error; the calling code handles fallback

#### Scenario: Stale cache fallback
- **WHEN** Finnhub API fails but a cached result exists within `STALE_LIMIT.FINNHUB_NEWS`
- **THEN** the stale cached data is returned

### Requirement: FinnhubArticle type
The system SHALL define `FinnhubArticle` in `src/providers/finnhub.ts`: `{ headline: string; summary: string; source: string; datetime: number; url: string; related: string; id: number; category: string; image: string }`.

#### Scenario: Type fields match Finnhub API response
- **WHEN** Finnhub returns an article object
- **THEN** it maps to `FinnhubArticle` with `datetime` as a UNIX timestamp (seconds), `related` as a ticker string, and all other fields as strings

### Requirement: Relevance post-filter
The provider SHALL filter articles by checking if the queried symbol or company name appears in the `headline` or `summary` (case-insensitive). API testing showed only ~44% of articles for popular tickers (AAPL) actually mention the company. Unrelated articles (ETF comparisons, generic market commentary) tagged to the ticker SHALL be filtered out.

#### Scenario: Relevant article retained
- **WHEN** an AAPL query returns an article with headline "Apple Reports Record Q1 Revenue"
- **THEN** the article passes the relevance filter

#### Scenario: Irrelevant article filtered
- **WHEN** an AAPL query returns an article with headline "VTSAX vs VOO: Which Vanguard Fund Should You Buy?"
- **THEN** the article is filtered out (neither "Apple" nor "AAPL" in headline or summary)

#### Scenario: Ticker mention in summary
- **WHEN** headline doesn't mention AAPL but summary contains "Apple Inc. reported..."
- **THEN** the article passes the relevance filter

### Requirement: Result cap
The provider SHALL cap results at 20 articles after relevance filtering. API testing showed NVDA returns ~250 articles/day. Without a cap, Finnhub records would dominate aggregate sentiment scores.

#### Scenario: High-volume ticker
- **WHEN** Finnhub returns 250 articles for NVDA and 80 pass the relevance filter
- **THEN** only the 20 most recent articles are returned

#### Scenario: Low-volume ticker
- **WHEN** Finnhub returns 10 articles and 6 pass relevance filtering
- **THEN** all 6 are returned (below cap)

### Requirement: Finnhub date range helper
The provider SHALL export a `finnhubDateRange(freshness)` helper that converts `WebSearchOpts["freshness"]` values to `{ from: string; to: string }` in `YYYY-MM-DD` format. Mapping: `"hours"` → today, `"day"` → yesterday to today, `"week"` → 7 days ago to today, `"month"` → 30 days ago to today.

#### Scenario: Day freshness
- **WHEN** called with `freshness: "day"`
- **THEN** returns `from` as yesterday, `to` as today

#### Scenario: Week freshness
- **WHEN** called with `freshness: "week"`
- **THEN** returns `from` as 7 days ago, `to` as today

### Requirement: Finnhub sentiment adapter
The system SHALL provide a `FinnhubAdapter` class in `src/sentiment/adapters/finnhub.ts` implementing the adapter pattern. It SHALL have a `mapToRecords(articles, query)` method that converts `FinnhubArticle[]` to `SentinelRecord[]` with `source: "finnhub"`.

#### Scenario: Article mapped to SentinelRecord
- **WHEN** a `FinnhubArticle` is mapped
- **THEN** the resulting `SentinelRecord` has: `source: "finnhub"`, `sourceId` from article `id` (as string), `title` from `headline`, `text` from `summary`, `author` from `source` (news outlet), `url` from article URL, `publishedAt` from UNIX `datetime` converted to ISO 8601, `engagement` with all zeros (Finnhub doesn't provide engagement metrics), `sentiment.tickers` populated from `related` field (so store queries work), `metadata.category` from article `category`

#### Scenario: Empty articles array
- **WHEN** `mapToRecords` receives an empty array
- **THEN** returns an empty `SentinelRecord[]`

### Requirement: Adapter ticker detection
The `FinnhubAdapter` SHALL extract ticker symbols from the query using the existing `extractEntities()` from `src/routing/entity-extractor.ts` (which includes a stoplist for common false positives). If no ticker is detected, the adapter SHALL return an empty array without making any API calls.

#### Scenario: Ticker query
- **WHEN** query is `"AAPL"` or `"$AAPL"`
- **THEN** the adapter extracts `"AAPL"` and fetches Finnhub company news for it

#### Scenario: Non-ticker query
- **WHEN** query is `"tariff impact on tech sector"` (no ticker)
- **THEN** the adapter returns an empty array without calling Finnhub

#### Scenario: Ticker embedded in phrase
- **WHEN** query is `"is AAPL overvalued"`
- **THEN** the adapter extracts `"AAPL"` from the phrase and fetches news

#### Scenario: Multi-ticker query
- **WHEN** query is `"AAPL vs MSFT"`
- **THEN** the adapter fetches company news for each ticker (up to 3) and merges results, capped at 20 total

### Requirement: Finnhub rate limiting
The system SHALL configure a `"finnhub"` entry in `src/infra/rate-limiter.ts` with 60 requests per minute (matching the free tier).

#### Scenario: Rate limiter configured
- **WHEN** the application starts
- **THEN** `rateLimiter.configure("finnhub", ...)` is called with limits matching 60 req/min

### Requirement: Finnhub API key in config
The system SHALL support `FINNHUB_API_KEY` as an environment variable and `providers.finnhub.apiKey` in `~/.opencandle/config.json`. The key SHALL be exposed as `getConfig().finnhubApiKey`.

#### Scenario: Key from environment
- **WHEN** `FINNHUB_API_KEY` is set
- **THEN** `getConfig().finnhubApiKey` returns the value

#### Scenario: Key from file config
- **WHEN** config file contains `{ "providers": { "finnhub": { "apiKey": "..." } } }`
- **THEN** `getConfig().finnhubApiKey` returns the value

#### Scenario: No key configured
- **WHEN** no Finnhub key is available
- **THEN** `getConfig().finnhubApiKey` is undefined; Finnhub is skipped in the sentiment pipeline

### Requirement: Finnhub caching
Results SHALL be cached with TTL `TTL.FINNHUB_NEWS` (5 minutes) and stale limit `STALE_LIMIT.FINNHUB_NEWS` (1 hour), following the same pattern as other providers.

#### Scenario: Repeated query within TTL
- **WHEN** the same symbol/date-range query is made within 5 minutes
- **THEN** cached data is returned without an API call

#### Scenario: Provider failure with stale cache
- **WHEN** Finnhub API fails but stale cache exists from 30 minutes ago
- **THEN** stale data is returned
