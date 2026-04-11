**Testing discipline**: TDD is mandatory per project conventions. Every implementation task follows red-green-refactor: (1) write the failing test first, (2) implement the minimal code to make it pass, (3) refactor with tests green. Test tasks are listed before their corresponding implementation tasks to enforce this ordering. Never write implementation before a failing test.

**Mocking convention**: Per `tests/AGENTS.md:56`, unit tests mock `globalThis.fetch`, not provider internals. Adapter tests mock fetch with fixture JSON. Pipeline tests mock fetch to control all upstream providers. Only `:memory:` SQLite for store tests.

## 0. Remove get_reddit_discussions

This runs first because it removes dead code before building on top of what remains. No test needed — it's a deletion.

- [x] 0.1 Delete `src/tools/sentiment/news-sentiment.ts`
- [x] 0.2 Remove `newsSentimentTool` import and registration from `src/tools/index.ts` (line 13, line 44)
- [x] 0.3 Remove `get_reddit_discussions` from `src/system-prompt.ts` (line 20)
- [x] 0.4 Remove `get_reddit_discussions` from `src/prompts/context-builder.ts` (line 117)
- [x] 0.5 Replace `get_reddit_discussions` reference in `src/analysts/orchestrator.ts` (line 55) — rewrite contrarian analyst step 3 to use `get_reddit_sentiment` with topic query
- [x] 0.6 Update `tests/e2e/audit-fixes.test.ts` (line 111) — remove `get_reddit_discussions` from the tool check; only check for `get_reddit_sentiment`
- [x] 0.7 Run `npm test` — all existing tests must pass with the tool removed

## 1. SentinelRecord Type and Sentiment Module Scaffold

- [x] 1.1 **RED**: Write failing tests for type guards in `tests/unit/sentiment/types.test.ts` — validate SentinelRecord shape, engagement normalization, sentiment score bounds (-1..+1), confidence bounds (0..1), source enum values, publishedAt nullable
- [x] 1.2 **GREEN**: Create `src/sentiment/` directory with barrel export (`index.ts`). Define `SentinelRecord`, `SentimentAdapter`, `ScorerOptions`, `TrendResult`, `SentimentSummary` types in `src/sentiment/types.ts`. Run tests — should pass.

## 2. Sentiment Config

- [x] 2.1 **RED**: Write failing test in `tests/unit/infra/config.test.ts` — extend existing config tests. Test: `sentiment.retentionDays` defaults to 30, `sentiment.defaultSubreddits` defaults to 4 subreddits, `sentiment.commentsPerPost` defaults to 5, `sentiment.divergenceThreshold` defaults to 0.4. Test file-config and env override.
- [x] 2.2 **GREEN**: Extend `OpenCandleFileConfig` and `Config` in `src/config.ts` with `sentiment` section. Implement defaults in `resolveConfig()`. Run tests — should pass.

## 3. Sentiment Store (SQLite FTS5)

- [x] 3.1 **RED**: Write failing test in `tests/unit/sentiment/store.test.ts` — verify FTS5 is available in `better-sqlite3` by creating a FTS5 virtual table on `:memory:` database. This test must pass before any store implementation.
- [x] 3.2 **RED**: Write failing tests for `SentimentStore` in `tests/unit/sentiment/store.test.ts` using `:memory:` SQLite. Test cases:
  - `insert` adds new records; FTS5 returns them via search
  - `insert` with same `(source, sourceId, fetchedAt)` is a no-op (idempotent)
  - `insert` with same `(source, sourceId)` but different `fetchedAt` creates two rows (observation model)
  - `search(query)` returns BM25-ranked results
  - `search(query, { source: "reddit" })` filters by source
  - `search(query, { since, until })` filters by time range
  - `getByTicker("AAPL")` returns records where tickers JSON contains "AAPL" (test with `AAPL`, `RY.TO`, `BTC-USD`)
  - `getTimeSeries(query, { days: 7, bucketHours: 24 })` returns per-source bucketed averages
  - `prune(30)` deletes records older than 30 days, retains newer ones
  - Empty store returns empty results (no errors)
  - `schema_version` table exists and is set to 1
