## Context

OpenCandle has three sentiment tools today: `get_twitter_sentiment` (keyword-scored tweets via scraper), `get_reddit_sentiment` (keyword-scored hot posts from a single subreddit), and `get_reddit_discussions` (unscored cross-subreddit topic search via `src/tools/sentiment/news-sentiment.ts`). All three share the same weakness: keyword matching that misses sarcasm and context, no persistence (every query is ephemeral), and no cross-source analysis.

The existing providers also have structural gaps that this change must address:
- **Twitter provider** (`src/providers/twitter.ts:127-135`): Does not expose tweet IDs or conversation IDs. The adapter needs stable `sourceId` for deduplication.
- **Reddit provider** (`src/providers/reddit.ts:33-39`): Does not expose post IDs, authors, or self-text bodies. Only returns title, score, num_comments, permalink, created_utc.
- **Web search provider** (`src/providers/web-search.ts`): `published` is nullable (`src/types/sentiment.ts:39`). The SentinelRecord must handle this.

Research into fieldtheory-cli revealed patterns that directly address these gaps:
- **SQLite FTS5 indexing**: Persist all content locally with full-text search. Enables historical queries without re-fetching.
- **Hybrid classification**: Fast regex for obvious signals, batched LLM for ambiguous content. fieldtheory batches 50 bookmarks per LLM prompt with prompt injection sanitization.
- **Observation-based history**: Each fetch is a separate observation, not an upsert-replace. This is critical for temporal trend analysis.
- **Sparkline visualization**: Unicode sparklines (`▁▂▃▄▅▆▇█`) for time-series in terminal output.

## Goals / Non-Goals

**Goals:**

- Unify all sentiment sources (Twitter, Reddit, web) behind a common record type and scoring pipeline
- Persist sentiment data in a local SQLite FTS5 store for historical queries and trend analysis
- Improve scoring quality with engagement-weighted keywords and shared term lists (LLM tier deferred to future change)
- Add Reddit comment fetching for deeper signal (not just post titles)
- Merge `get_reddit_discussions` into `get_reddit_sentiment` (project is unreleased — no deprecation, just remove)
- Enable cross-source sentiment comparison and divergence detection
- Add sparkline visualization with sample counts for temporal trends
- Make the pipeline extensible for future sources (Discord, RSS, etc.) by adding an adapter
- Extend config for sentiment-specific settings

**Non-Goals:**

