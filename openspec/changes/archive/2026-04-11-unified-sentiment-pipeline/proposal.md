## Why

OpenCandle's sentiment tools have three structural weaknesses: shallow analysis (keyword matching only — misses sarcasm, context, nuance), ephemeral data (every query fetches, scores, and discards — no historical trends, no "vs. last week"), and siloed sources (Twitter, Reddit, and web search can't be compared or aggregated). These compound: the agent can tell you "Reddit is bullish right now" but cannot tell you "Reddit turned bullish on Wednesday while financial news went bearish — divergence like this often precedes volatility."

This change was motivated by studying fieldtheory-cli, a local-first Twitter bookmark indexing system that demonstrates several patterns we lack: SQLite FTS5 indexing for searchable persistence, hybrid classification (fast regex + batched LLM for ambiguous cases), incremental sync with cursor checkpointing, prompt injection sanitization on user-generated content, and rich terminal visualization (sparklines, braille charts). The key insight is that sentiment becomes dramatically more useful when it's **indexed, scoreable by multiple methods, and queryable over time**.

This change depends on `web-search-tool` (completed) for the web adapter's provider infrastructure.

## What Changes

- **Introduce a unified `SentinelRecord` type** — a common shape for content from any source (Twitter, Reddit, web) that carries text, metadata, engagement, and computed sentiment. All sources normalize to this shape before scoring and indexing. Fields that don't apply to every source (e.g. `publishedAt` for web results) are nullable.
- **Add a `SentimentStore`** — a SQLite FTS5-indexed database at `~/.opencandle/sentinel.db` that persists all fetched sentiment records with an **observation-based history model**. Each fetch creates a new observation row keyed by `(source, sourceId, fetchedAt)`, so repeated fetches of the same content at different times build real temporal history rather than overwriting.
- **Implement a keyword-only scorer for v1** — engagement-weighted keyword matching using shared bullish/bearish term lists extracted from the existing Twitter and Reddit providers. LLM-based scoring is deferred to a future change (requires runtime integration that doesn't exist yet).
- **Build three source adapters** — Twitter, Reddit, and Web adapters that wrap existing providers and normalize output to `SentinelRecord[]`. The Reddit adapter adds comment fetching (top 5 comments per post) and cross-subreddit aggregation. Adapters also enrich providers with missing fields (IDs, metadata) needed for the SentinelRecord shape.
- **Create a sentiment pipeline orchestrator** — a single entry point that runs adapters in parallel, scores all records, indexes them in the store, and enriches fresh results with historical context (trend, delta, cross-source divergence).
- **Merge `get_reddit_discussions` into `get_reddit_sentiment`** — the project is unreleased, so there's no deprecation path. `get_reddit_discussions` is removed entirely. `get_reddit_sentiment` gains an optional `query` param for topic filtering and cross-subreddit search, absorbing all of `get_reddit_discussions`'s functionality plus actual sentiment scoring.
- **Add new tools**: `get_web_sentiment` (sentiment from web/news search results), `get_sentiment_trend` (query the store for historical trends — no live fetch), `get_sentiment_summary` (cross-source aggregate with divergence detection).
- **Upgrade existing tools**: `get_reddit_sentiment` gains topic filtering, comment-level analysis, cross-subreddit querying, and historical trend context. `get_twitter_sentiment` gains historical trend context.
- **Add sparkline rendering** for temporal sentiment visualization in tool output (with sample count context to prevent overstating signal).
- **Add sentiment config** — retention days, default subreddits, comment limit per post, divergence threshold. Extends existing `OpenCandleFileConfig`.

## Capabilities

### New Capabilities
- `sentinel-store`: SQLite FTS5-indexed sentiment record store at `~/.opencandle/sentinel.db`. Persists all fetched sentiment data with observation-based history. Supports full-text search, time-range queries, source filtering, ticker lookups. Schema-versioned with migration support.
- `keyword-scorer`: Engagement-weighted keyword sentiment scoring using shared bullish/bearish term lists. Produces score (-1.0 to +1.0), confidence (0.0 to 1.0), method ("keyword"), and extracted tickers.
- `sentiment-pipeline`: Orchestrator that runs source adapters in parallel, scores via keyword scorer, indexes in store, and enriches with historical context (trends, deltas, cross-source divergence).
- `web-sentiment`: Sentiment analysis of web/news search results for a ticker or topic. Uses the `web-search-tool` provider, scores via keyword scorer, indexes in store.
- `sentiment-trend`: Query-only tool that reads historical sentiment from the store. No live API calls. Returns time-series data with sparkline visualization and sample counts.
- `sentiment-summary`: Cross-source aggregate sentiment with divergence detection. Combines Twitter + Reddit + web signals. Flags when retail sentiment diverges from news sentiment. Divergence uses normalized per-record averages (not raw aggregates) to ensure cross-source comparability.
- `reddit-comments`: Fetches top N comments per Reddit post for deeper sentiment signal. Comment text is scored and indexed alongside post titles.

### Modified Capabilities
- `twitter-sentiment` (existing): Gains historical trend enrichment from the store ("current: +0.3, vs 3-day avg: +0.5 — declining"). Scoring unchanged but records are now indexed for future queries.
- `reddit-sentiment` (existing): Absorbs `get_reddit_discussions` entirely. Gains optional `query` param for topic filtering, comment-level analysis (scores post body + top comments, not just titles), cross-subreddit aggregation, and historical trend enrichment.

### Removed Capabilities
- `get_reddit_discussions` (was `newsSentimentTool` in `src/tools/sentiment/news-sentiment.ts`): Removed entirely. Its topic-search and cross-subreddit functionality is absorbed into `get_reddit_sentiment`.

## Impact

- **New files**: `src/sentiment/types.ts`, `src/sentiment/store.ts`, `src/sentiment/scorer.ts`, `src/sentiment/keywords.ts`, `src/sentiment/pipeline.ts`, `src/sentiment/trends.ts`, `src/sentiment/adapters/twitter.ts`, `src/sentiment/adapters/reddit.ts`, `src/sentiment/adapters/web.ts`, `src/sentiment/index.ts`, `src/tools/sentiment/web-sentiment.ts`, `src/tools/sentiment/sentiment-trend.ts`, `src/tools/sentiment/sentiment-summary.ts`
- **Modified files**: `src/tools/sentiment/twitter-sentiment.ts` (add trend enrichment), `src/tools/sentiment/reddit-sentiment.ts` (absorb topic filtering + comment fetching + cross-subreddit + trend enrichment), `src/providers/reddit.ts` (add comment fetching, expose post IDs/authors/bodies), `src/providers/twitter.ts` (expose tweet IDs for SentinelRecord mapping), `src/types/sentiment.ts` (extend RedditSentimentResult for topic queries and comments), `src/tools/index.ts` (register new tools, remove newsSentimentTool), `src/system-prompt.ts` (remove get_reddit_discussions, update sentiment descriptions), `src/prompts/context-builder.ts` (update tool catalog), `src/analysts/orchestrator.ts` (replace get_reddit_discussions references), `src/config.ts` (add sentiment config section), `src/infra/rate-limiter.ts` (add reddit, reddit_comments buckets)
- **Deleted files**: `src/tools/sentiment/news-sentiment.ts`
- **New database**: `~/.opencandle/sentinel.db` (SQLite with FTS5) — separate from existing memory SQLite, with schema versioning
- **No new external dependencies** — uses existing `better-sqlite3` for the store, existing providers for fetching
