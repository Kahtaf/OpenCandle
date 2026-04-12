## 1. Config & Infra

- [x] 1.1 **RED**: Write tests in `tests/unit/infra/config.test.ts` asserting `getConfig().finnhubApiKey` reads from `FINNHUB_API_KEY` env and `providers.finnhub.apiKey` file config
- [x] 1.2 **GREEN**: Add `finnhubApiKey` to `Config` interface and `OpenCandleFileConfig` in `src/config.ts`, wired from env var and file config
- [x] 1.3 Add `rateLimiter.configure("finnhub", 60, 1)` in `src/infra/rate-limiter.ts` (60 req/min)
- [x] 1.4 Add `TTL.FINNHUB_NEWS` and `STALE_LIMIT.FINNHUB_NEWS` to `src/infra/cache.ts` (5 min TTL, 1 hour stale)

## 2. Finnhub Provider

- [x] 2.1 Add fixture file `tests/fixtures/finnhub/company-news.json` with sample Finnhub API response (include both relevant and irrelevant articles — use real data from API testing)
- [x] 2.2 **RED**: Write failing tests in `tests/unit/providers/finnhub.test.ts`:
  - Successful fetch returns `FinnhubArticle[]`
  - Empty response returns empty array
  - 401 throws descriptive auth error
  - 429 throws rate limit error
  - Stale cache fallback on failure
  - `finnhubDateRange("day")` returns correct `{from, to}`
  - `finnhubDateRange("week")` returns 7-day range
  - Relevance filter keeps articles mentioning ticker/company in headline or summary
  - Relevance filter removes tangential articles (e.g. "VTSAX vs VOO")
  - Result cap at 20 (provide 30 relevant articles in fixture, assert ≤ 20 returned)
  - Cached result returned within TTL (no second fetch)
- [x] 2.3 **GREEN**: Create `src/providers/finnhub.ts` with `FinnhubArticle` type, `finnhubDateRange()` helper, `getCompanyNews()` using `httpGet`, cache, rate limiter, relevance post-filter, and result cap at 20
- [x] 2.4 **REFACTOR**: Review provider for consistency with existing providers (error handling pattern, cache key format, stale fallback)

## 3. Finnhub Sentiment Adapter

- [x] 3.1 **RED**: Write failing tests in `tests/unit/sentiment/finnhub-adapter.test.ts`:
  - `mapToRecords()` maps `FinnhubArticle` → `SentinelRecord` with `source: "finnhub"`
  - `sourceId` is string(article.id)
  - `title` from `headline`, `text` from `summary`, `author` from `source`
  - `publishedAt` is ISO 8601 from UNIX `datetime`
  - `sentiment.tickers` populated from `related` field
  - Empty articles array → empty records
  - Ticker detection: bare ticker `"AAPL"` → fetches
  - Ticker detection: cashtag `"$TSLA"` → fetches
  - Ticker detection: phrase `"is AAPL overvalued"` → extracts AAPL
  - Ticker detection: non-ticker `"tariff impact on tech"` → returns empty, no API call
  - Multi-ticker: `"AAPL vs MSFT"` → fans out to both, merges, caps at 20
  - Multi-ticker cap: 3+ tickers → only first 3 queried
- [x] 3.2 **GREEN**: Add `"finnhub"` to `SENTIMENT_SOURCES` and `SentimentSource` type in `src/sentiment/types.ts`
- [x] 3.3 **GREEN**: Create `src/sentiment/adapters/finnhub.ts` with `FinnhubAdapter` class implementing `mapToRecords()`, ticker detection via `extractEntities()`, multi-ticker fan-out (up to 3), merge and cap at 20
- [x] 3.4 **REFACTOR**: Verify adapter follows same patterns as `WebAdapter` and `RedditAdapter`

## 4. Reorder Web Search Cascade

- [x] 4.1 **RED**: Update cascade order tests in `tests/unit/providers/web-search.test.ts` to assert Exa → Brave → DDG order (DDG last)
- [x] 4.2 **GREEN**: Update `searchWeb()` cascade order in `src/providers/web-search.ts` to: Exa → Brave → DDG
- [x] 4.3 Verify all existing web-search tests pass with new order