- LLM-based sentiment scoring in v1 (requires runtime integration for LLM access in tools that doesn't exist — deferred)
- Real-time streaming / push-based sentiment monitoring (pull-based on each query is sufficient)
- Embedding-based semantic search (FTS5 BM25 is sufficient for our query patterns)
- Replacing the agent's own analytical reasoning with automated sentiment conclusions
- Sentiment scoring for non-English content
- Building a general-purpose NLP pipeline (this is financial sentiment specific)
- Prompt injection sanitization (deferred to the LLM scorer change)

## Decisions

### D1: SentinelRecord as the universal shape

**Decision**: Define a `SentinelRecord` type that all sources normalize to before scoring and indexing:

```
SentinelRecord {
  id: string                     // UUID
  source: "twitter" | "reddit" | "web"
  sourceId: string               // tweet ID, Reddit post/comment ID, URL hash
  query: string                  // what search triggered this fetch
  title: string | null           // Reddit title, article headline, null for tweets
  text: string                   // the actual content to score
  author: string | null          // @handle, u/username, domain
  url: string                    // permalink to source
  publishedAt: string | null     // ISO 8601, null when source doesn't provide it
  fetchedAt: string              // ISO 8601
  engagement: {
    score: number                // likes / upvotes
    replies: number | null       // comment count / reply count
    shares: number | null        // retweets / crossposts
    views: number | null
  }
  sentiment: {
    score: number                // -1.0 to +1.0
    confidence: number           // 0.0 to 1.0
    method: "keyword"            // v1 is keyword-only; future: "llm"
    tickers: string[]
  }
  metadata: Record<string, unknown>  // source-specific extras (subreddit, isComment, parentId, conversationId)
}
```

**Rationale**: A common shape enables the store, scorer, and trend computation to be source-agnostic. `publishedAt` is nullable because web search results often lack dates (`src/types/sentiment.ts:39`). The `metadata` field handles source-specific data without polluting the core shape.

**Known limitation**: `metadata: Record<string, unknown>` is a type escape hatch. The typed fields on the record cover the common contract; metadata is for optional source-specific context that consumers don't need to understand structurally. We accept this trade-off because the alternative (union types per source) leaks source knowledge into the store and scorer.

### D2: Separate SQLite database with schema versioning

**Decision**: Create `~/.opencandle/sentinel.db` as a separate SQLite database from the memory database. Include a `schema_version` table following the pattern in `src/memory/sqlite.ts:8-23`.

**Rationale**: The sentiment store has different lifecycle and access patterns than the memory store. It grows with usage (potentially thousands of records), needs FTS5 (which the memory DB doesn't use), and could be blown away without losing user preferences or workflow history. Separation also allows independent schema evolution.

**Schema versioning**: The store must include a `schema_version` table and version-gated migration logic, exactly like the existing memory DB. This enables safe upgrades when the schema changes. Version 1 is the initial schema; future changes increment and add migration steps.

**Lifecycle ownership**: The `SentimentStore` class owns database creation, WAL mode, pruning, and cleanup. It uses `resolveOpenCandlePath("sentinel.db")` from `src/infra/opencandle-paths.ts` for path resolution (not `getStateDbPath()`, which resolves to `state.db`). Creates its own connection.

### D3: FTS5 virtual table with BM25 ranking

**Decision**: Use SQLite FTS5 with a content-synced virtual table for full-text search. The FTS5 table indexes `text`, `title`, `author`, `query`, and `source`. Ranking uses FTS5's built-in BM25. The `tickers` column is **not** indexed in FTS5 — ticker lookups use exact-match JSON queries on the main table.

**Rationale**: FTS5 is built into SQLite (via `better-sqlite3`), requires no additional dependencies, and BM25 ranking is the standard for relevance-weighted text search. For our query patterns (keywords, phrases), BM25 is appropriate. Ticker symbols are structured data (`AAPL`, `RY.TO`, `BTC-USD` per `tests/e2e/providers.test.ts:23-35`), not free text, so they use JSON exact-match on the main table instead.

### D4: Observation-based history (fetch-first, index-always)

**Decision**: Every sentiment tool call hits the live API first, then indexes results in the store as a side effect. The store uses an **observation model**: each fetch creates a new observation row keyed by `(source, sourceId, fetchedAt)`. The same tweet fetched on Monday and again on Wednesday produces two rows — one per observation. This builds real temporal history of what the user queried and what was live at that time.

**Rationale**: The original design used upsert-replace by `(source, sourceId)`, which destroys observation history. "Trend" would become "new content arrival rate" rather than "sentiment over time." By recording each observation, `get_sentiment_trend` can show genuine temporal sentiment evolution.

**Interaction with caching**: Existing providers cache results for 5 minutes (`src/infra/cache.ts:86-100`). This is fine — within a 5-minute window, the same records return from cache, and indexing the same record twice in 5 minutes is harmless (same sourceId + similar fetchedAt just adds a near-duplicate that trends computation averages out). The observation model matters over days, not minutes.

**Performance**: The store grows faster with observations than with upsert-replace. Pruning (30-day default) bounds this. For trend computation, `getTimeSeries()` aggregates by time bucket and averages scores, so duplicate observations within a bucket are harmless.

### D5: Keyword-only scorer for v1

**Decision**: v1 implements keyword scoring only, using shared bullish/bearish term lists with engagement weighting. No LLM tier.

**Rationale from Codex review**: The original D5/D6 hybrid scorer design had three critical problems:
1. **No runtime integration**: The tool adapter (`src/pi/tool-adapter.ts:15-17`) passes `signal` and `onUpdate`, not an LLM client. There's no way for a tool to access the agent's LLM connection.
2. **Wrong fallback**: The `claude -p` CLI fallback only works with Anthropic, but OpenCandle supports Google and OpenAI providers (`src/pi/setup.ts:24-25`).
3. **Unobservable**: Tool-internal LLM calls wouldn't appear in the harness trace format, making debugging and cost accounting impossible.

Keyword scoring handles the majority of clear-cut sentiment signals. For v1, this is sufficient. A future change can add LLM scoring once the runtime provides a proper LLM access mechanism for tools.

**Confidence calculation**: Even keyword-only, confidence is useful. It reflects: (a) number of keyword matches (more = higher), (b) text length (longer text with matches = higher), (c) source penalty (Twitter gets -0.1 due to brevity/sarcasm). Low-confidence records are surfaced to the agent as "low confidence" so the LLM can apply its own judgment.

### D6: Shared keyword lists

**Decision**: Extract bullish/bearish term lists from `src/providers/twitter.ts:38-46` and `src/providers/reddit.ts:77-85` into `src/sentiment/keywords.ts`. Both existing providers import from the shared module. The new scorer also uses it.

**Rationale**: The two providers already have nearly identical keyword lists. Sharing them eliminates drift and makes updates propagate everywhere. Existing provider tests must still pass after extraction (backward-compatible).

### D7: Reddit comment fetching — top 5 per post

**Decision**: The Reddit adapter fetches `https://www.reddit.com/r/{sub}/comments/{id}.json` for each post, extracting the top 5 comments (by score). Each comment becomes its own `SentinelRecord` with `metadata.isComment: true` and `metadata.parentId` linking to the post.

**Provider changes required**: The Reddit provider (`src/providers/reddit.ts`) currently does not expose post IDs or self-text. The listing response interface must be extended to extract `id` and `selftext` from `child.data`. A new `getPostComments(subreddit, postId, limit)` function is added.

**Rate limiting**: Reddit currently has **no rate limiter bucket** (`src/infra/rate-limiter.ts:54-60`). This change adds both a `reddit` bucket (for listing requests) and a `reddit_comments` bucket (for comment requests). Comment cache TTL is 30 minutes (discussions evolve slower than rankings).

**Trade-off**: Extra HTTP calls per sentiment query add latency. Mitigation: comments are fetched only for the **top 10 posts by score** (not all 25), capping comment requests at 10. Progressive: fetch comments for highest-score posts first, stop if rate-limited.

### D8: Sparkline rendering with sample context

**Decision**: Implement sparkline rendering using Unicode block characters (`▁▂▃▄▅▆▇█`) for sentiment time-series in tool output. Always pair sparklines with sample counts and time range to prevent overstating signal.

**Rationale**: A sparkline like `▂▃▅▇▆▃▁ (42 records, 7d)` communicates a trend efficiently. Without sample counts, sparklines from 3 records look identical to sparklines from 300 records — misleading for financial analysis.

### D9: Remove get_reddit_discussions entirely

**Decision**: Delete `src/tools/sentiment/news-sentiment.ts` and all references. Remove from `src/tools/index.ts`, `src/system-prompt.ts`, `src/prompts/context-builder.ts`, `src/analysts/orchestrator.ts`, and `tests/e2e/audit-fixes.test.ts`.

**Rationale**: The project is unreleased. `get_reddit_discussions` does topic filtering across r/stocks and r/investing with no sentiment scoring. The enhanced `get_reddit_sentiment` absorbs this fully:
- **Topic filtering**: New `query` param filters posts by relevance (not just hot-listing of a single subreddit)
- **Cross-subreddit**: New `subreddits` param defaults to `["wallstreetbets", "stocks", "investing", "options"]` when no specific subreddit is given
- **Scoring**: Unlike the old tool, results are actually sentiment-scored

This is not a deprecation — it's a removal of dead code that's being replaced by a strictly superior implementation.

### D10: Cross-source divergence detection (normalized)

**Decision**: The `get_sentiment_summary` tool compares per-source **average per-record sentiment scores**. When retail sources (Twitter, Reddit average) diverge from news sources (web average) by more than a configurable threshold (default 0.4), flag it as a divergence signal.

**Normalization**: Each source's score is the simple average of its records' sentiment scores. This makes sources comparable regardless of volume (50 tweets vs 10 articles). Engagement weighting is applied within keyword scoring of individual records, not at the cross-source comparison level.

**Rationale from Codex review**: The original design compared raw aggregates where Twitter was engagement-weighted, Reddit included comment-level records inflating count, and web had no engagement — making the comparison meaningless. Per-record averages normalize this.

**Minimum records**: Divergence requires minimum 5 records per source group. Below that, divergence analysis is skipped with an explicit note.

### D11: Sentiment config section

**Decision**: Extend `OpenCandleFileConfig` in `src/config.ts` with a `sentiment` section:

```ts
sentiment?: {
  retentionDays?: number;       // default 30
  defaultSubreddits?: string[]; // default ["wallstreetbets", "stocks", "investing", "options"]
  commentsPerPost?: number;     // default 5
  divergenceThreshold?: number; // default 0.4
}
```

**Rationale from Codex review**: The original design had no config story. Current config only has API keys and `debate` (`src/config.ts:4-26`), but this feature introduces multiple tunable values. Making them configurable avoids hardcoded magic numbers and lets users adjust behavior.

## Risks / Trade-offs

**[Observation store growth]** The observation model grows faster than upsert-replace. Over months of heavy usage, sentinel.db could accumulate many rows. Mitigation: 30-day TTL pruning on startup (configurable). For 50 queries/day × 50 records/query = 2500 rows/day × 30 days = 75K rows — well within SQLite's comfort zone.

**[Reddit comment rate limiting]** Extra HTTP calls per query could trigger Reddit rate limits. Mitigation: dedicated `reddit` and `reddit_comments` rate limiter buckets; 30-minute comment cache TTL; progressive fetching (comments only for top-engagement posts).

**[FTS5 availability in better-sqlite3]** FTS5 must be compiled into the SQLite binary. Mitigation: `better-sqlite3` includes FTS5 by default. A test verifies `CREATE VIRTUAL TABLE ... USING fts5(...)` succeeds on first run.

**[Provider changes needed]** Twitter and Reddit providers must be extended to expose fields the adapters need (IDs, metadata). This is internal-only (no public API change) but increases scope. Mitigation: provider changes are scoped to adding fields to existing return types, not restructuring.

**[Keyword confidence calibration]** Without an LLM tier, low-confidence records stay keyword-scored. The agent sees confidence values and can apply its own judgment — this is consistent with `AGENTS.md:76` ("Tools fetch + format. Analysts/LLM synthesize.")

**[Two scoring engines temporarily]** During migration, the existing per-provider scoring in `twitter.ts:48-74` and `reddit.ts:87-103` coexists with the new shared scorer. The old provider-level scoring is left in place for backward compatibility of the existing tool output format; the new scorer runs alongside for indexing. After validation, the old scoring can be removed in a follow-up.

## Resolved Questions (from original design)

1. **Comment depth**: Top-level comments only. Replies add complexity and rate-limit cost without proportional signal gain.

2. **Store pruning strategy**: Time-based (configurable, default 30 days). Size-based is unnecessary — 75K rows/month is trivial for SQLite.

3. **Default subreddit list**: `wallstreetbets`, `stocks`, `investing`, `options`. Configurable via `sentiment.defaultSubreddits`.

4. **LLM scorer**: Deferred to a future change. Requires runtime integration for tool-level LLM access.
