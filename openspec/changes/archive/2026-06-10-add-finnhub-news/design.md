## Context

The sentiment pipeline (PR #11) established a source-agnostic architecture: adapters normalize raw data into `SentinelRecord`, the scorer/store/trends layer operates on records regardless of origin. Currently three sources feed it: Twitter, Reddit, and web search (Exa → Brave → DDG cascade).

All web search providers return generic `{title, url, snippet}` results that lack ticker association, forcing the keyword scorer to infer financial relevance from snippet text.

Finnhub's `/company-news` endpoint returns ticker-tagged financial news at 60 req/min on the free tier. API testing revealed: sources are mostly Yahoo/SeekingAlpha/Benzinga (not exclusively Reuters/Bloomberg), relevance is noisy (~56% of articles for popular tickers are tangentially related), and volume is high (NVDA: 250 articles/day). These findings shape the design.

## Goals / Non-Goals

**Goals:**
- Add Finnhub as a dedicated financial news source in the sentiment pipeline (parallel to web search, not a cascade member).
- Demote DDG to last position in the web search cascade (Exa → Brave → DDG).
- Cap and filter Finnhub results to control noise and volume.
- Maintain graceful degradation — all new functionality is optional (no Finnhub key = Finnhub is skipped).

**Non-Goals:**
- Adding Finnhub's paid-tier endpoints (`/news-sentiment`, social sentiment, earnings transcripts).
- Replacing Exa or Brave — web search cascade still serves non-ticker queries.
- Adding a standalone `get_finnhub_news` tool — Finnhub feeds into the pipeline, not exposed directly.
- Changing the keyword scorer to treat Finnhub data differently.
- Refactoring `SentimentSource` into `provider` + `cohort` taxonomy (valid future improvement, out of scope).

## Decisions

### 1. Finnhub as a parallel source, not a cascade member

**Decision**: Finnhub is wired into `sentiment-summary.ts` as a 4th `Promise.allSettled` entry, not added to the `web-search.ts` cascade.

**Why**: The web search cascade (`withFallback`) tries providers in order for arbitrary text queries. Finnhub only works with ticker symbols — it can't search "AI regulation news." Making it a cascade member would require ticker detection inside the cascade, which is the wrong abstraction level. As a parallel source in the sentiment summary, it fires alongside web search and only activates when the query contains a ticker.

**Alternative considered**: A ticker-aware news router abstraction above provider level. Valid architecture but over-engineered for a single new source. If we add more ticker-specific providers later, we can extract the router then.

### 2. New `"finnhub"` source type

**Decision**: Add `"finnhub"` to the `SentimentSource` union type rather than reusing `"web"`.

**Why**: Divergence detection benefits from distinguishing Finnhub-sourced news from generic web search results. The pipeline groups by source for per-source averages — conflating Finnhub articles with Exa/Brave snippets would dilute the signal.

**Acknowledged trade-off**: This makes `SentimentSource` a mixed taxonomy (mediums like "twitter"/"reddit" alongside a provider name "finnhub"). A `provider` + `cohort` split would be cleaner but is a larger refactor. Pragmatically, `"finnhub"` works for divergence detection now.

**Ripple effects**: `get_sentiment_trend` tool's `source` filter parameter must be updated to include `"finnhub"`.

### 3. Ticker detection at the adapter level

**Decision**: The `FinnhubAdapter` receives the query and extracts ticker symbols. If no ticker is found, it returns an empty array (no-op). The sentiment-summary tool does not need ticker-aware branching.

**Why**: Keeps the tool layer simple — it always calls all sources in parallel. The adapter handles the "does this query have a ticker?" concern internally.

**Caution**: Ticker detection must handle false positives (e.g., "AI" is both a common word and ticker symbol `C3.ai`). Use the existing entity-extractor with its stoplist rather than bare regex.

### 4. Relevance post-filter

**Decision**: The Finnhub provider filters articles by checking if the queried ticker/company name appears in the headline or summary. API testing showed only 44% of AAPL articles actually mention Apple.

**Why**: Without filtering, over half the articles for popular tickers are generic market commentary (ETF comparisons, portfolio advice) that happen to be tagged to the ticker. This noise would degrade sentiment accuracy.

### 5. Result cap at 20 articles

**Decision**: The provider caps results at 20 articles after relevance filtering.

**Why**: NVDA returns 250 articles/day. Without a cap, Finnhub records could dominate the aggregate sentiment score, drowning signals from Twitter (50 posts), Reddit (~30 posts), and web search (10 results).

### 6. Keep DDG, demote to last

**Decision**: Keep `duck-duck-scrape` in the codebase but move DDG to last position in the cascade. Order becomes Exa → Brave → DDG.

**Why**: Exa MCP is also somewhat brittle (handles 429s, 403s, challenge pages). Keeping DDG as a last-resort fallback is cheap insurance. If both Exa and Brave fail, DDG provides a degraded but functional experience. We can evaluate removal later based on usage data.

### 7. Simple REST via `httpGet`, no SDK

**Decision**: Call Finnhub's REST API directly via the existing `httpGet` from `src/infra/http-client.ts`. No `finnhub` npm package.

**Why**: The `/company-news` endpoint is a single GET with query params. Adding an SDK dependency for one endpoint is unnecessary.

## Risks / Trade-offs

- **[Relevance noise]** → Post-filtering mitigates but doesn't eliminate. Some articles may mention the ticker incidentally. Keyword scorer provides a second pass. Acceptable for v1.
- **[Cross-source article duplication]** → Finnhub and Exa/Brave can return the same article from the same outlet. Current pipeline dedupes by `(source, source_id)` but different sources produce different source_ids for the same article. URL-based deduplication across sources is a future improvement, not blocking for v1 since divergence detection compares source averages, not raw counts.
- **[Volume imbalance]** → Even with cap at 20, Finnhub may have more records than web search (10). Per-source averaging in divergence detection handles this — it compares means, not totals.
- **[Finnhub key is optional]** → If not configured, the sentiment summary has 3 sources instead of 4. No degradation in existing functionality.
- **[60 req/min shared across all Finnhub calls]** → Currently only `/company-news` uses it. If future changes add more Finnhub endpoints, the rate limiter bucket is already shared.
- **[Finnhub URLs are proxied]** → Article URLs go through `finnhub.io/api/news?id=...` and 302-redirect to the real URL. We store the Finnhub URL as-is; resolving redirects is unnecessary for sentiment analysis.