- [x] 3.3 **GREEN**: Implement `SentimentStore` class in `src/sentiment/store.ts` — schema creation (sentinel_records table + schema_version table + FTS5 virtual table + indexes), insert, search, getByTicker, getTimeSeries, prune. WAL mode enabled. Prepared statements cached. Bulk insert uses a transaction. Run tests — should pass.
- [x] 3.4 **REFACTOR**: Review store implementation — ensure WAL mode, prepared statements, and transaction usage are correct.

## 4. Keyword Scorer

- [x] 4.1 **RED**: Write failing tests for shared keyword lists in `tests/unit/sentiment/keywords.test.ts` — verify bullish/bearish term arrays exist, are non-empty, no duplicates, contain all terms currently in twitter.ts and reddit.ts
- [x] 4.2 **GREEN**: Extract shared bullish/bearish keyword lists from `src/providers/twitter.ts` and `src/providers/reddit.ts` into `src/sentiment/keywords.ts`. Update both providers to import from the shared module. Run existing twitter and reddit provider tests — must still pass. Run new keyword tests — should pass.
- [x] 4.3 **RED**: Write failing tests for `keywordScore` in `tests/unit/sentiment/scorer.test.ts`. Mock `globalThis.fetch` where needed. Test cases:
  - "AAPL is going to moon" → positive score
  - "crash incoming, sell everything" → negative score
  - "AAPL reported earnings" (no keywords) → score 0.0, confidence 0.0
  - engagement weighting: high-engagement bearish record outweighs low-engagement bullish records
  - confidence higher for longer text with multiple keywords
  - confidence lower for short tweets (source: "twitter" penalty)
- [x] 4.4 **GREEN**: Implement `keywordScore(record)` in `src/sentiment/scorer.ts`. Run tests — should pass.
- [x] 4.5 **RED**: Write failing tests for `scoreRecords` in `tests/unit/sentiment/scorer.test.ts`. Test cases:
  - batch of records → all scored with method "keyword"
  - results include extracted tickers from text
  - empty input → empty output
- [x] 4.6 **GREEN**: Implement `scoreRecords(records)`. Run tests — should pass.

## 5. Provider Extensions

### 5a. Reddit Provider — expose IDs, authors, bodies, comments
- [x] 5a.1 Add test fixture in `tests/fixtures/reddit/listing-with-ids.json` — Reddit listing response including `id`, `selftext`, `author` fields
- [x] 5a.2 Add test fixture in `tests/fixtures/reddit/comments.json` — Reddit comment thread JSON response
- [x] 5a.3 **RED**: Write failing tests in `tests/unit/providers/reddit.test.ts` — mock `globalThis.fetch` with listing fixture. Test: `getSubredditPosts` result now includes `id`, `author`, `selftext` per post
- [x] 5a.4 **GREEN**: Extend `RedditListingResponse` interface and `getSubredditPosts` in `src/providers/reddit.ts` to extract and return `id`, `author`, `selftext`. Extend `RedditSentimentResult` post type in `src/types/sentiment.ts`. Run tests — existing and new should pass.
- [x] 5a.5 **RED**: Write failing tests for `getPostComments` in `tests/unit/providers/reddit.test.ts` — mock `globalThis.fetch` with comment fixture. Test: extracts top N comments by score, caches with 30-min TTL, rate-limits via `reddit_comments` bucket
- [x] 5a.6 **GREEN**: Implement `getPostComments(subreddit, postId, limit)` in `src/providers/reddit.ts`. Add `reddit` and `reddit_comments` rate limiter buckets in `src/infra/rate-limiter.ts`. Run tests — should pass.

### 5b. Twitter Provider — expose tweet IDs
- [x] 5b.1 **RED**: Write failing test in `tests/unit/providers/twitter.test.ts` — verify that tweets include an `id` field (currently missing from `TwitterTweet` in `src/types/sentiment.ts:10-19`)
- [x] 5b.2 **GREEN**: Extend `TwitterTweet` in `src/types/sentiment.ts` with `id: string`. Update `src/providers/twitter.ts:127-136` to extract `tweet.id` (the scraper exposes it). Run tests — should pass.

## 6. Source Adapters

