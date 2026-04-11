## Why

OpenCandle's sentiment tools have three structural weaknesses: shallow analysis (keyword matching only — misses sarcasm, context, nuance), ephemeral data (every query fetches, scores, and discards — no historical trends, no "vs. last week"), and siloed sources (Twitter, Reddit, and web search can't be compared or aggregated). These compound: the agent can tell you "Reddit is bullish right now" but cannot tell you "Reddit turned bullish on Wednesday while financial news went bearish — divergence like this often precedes volatility."

This change was motivated by studying fieldtheory-cli, a local-first Twitter bookmark indexing system that demonstrates several patterns we lack: SQLite FTS5 indexing for searchable persistence, hybrid classification (fast regex + batched LLM for ambiguous cases), incremental sync with cursor checkpointing, prompt injection sanitization on user-generated content, and rich terminal visualization (sparklines, braille charts). The key insight is that sentiment becomes dramatically more useful when it's **indexed, scoreable by multiple methods, and queryable over time**.

This change depends on `web-search-tool` (separate proposal) being completed first, as the web adapter consumes that tool's provider infrastructure.

## What Changes

- **Introduce a unified `SentinelRecord` type** — a common shape for content from any source (Twitter, Reddit, web) that carries text, metadata, engagement, and computed sentiment. All sources normalize to this shape before scoring and indexing.
- **Add a `SentimentStore`** — a SQLite FTS5-indexed database at `~/.opencandle/sentinel.db` that persists all fetched sentiment records. Supports full-text search, time-range queries, source filtering, and ticker-based lookups across all sources.
- **Implement a hybrid scorer** — Tier 1: existing keyword matching (instant, always runs). Tier 2: batched LLM classification for records where keyword confidence is low. The LLM tier is optional and gracefully degrades — the tool always returns results even without LLM refinement.
- **Build three source adapters** — Twitter, Reddit, and Web adapters that wrap existing providers and normalize output to `SentinelRecord[]`. The Reddit adapter adds comment fetching (top 5 comments per post) and cross-subreddit aggregation.
- **Create a sentiment pipeline orchestrator** — a single entry point that runs adapters in parallel, scores all records, indexes them in the store, and enriches fresh results with historical context (trend, delta, cross-source divergence).
- **Add new tools**: `get_web_sentiment` (sentiment from web/news search results), `get_sentiment_trend` (query the store for historical trends — no live fetch), `get_sentiment_summary` (cross-source aggregate with divergence detection).
- **Upgrade existing tools**: `get_reddit_sentiment` gains comment-level analysis and cross-subreddit querying. `get_twitter_sentiment` gains historical trend context.
- **Add sparkline rendering** for temporal sentiment visualization in tool output.
- **Add prompt injection sanitization** on user-generated content (tweets, Reddit posts) before LLM classification, following fieldtheory-cli's pattern.

## Capabilities

### New Capabilities
- `sentinel-store`: SQLite FTS5-indexed sentiment record store at `~/.opencandle/sentinel.db`. Persists all fetched sentiment data. Supports full-text search, time-range queries, source filtering, ticker lookups. Deduplicates by `(source, sourceId)`.
- `hybrid-scorer`: Two-tier sentiment scoring — keyword fast-path (instant) + optional LLM batch classification (for ambiguous records). Produces score (-1.0 to +1.0), confidence (0.0 to 1.0), method ("keyword" | "llm"), and extracted tickers.
- `sentiment-pipeline`: Orchestrator that runs source adapters in parallel, scores via hybrid scorer, indexes in store, and enriches with historical context (trends, deltas, cross-source divergence).
- `web-sentiment`: Sentiment analysis of web/news search results for a ticker or topic. Uses the `web-search-tool` provider, scores via hybrid scorer, indexes in store.
- `sentiment-trend`: Query-only tool that reads historical sentiment from the store. No live API calls. Returns time-series data with sparkline visualization.
- `sentiment-summary`: Cross-source aggregate sentiment with divergence detection. Combines Twitter + Reddit + web signals. Flags when retail sentiment diverges from news sentiment.
- `reddit-comments`: Fetches top N comments per Reddit post for deeper sentiment signal. Comment text is scored and indexed alongside post titles.

### Modified Capabilities
- `twitter-sentiment` (existing spec in `openspec/specs/twitter-sentiment/`): Gains historical trend enrichment from the store ("current: +0.3, vs 3-day avg: +0.5 — declining"). Scoring unchanged but records are now indexed for future queries.
- `reddit-sentiment`: Gains comment-level analysis (scores post body + top comments, not just titles), cross-subreddit aggregation, and historical trend enrichment.

## Impact

- **New files**: `src/sentiment/types.ts`, `src/sentiment/store.ts`, `src/sentiment/scorer.ts`, `src/sentiment/pipeline.ts`, `src/sentiment/trends.ts`, `src/sentiment/adapters/twitter.ts`, `src/sentiment/adapters/reddit.ts`, `src/sentiment/adapters/web.ts`, `src/tools/sentiment/web-sentiment.ts`, `src/tools/sentiment/sentiment-trend.ts`, `src/tools/sentiment/sentiment-summary.ts`
- **Modified files**: `src/tools/sentiment/twitter-sentiment.ts` (add trend enrichment), `src/tools/sentiment/reddit-sentiment.ts` (add comment fetching, cross-subreddit, trend enrichment), `src/providers/reddit.ts` (add comment fetching function), `src/tools/index.ts` (register new tools), `src/system-prompt.ts` (update sentiment tool descriptions), `src/infra/rate-limiter.ts` (add reddit_comments bucket)
- **New database**: `~/.opencandle/sentinel.db` (SQLite with FTS5) — separate from existing memory SQLite
- **Depends on**: `web-search-tool` change (for web adapter's search provider)
- **No new external dependencies** — uses existing `better-sqlite3` for the store, existing providers for fetching, existing LLM access for scoring
