## Why

The sentiment pipeline uses generic web search for financial news, which returns unstructured snippets without ticker association. Finnhub's `/company-news` endpoint provides ticker-tagged financial news at 60 req/min (free tier), giving the sentiment pipeline a dedicated financial news signal alongside the existing Twitter, Reddit, and web search sources.

## What Changes

- **Add Finnhub `/company-news` provider** — new `src/providers/finnhub.ts` with `getCompanyNews(symbol, from, to)` returning structured articles (headline, summary, source, datetime). Results capped at 20 articles per query to prevent volume flooding (NVDA returns 250/day uncapped). Includes headline/summary relevance post-filter since ~56% of articles for popular tickers are tangentially related market news, not ticker-specific.
- **Add Finnhub sentiment adapter** — new `src/sentiment/adapters/finnhub.ts` mapping Finnhub articles to `SentinelRecord` with `source: "finnhub"`. Ticker detection at adapter level — no-ops for non-ticker queries.
- **Wire Finnhub into `get_sentiment_summary`** — runs as a 4th parallel source alongside Twitter, Reddit, and web search. Only fires when query contains a recognized ticker and `FINNHUB_API_KEY` is configured.
- **Demote DDG in web search cascade** — DDG moves to last position after Exa and Brave. Cascade becomes Exa → Brave → DDG. DDG remains available as a fallback but is no longer preferred.
- **Add `FINNHUB_API_KEY` to config** — follows existing pattern (env var + file config).
- **Update `get_sentiment_trend`** — add `"finnhub"` to the source filter parameter so historical Finnhub data is queryable.

## Capabilities

### New Capabilities
- `finnhub-news`: Finnhub company news provider and sentiment adapter for ticker-specific financial news.

### Modified Capabilities
- `web-search`: Reorder cascade to Exa → Brave → DDG (DDG demoted to last).
- `sentiment-summary`: Add Finnhub as a 4th parallel source; add `"finnhub"` to `SentimentSource` type; update divergence grouping.

## Impact

- **Dependencies**: No new npm dependencies (Finnhub is a simple REST API via existing `httpGet`). `duck-duck-scrape` retained.
- **Config**: New `FINNHUB_API_KEY` env var / `providers.finnhub.apiKey` file config. Optional — sentiment pipeline degrades gracefully if not set.
- **Types**: `SentimentSource` gains `"finnhub"`. `WebSearchEnvelope.provider` gains `"exa"` if not already present.
- **Rate limiting**: New `finnhub` entry in rate-limiter (60 req/min free tier).
- **Data quality**: Finnhub articles need relevance post-filtering — only ~44% of articles for AAPL actually mention Apple. Source quality is mixed (Yahoo, SeekingAlpha, Benzinga, CNBC, ChartMill), not exclusively institutional. Non-US tickers (TSM, BABA) do return results despite pricing page suggesting US-only.
- **Tests**: New unit tests for Finnhub provider and adapter. New fixture files for Finnhub API responses. Existing web-search tests updated for new cascade order.

## Findings from API Testing

Tested with a live Finnhub API key. Key observations:
- **Response shape**: `{category, datetime, headline, id, image, related, source, summary, url}` — `related` is always just the queried symbol (not multi-ticker).
- **Volume**: AAPL returns ~70 articles/day, NVDA ~250/day. Must cap results.
- **Relevance**: Only 44% of AAPL articles mention "Apple" or "AAPL" in headline/summary. Many are generic market articles (ETF comparisons, investment advice) tagged to AAPL.
- **Sources**: Mostly Yahoo, SeekingAlpha, Benzinga. Some CNBC. Not the Reuters/Bloomberg-heavy feed initially assumed.
- **Non-US**: TSM (33 articles/week), BABA (16), BTC (9) — works beyond US equities.
- **URLs**: Finnhub proxies through `finnhub.io/api/news?id=...` which 302-redirects to the real article.
- **`/news-sentiment`**: Confirmed paywalled — `"You don't have access to this resource."` on free tier.