### 6a. Twitter Adapter
- [x] 6a.1 **RED**: Write failing tests for `TwitterAdapter` in `tests/unit/sentiment/adapters/twitter.test.ts` — mock `globalThis.fetch` with tweet fixture. Test: maps TwitterTweet fields to SentinelRecord (source "twitter", sourceId from tweet.id, engagement from likes/retweets/replies/views, publishedAt from created)
- [x] 6a.2 **GREEN**: Implement `TwitterAdapter` in `src/sentiment/adapters/twitter.ts`. Run tests — should pass.

### 6b. Reddit Adapter
- [x] 6b.1 **RED**: Write failing tests for `RedditAdapter` in `tests/unit/sentiment/adapters/reddit.test.ts` — mock `globalThis.fetch` with listing + comment fixtures. Test cases:
  - maps posts to SentinelRecords with source "reddit", sourceId from post.id
  - fetches top 5 comments per high-engagement post, maps each to separate SentinelRecord with `metadata.isComment: true`, `metadata.parentId`
  - cross-subreddit: no subreddit specified → fetches from default list (from config), deduplicates by post ID
  - topic filtering: `query` param filters posts by title/selftext relevance
  - post with 0 comments → no comment fetch attempted
- [x] 6b.2 **GREEN**: Implement `RedditAdapter` in `src/sentiment/adapters/reddit.ts`. Run tests — should pass.

### 6c. Web Adapter
- [x] 6c.1 **RED**: Write failing tests for `WebAdapter` in `tests/unit/sentiment/adapters/web.test.ts` — mock `globalThis.fetch` with web search fixtures. Test: maps WebSearchResult to SentinelRecord (source "web", sourceId from URL hash, text from snippet, author from domain, publishedAt nullable, engagement zeroed)
- [x] 6c.2 **GREEN**: Implement `WebAdapter` in `src/sentiment/adapters/web.ts`. Run tests — should pass.

## 7. Trend Computation and Sparklines

- [x] 7.1 **RED**: Write failing tests for `renderSparkline` in `tests/unit/sentiment/trends.test.ts`. Test cases:
  - `[0.1, 0.3, 0.5, 0.9, 0.7, 0.3, 0.1]` → ascending then descending block pattern
  - `[-1, -0.5, 0, 0.5, 1]` → full range from lowest to highest block
  - empty array → empty string
  - single value → single block character
  - all same values → all same block character
- [x] 7.2 **GREEN**: Implement `renderSparkline(values)` in `src/sentiment/trends.ts`. Run tests — should pass.
- [x] 7.3 **RED**: Write failing tests for `computeTrend` and `computeDivergence` in `tests/unit/sentiment/trends.test.ts`. Test cases:
  - rising values → direction "rising", positive delta
  - falling values → direction "falling", negative delta
  - flat values → direction "stable", near-zero delta
  - trend output includes sample count
  - divergence: Twitter +0.5, Reddit +0.4, Web -0.2 → flagged (retail avg +0.45 vs news -0.2 > threshold)
  - no divergence: all sources within threshold → not flagged
  - insufficient data (< 5 records per group) → divergence skipped with note
  - divergence threshold read from config
- [x] 7.4 **GREEN**: Implement `computeTrend(timeSeries)` and `computeDivergence(sources, threshold)`. Run tests — should pass.

**Note on AGENTS.md:76**: `computeTrend` and `computeDivergence` are data transforms (math on numbers), not analytical synthesis. They compute averages, deltas, and threshold comparisons — the agent/LLM interprets what the numbers mean. This is analogous to how `scoreSentiment` in the current reddit provider computes a score but doesn't draw conclusions.

## 8. Sentiment Pipeline Orchestrator

- [x] 8.1 **RED**: Write failing tests for `SentimentPipeline` in `tests/unit/sentiment/pipeline.test.ts` — mock `globalThis.fetch` to control adapter behavior via fixtures. Test cases:
  - runs requested adapters in parallel (Promise.allSettled)
  - scores all records via keyword scorer
  - inserts scored records into store (`:memory:`)
  - queries store for historical time-series after indexing
  - computes trends and divergence from time-series
  - one adapter fails → other results still returned, warning surfaced
  - all adapters fail → empty fresh results, historical trend still returned if store has data
  - returns `{ fresh, trend, divergence, warnings }` structure
  - first query (empty store before this fetch) → trend is null (requires ≥2 time buckets of prior data)
