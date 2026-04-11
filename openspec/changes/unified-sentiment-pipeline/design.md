## Context

OpenCandle has three sentiment tools today: `get_twitter_sentiment` (keyword-scored tweets via scraper), `get_reddit_sentiment` (keyword-scored post titles via public JSON API), and `get_reddit_discussions` (unscored Reddit post search). All three share the same weakness: keyword matching that misses sarcasm and context, no persistence (every query is ephemeral), and no cross-source analysis.

Research into fieldtheory-cli revealed patterns that directly address these gaps:
- **SQLite FTS5 indexing**: Persist all content locally with full-text search. Enables historical queries without re-fetching.
- **Hybrid classification**: Fast regex for obvious signals, batched LLM for ambiguous content. fieldtheory batches 50 bookmarks per LLM prompt with prompt injection sanitization.
- **JSONL + SQLite architecture**: Immutable append-only source of truth + searchable index on top.
- **Incremental sync with checkpointing**: Resume-safe fetching, cursor-based pagination.
- **Sparkline visualization**: Unicode sparklines (`▁▂▃▄▅▆▇█`) for time-series in terminal output.
- **Rich engagement data**: Likes, retweets, replies, views as first-class indexed fields.

Additional research into agent web search tools (pi-web-access, duck-duck-scrape, open-webSearch) informed the web adapter design, which sits on top of the `web-search-tool` change.

## Goals / Non-Goals

**Goals:**

- Unify all sentiment sources (Twitter, Reddit, web) behind a common record type and scoring pipeline
- Persist sentiment data in a local SQLite FTS5 store for historical queries and trend analysis
- Improve scoring quality with a hybrid keyword + LLM approach that gracefully degrades
- Add Reddit comment fetching for deeper signal (not just post titles)
- Enable cross-source sentiment comparison and divergence detection
- Add sparkline visualization for temporal trends
- Sanitize user-generated content before LLM classification (prompt injection defense)
- Make the pipeline extensible for future sources (Discord, RSS, etc.) by adding an adapter

**Non-Goals:**

- Real-time streaming / push-based sentiment monitoring (pull-based on each query is sufficient)
- Embedding-based semantic search (FTS5 BM25 is sufficient for our query patterns)
- Replacing the agent's own analytical reasoning with automated sentiment conclusions
- Sub-second scoring latency (LLM tier adds seconds; keyword tier is instant — the blend is acceptable)
- Sentiment scoring for non-English content (English-only keyword lists; LLM handles multilingual but we don't optimize for it)
- Building a general-purpose NLP pipeline (this is financial sentiment specific)

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
  publishedAt: string            // ISO 8601
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
    method: "keyword" | "llm"
    tickers: string[]
  }
  metadata: Record<string, unknown>  // source-specific extras
}
```

**Rationale**: A common shape enables the store, scorer, and trend computation to be source-agnostic. The `metadata` field handles source-specific data (subreddit name, conversation ID, search rank) without polluting the core shape. This pattern is directly borrowed from fieldtheory-cli's `BookmarkRecord`.

### D2: Separate SQLite database for sentiment store

**Decision**: Create `~/.opencandle/sentinel.db` as a separate SQLite database, not add tables to the existing memory database.

**Rationale**: The sentiment store has different lifecycle and access patterns than the memory store. It grows with usage (potentially thousands of records), needs FTS5 (which the memory DB doesn't use), and could be blown away without losing user preferences or workflow history. Separation also allows independent schema evolution.

### D3: FTS5 virtual table with BM25 ranking

**Decision**: Use SQLite FTS5 with a content-synced virtual table for full-text search. The FTS5 table indexes `text`, `title`, `author`, `query`, `source`, and `tickers`. Ranking uses FTS5's built-in BM25.

**Rationale**: FTS5 is built into SQLite (via `better-sqlite3`), requires no additional dependencies, and BM25 ranking is the standard for relevance-weighted text search. fieldtheory-cli uses the same approach successfully. This is dramatically simpler than adding a vector DB for embedding search, and for our query patterns (ticker names, keywords, phrases), BM25 is more appropriate than semantic similarity.

### D4: Fetch-first, index-always

**Decision**: Every sentiment tool call hits the live API first, then indexes results in the store as a side effect. The store never gates a response — it enriches future responses with historical context.

**Rationale**: Financial data requires freshness. Users expect `get_twitter_sentiment("AAPL")` to return current sentiment, not cached results from yesterday. The store is a "write-through" layer that accumulates history passively. Query-only tools (`get_sentiment_trend`, `get_sentiment_summary`) exist separately for when the user explicitly wants historical analysis.

### D5: Hybrid scorer with confidence-gated LLM tier

**Decision**: Two-tier scoring pipeline. Tier 1: keyword matching (existing bullish/bearish term lists) with engagement weighting. Produces a score and a confidence value. Tier 2: LLM batch classification for records where Tier 1 confidence is below threshold (0.6). LLM receives batches of up to 50 records with sanitized text.

**Rationale**: Keyword matching handles ~70% of content correctly and instantly. The remaining 30% (sarcasm, context-dependent, ambiguous) benefits from LLM classification. fieldtheory-cli's hybrid approach (regex fast-path + LLM refinement) demonstrates this pattern at scale. The confidence threshold prevents unnecessary LLM calls for clear-cut signals.

**Graceful degradation**: If LLM access is unavailable, the keyword score is kept with its confidence value. The `sentiment.method` field tells downstream consumers which tier scored the record. Tools can display "low confidence" warnings when showing keyword-only scores for ambiguous content.

### D6: LLM scoring via classify callback, CLI as fallback

**Decision**: The scorer accepts an optional `classify` callback function. When the sentiment pipeline runs inside the agent runtime, this callback uses the agent's existing LLM connection. When running standalone (tests, CLI), fall back to `claude -p` CLI invocation (following fieldtheory-cli's pattern). If neither is available, keep keyword scores.

**Rationale**: The agent already has LLM access — reusing it avoids spawning a subprocess. But the CLI fallback means the scorer works in test harnesses and standalone scripts. Three-level degradation: callback → CLI → keyword-only.

### D7: Reddit comment fetching — top 5 per post

**Decision**: The Reddit adapter fetches `https://www.reddit.com/r/{sub}/comments/{id}.json` for each post, extracting the top 5 comments (by score). Each comment becomes its own `SentinelRecord` with `metadata.isComment: true` and `metadata.parentId` linking to the post.

