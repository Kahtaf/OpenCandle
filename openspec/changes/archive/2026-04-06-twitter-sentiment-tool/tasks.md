## 1. Types

- [x] 1.1 Add `TwitterSentimentResult` and `TwitterTweet` types to `src/types/sentiment.ts`

## 2. Provider

- [x] 2.1 Create `src/providers/twitter.ts` — `readTwitterCookies(profileDir)` to extract auth cookies from `cookies.sqlite` via `better-sqlite3`, querying both `x.com` and `twitter.com` domains
- [x] 2.2 Add `getTwitterSentiment(query, limit, hours)` — creates `Scraper`, sets cookies, normalizes query (bare ticker → cashtag), calls `searchTweets()`, filters by time window. Returns `TwitterSentimentResult` on success, throws on failure (no cookies, login expired, scraper error). Caching and stale fallback handled internally (same pattern as other providers)
- [x] 2.3 Implement engagement-weighted sentiment scoring (reuse bullish/bearish terms from Reddit provider)
- [x] 2.4 Wire caching (`TTL.SENTIMENT`, stale fallback via `cache.getStale`) and rate limiting

## 3. Tool

- [x] 3.1 Create `src/tools/sentiment/twitter-sentiment.ts` with `createTool` — params: query, limit, hours. Uses `wrapProvider("twitter", () => getTwitterSentiment(...))` for structured error handling
- [x] 3.2 Format human-readable markdown output (tweet table, sentiment gauge, top co-mentions)
- [x] 3.3 Register tool in `src/tools/index.ts` via `getAllTools()`

## 4. Pi Command

- [x] 4.1 Register `/twitter-login` command in `src/pi/opencandle-extension.ts` — launches Camoufox headful with stealth options, navigates to `x.com/login`, polls for auth cookies, reports success/failure. Guards non-interactive contexts via `ctx.hasUI`

## 5. Tests

- [x] 5.1 Create fixture JSON in `tests/fixtures/twitter/` representing scraper Tweet response shape
- [x] 5.2 Write provider unit tests — cookie extraction, query normalization, sentiment scoring, caching, throws on missing session/expired auth (mock `Scraper` and `better-sqlite3`)
- [x] 5.3 Write tool unit tests — parameter validation, output formatting, wrapProvider integration, unavailable messaging
- [x] 5.4 Write `/twitter-login` command tests in `tests/unit/pi/opencandle-extension.test.ts` — command registration, non-interactive guard (`ctx.hasUI === false`)

## 6. Validation

- [x] 6.1 Run full test suite (`npm test`) and fix any breakage
- [x] 6.2 Test `get_twitter_sentiment` + `trigger_twitter_login` end-to-end via IPC harness