- [x] 8.2 **GREEN**: Implement `SentimentPipeline` class in `src/sentiment/pipeline.ts`. Run tests — should pass.
- [x] 8.3 **RED**: Write failing test for pipeline factory in `tests/unit/sentiment/pipeline.test.ts` — verify lazy initialization creates store and adapters on first use
- [x] 8.4 **GREEN**: Implement pipeline singleton/factory in `src/sentiment/index.ts`. Run tests — should pass.

## 9. New Tools

### 9a. get_web_sentiment
- [x] 9a.1 **RED**: Write failing tests for `get_web_sentiment` tool in `tests/unit/tools/web-sentiment.test.ts` — mock `globalThis.fetch` with web search fixtures. Test: params validation, output format with scored results and trend sparkline with sample counts, unavailable handling
- [x] 9a.2 **GREEN**: Implement tool in `src/tools/sentiment/web-sentiment.ts`. Run tests — should pass.

### 9b. get_sentiment_trend
- [x] 9b.1 **RED**: Write failing tests for `get_sentiment_trend` tool in `tests/unit/tools/sentiment-trend.test.ts` — use `:memory:` store seeded with test data. Test: populated store returns per-source sparklines with sample counts, empty store returns "no historical data" message, source filtering works
- [x] 9b.2 **GREEN**: Implement tool in `src/tools/sentiment/sentiment-trend.ts`. Run tests — should pass.

### 9c. get_sentiment_summary
- [x] 9c.1 **RED**: Write failing tests for `get_sentiment_summary` tool in `tests/unit/tools/sentiment-summary.test.ts` — mock `globalThis.fetch` with fixtures for all sources. Test: cross-source aggregation, normalized divergence flagging, missing sources handled, output format includes per-record averages
- [x] 9c.2 **GREEN**: Implement tool in `src/tools/sentiment/sentiment-summary.ts`. Run tests — should pass.

## 10. Upgrade Existing Tools

- [x] 10.1 **RED**: Write failing tests for upgraded `get_twitter_sentiment` in `tests/unit/tools/twitter-sentiment.test.ts` — extend existing test file. Test: backward compatibility (same params still work, same output format), new trend context appended when store has history, no trend context when store is empty
- [x] 10.2 **GREEN**: Update `get_twitter_sentiment` in `src/tools/sentiment/twitter-sentiment.ts` — pipe through pipeline (score, index), append trend context. Run tests — existing and new should all pass.
- [x] 10.3 **RED**: Write failing tests for upgraded `get_reddit_sentiment` in `tests/unit/tools/reddit-sentiment.test.ts` — extend existing test file. Test: backward compatibility (subreddit-only still works), new `query` param for topic filtering, new `subreddits` param for cross-subreddit, comment data included in results, trend context appended
- [x] 10.4 **GREEN**: Update `get_reddit_sentiment` in `src/tools/sentiment/reddit-sentiment.ts` — use RedditAdapter, add `query` and `subreddits` params, include comment data, append trend context. Update `RedditSentimentResult` in `src/types/sentiment.ts` if needed to represent cross-subreddit + comment data. Run tests — should pass.

## 11. System Prompt and Tool Registration

- [x] 11.1 Register new tools in `src/tools/index.ts` — add `get_web_sentiment`, `get_sentiment_trend`, `get_sentiment_summary`
- [x] 11.2 **RED**: Write failing test in `tests/unit/prompts/context-builder.test.ts` — verify new tools appear in prompt catalog output, verify `get_reddit_discussions` does NOT appear, verify `get_reddit_sentiment` description mentions topic filtering and cross-subreddit
- [x] 11.3 **GREEN**: Update sentiment section in `TOOL_CATALOG` in `src/prompts/context-builder.ts`. Update `src/system-prompt.ts` sentiment tool listing. Run tests — should pass.

## 12. Full Test Suite and E2E