**Rationale**: Post titles alone are insufficient for sentiment. "NVDA earnings thread" is neutral as a title, but the top comments reveal actual sentiment. fetching top-5 per post is a balance between signal quality and rate-limit cost (25 posts × 1 extra request each = 25 additional calls). The rate limiter's `reddit_comments` bucket controls this.

**Trade-off**: 25 extra HTTP calls per sentiment query adds latency (~5-10s). Mitigation: comments are cached with a longer TTL (30 minutes vs 5 minutes for post listings) since discussions evolve slower than rankings.

### D8: Sparkline rendering for temporal trends

**Decision**: Implement sparkline rendering using Unicode block characters (`▁▂▃▄▅▆▇█`) for sentiment time-series in tool output. Normalize sentiment scores to 8 levels across the visible range.

**Rationale**: A sparkline like `▂▃▅▇▆▃▁` communicates a trend in one line — far more efficient than a table of numbers. fieldtheory-cli's visualization code demonstrates this with both sparklines and braille charts. We start with sparklines only (simpler, sufficient for sentiment trends).

### D9: Prompt injection sanitization

**Decision**: Before sending user-generated content (tweets, Reddit posts/comments) to the LLM scorer, sanitize text by replacing known injection patterns: `ignore previous instructions`, `you are now`, `system:`, `<|endoftext|>`, etc. Following fieldtheory-cli's `buildPrompt()` sanitization.

**Rationale**: Tweets and Reddit posts can contain adversarial text (intentional or accidental) that could manipulate LLM classification. Sanitization is cheap and defensive. fieldtheory-cli's pattern list is a good starting point.

### D10: Cross-source divergence detection

**Decision**: The `get_sentiment_summary` tool compares per-source sentiment averages. When retail sources (Twitter, Reddit) diverge from news sources (web) by more than 0.4 (absolute difference), flag it as a divergence signal.

**Rationale**: Retail-vs-institutional sentiment divergence is a recognized market signal. When Twitter is extremely bullish but financial news is bearish, this pattern often precedes volatility. The threshold (0.4) is a starting point — tunable based on experience.

### D11: get_reddit_discussions merged into enhanced get_reddit_sentiment

**Decision**: Remove `get_reddit_discussions` as a separate tool. Its functionality (searching r/stocks + r/investing) is subsumed by the enhanced `get_reddit_sentiment` with cross-subreddit aggregation.

**Rationale**: `get_reddit_discussions` currently returns no sentiment score and is hard-coded to two subreddits. The enhanced Reddit adapter searches across configurable subreddits and scores everything — strictly superset functionality.

## Risks / Trade-offs

**[LLM scorer latency]** Batching 50 records through the LLM adds 3-10 seconds. Mitigation: Tier 1 keyword scores return immediately; LLM tier runs only for low-confidence records; the tool returns keyword scores while LLM refines in the batch.

**[Reddit comment rate limiting]** 25 extra HTTP calls per query could trigger Reddit rate limits. Mitigation: dedicated `reddit_comments` rate limiter bucket; 30-minute comment cache TTL; progressive fetching (fetch comments only for top-engagement posts first).

**[FTS5 availability in better-sqlite3]** FTS5 must be compiled into the SQLite binary. Mitigation: `better-sqlite3` includes FTS5 by default. Verify in a test that `CREATE VIRTUAL TABLE ... USING fts5(...)` succeeds.

**[Store growth]** Over months of heavy usage, sentinel.db could grow large. Mitigation: add a TTL-based pruning query that deletes records older than 30 days on startup. Configurable.

**[Keyword confidence calibration]** The 0.6 confidence threshold for LLM escalation is a guess. Too low: everything goes to LLM (slow). Too high: ambiguous content stays keyword-scored (inaccurate). Mitigation: start at 0.6, log keyword vs LLM agreement rates, tune based on data.

**[Cross-source divergence false positives]** The 0.4 divergence threshold may flag noise as signal. Mitigation: only flag when each source has minimum 5 records in the time window; require divergence to persist across at least 2 time periods.

## Open Questions

1. **Comment depth**: Should we fetch only top-level comments, or include replies? Top-level is simpler and usually sufficient, but reply threads on controversial takes can carry strong signal.

2. **Store pruning strategy**: Time-based (delete > 30 days), size-based (keep last N records), or both? Time-based is simpler; size-based prevents runaway growth for high-frequency users.

3. **LLM prompt design**: What prompt produces the most reliable financial sentiment classification? Needs experimentation. fieldtheory-cli's prompt structure (indexed list of items → JSON array output) is a good starting template.

4. **Cross-subreddit default list**: Which subreddits should `get_reddit_sentiment` search by default when no subreddit is specified? Candidates: r/wallstreetbets, r/stocks, r/investing, r/options, r/stockmarket. User-configurable via preferences.