## 5. Wire Finnhub into Sentiment Pipeline

- [x] 5.1 **RED**: Write failing tests in `tests/unit/tools/sentiment-summary.test.ts`:
  - Finnhub included in `Promise.allSettled` when `FINNHUB_API_KEY` is set
  - Finnhub omitted (not attempted) when no key configured — no warning
  - Non-ticker query: Finnhub adapter returns empty, no warning emitted
  - Ticker query: Finnhub results appear in output table with `Finnhub` row
  - Divergence grouping: `"finnhub"` classified as institutional alongside `"web"`
  - 4-source divergence: retail (twitter+reddit) vs institutional (web+finnhub)
- [x] 5.2 **GREEN**: Add Finnhub fetch to `Promise.allSettled` in `src/tools/sentiment/sentiment-summary.ts`, guarded by `getConfig().finnhubApiKey`
- [x] 5.3 **GREEN**: Process Finnhub results through `FinnhubAdapter.mapToRecords()` and merge into `allRecords`
- [x] 5.4 **GREEN**: Add `"Finnhub"` row to output table formatting
- [x] 5.5 **GREEN**: Update divergence grouping to classify `"finnhub"` alongside `"web"` as institutional/news
- [x] 5.6 **RED/GREEN**: Update `get_sentiment_trend` tool's `source` parameter in `src/tools/sentiment/sentiment-trend.ts` to include `"finnhub"` option (test: pass `source: "finnhub"` without error)
- [x] 5.7 **REFACTOR**: Ensure all tests pass, no regressions in existing sentiment tools

## 6. Unit Test Suite

- [x] 6.1 Run full test suite (`npm test`) — all existing + new tests pass
- [x] 6.2 Verify no regressions in existing web-search, sentiment-summary, sentiment-trend tests

## 7. Harness Integration Tests (live agent, 10+ prompts)

Run each prompt through the agent harness (`npx tsx tests/harness/cli.ts run`) and verify correct tool routing, Finnhub integration, and no regressions. Pre-script answers where needed.

### New Finnhub / sentiment flows

- [x] 7.1 `"What's the sentiment on AAPL?"` → agent calls `get_sentiment_summary`; output includes Finnhub row when key is configured; verify 4 source rows in table
- [x] 7.2 `"Get me the latest news sentiment for TSLA"` → agent calls `get_web_sentiment` or `get_sentiment_summary`; verify Finnhub data appears for ticker query
- [x] 7.3 `"Compare sentiment: AAPL vs MSFT"` → agent uses sentiment tools for both tickers; verify Finnhub fetches for both symbols
- [x] 7.4 `"What's the news sentiment on AI regulation?"` → non-ticker query; Finnhub should NOT fire (no Finnhub row in output), web search handles it via Exa/Brave/DDG

### Existing sentiment flows (regression)

- [x] 7.5 `"What does Reddit think about NVDA?"` → agent calls `get_reddit_sentiment`; returns Reddit-specific results; not broken by Finnhub changes
- [x] 7.6 `"Show me the sentiment trend for AAPL over the past week"` → agent calls `get_sentiment_trend`; historical data renders correctly

### Web search flows (cascade regression)

- [x] 7.7 `"Search for latest tariff news"` → agent calls `search_web`; cascade works (Exa → Brave → DDG); returns results
- [x] 7.8 `"What happened at NVDA earnings yesterday?"` → agent calls `search_web` with news category; web search returns relevant results

### Non-sentiment flows (regression — must not break)

- [x] 7.9 `"What's AAPL trading at?"` → agent calls `get_stock_quote`; returns price data; no interference from Finnhub
- [x] 7.10 `"Run a DCF on MSFT"` → agent calls `compute_dcf`; fundamentals flow unaffected
- [x] 7.11 `"Show me the Fear and Greed index"` → agent calls `get_fear_greed`; macro tools unaffected
- [x] 7.12 `"Analyze GOOGL"` → agent runs `single_asset_analysis` workflow; full analysis pipeline works end-to-end including any sentiment tools it invokes