- [x] 12.1 Run full unit test suite (`npm test`) — verify no regressions, all new tests green
- [x] 12.2 Add e2e provider tests in `tests/e2e/providers.test.ts`:
  - `getPostComments` against live Reddit for a popular post — assert returns comment array with text, author, and upvote fields. Graceful skip on 403/429.
  - `SentimentStore` integration: create store on disk in temp dir, insert records, search, verify FTS5 ranking, clean up.
- [x] 12.3 Add e2e tool tests in `tests/e2e/tools.test.ts`:
  - `get_reddit_sentiment` with `query: "NVDA"` (cross-subreddit mode) — assert returns sentiment score in [-1, 1], multiple subreddits represented. Graceful skip on rate limit.
  - `get_sentiment_trend` with seeded store data (insert test records into temp store, then query) — assert returns sparkline and direction.
- [x] 12.4 **Agent harness e2e — single-source sentiment**: Run agent via harness with prompt: `"What is the current sentiment on NVDA across Reddit?"`. Assert from trace:
  - `toolSequence` includes `get_reddit_sentiment`
  - tool result contains sentiment score and subreddit data
  - `finalText` discusses bullish/bearish signals
  ```bash
  npx tsx tests/harness/cli.ts run --prompt "What is the current sentiment on NVDA across Reddit?" --ipc /tmp/oc-sentiment-1
  npx tsx tests/harness/cli.ts wait --ipc /tmp/oc-sentiment-1
  npx tsx tests/harness/cli.ts trace --ipc /tmp/oc-sentiment-1
  ```
- [x] 12.5 **Agent harness e2e — cross-source summary**: Run agent via harness with prompt: `"Give me a full sentiment summary on AAPL from all available sources"`. Assert from trace:
  - `toolSequence` includes `get_sentiment_summary`
  - tool call args have `query` containing "AAPL"
  - tool result is not an error
  - `finalText` mentions multiple sources (Twitter/Reddit/web) and provides aggregate analysis
  ```bash
  npx tsx tests/harness/cli.ts run --prompt "Give me a full sentiment summary on AAPL from all available sources" --ipc /tmp/oc-sentiment-2
  npx tsx tests/harness/cli.ts wait --ipc /tmp/oc-sentiment-2
  npx tsx tests/harness/cli.ts trace --ipc /tmp/oc-sentiment-2
  ```
- [x] 12.6 **Agent harness e2e — trend query**: Run agent with prompt: `"How has TSLA sentiment changed over the past week?"`. Assert from trace:
  - `toolSequence` includes either `get_sentiment_trend` or a sentiment tool followed by trend
  - If store is empty, output explains no historical data exists and suggests running a sentiment query first
  - If store has data, output includes sparkline characters (`▁▂▃▄▅▆▇█`) and sample counts
  ```bash
  npx tsx tests/harness/cli.ts run --prompt "How has TSLA sentiment changed over the past week?" --ipc /tmp/oc-sentiment-3
  npx tsx tests/harness/cli.ts wait --ipc /tmp/oc-sentiment-3
  npx tsx tests/harness/cli.ts trace --ipc /tmp/oc-sentiment-3
  ```
  Note: The original design had a two-step test seeding history then querying. This is not feasible because the harness creates a fresh temp `OPENCANDLE_HOME` per run (`tests/harness/cli.ts:67-68, 130-133`). Single-run test with explicit empty-store handling is realistic.
- [x] 12.7 **Agent harness e2e — tool routing**: Run agent with: `"What is AAPL trading at?"`. Assert from trace:
  - `toolSequence` includes `get_stock_quote` (NOT sentiment tools)
  - Agent uses dedicated price tool for price queries
  ```bash
  npx tsx tests/harness/cli.ts run --prompt "What is AAPL trading at?" --ipc /tmp/oc-sentiment-4
  npx tsx tests/harness/cli.ts wait --ipc /tmp/oc-sentiment-4
  npx tsx tests/harness/cli.ts trace --ipc /tmp/oc-sentiment-4
  ```
  Note: This tests routing, not sentiment. It's a regression guard — sentiment changes should not cause price queries to route to sentiment tools. Harness e2e tests assert on LLM-driven tool selection, so they verify behavior, not deterministic routing.
