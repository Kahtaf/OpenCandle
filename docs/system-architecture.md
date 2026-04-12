# System Architecture

How OpenCandle routes user requests to tools, providers, and the sentiment pipeline.

## Request Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER PROMPT                                  │
│              "What's the sentiment on AAPL?"                        │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ROUTING (src/routing/)                                             │
│                                                                     │
│  classify-intent.ts  →  rule-based pattern matching                 │
│                         "analyze AAPL" → single_asset_analysis      │
│                         news keywords  → general_finance_qa         │
│                         "compare X Y"  → compare_assets             │
│                                                                     │
│  entity-extractor.ts →  pulls symbols, budget, direction            │
│  slot-resolver.ts    →  fills workflow params from entities          │
│                                                                     │
│  NOTE: Routing classifies into WORKFLOWS, not individual tools.     │
│  The LLM (Pi agent) decides which TOOLS to call within a workflow.  │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  TOOLS (src/tools/) — the LLM picks from these                      │
│                                                                     │
│  ┌─ market/ ──────────────────────────────────────────────────────┐ │
│  │  stock_quote, stock_history, crypto_price, crypto_history,     │ │
│  │  search_ticker                                                 │ │
│  ├─ fundamentals/ ────────────────────────────────────────────────┤ │
│  │  company_overview, financials, earnings, dcf, comps,           │ │
│  │  sec_filings                                                   │ │
│  ├─ technical/ ───────────────────────────────────────────────────┤ │
│  │  indicators, backtest                                          │ │
│  ├─ macro/ ───────────────────────────────────────────────────────┤ │
│  │  fred_data, fear_greed                                         │ │
│  ├─ options/ ─────────────────────────────────────────────────────┤ │
│  │  option_chain, greeks                                          │ │
│  ├─ portfolio/ ───────────────────────────────────────────────────┤ │
│  │  tracker, risk_analysis, watchlist, correlation, predictions   │ │
│  └─ sentiment/ ───────────────────────────────────────────────────┘ │
│     search_web          → raw web search (Exa → Brave cascade)     │
│     get_web_sentiment   → web search + keyword scoring pipeline     │
│     get_reddit_sentiment                                            │
│     get_twitter_sentiment                                           │
│     get_sentiment_summary → cross-source (Twitter+Reddit+Web)       │
│     get_sentiment_trend   → historical from local SQLite store      │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PROVIDERS (src/providers/) — tools call these                      │
│                                                                     │
│  yahoo-finance.ts  ←── stock-quote, stock-history                   │
│  alpha-vantage.ts  ←── company-overview, financials, earnings, dcf  │
│  coingecko.ts      ←── crypto-price, crypto-history                 │
│  fred.ts           ←── fred-data                                    │
│  reddit.ts         ←── reddit-sentiment, sentiment-summary          │
│  twitter.ts        ←── twitter-sentiment, sentiment-summary         │
│  sec-edgar.ts      ←── sec-filings                                  │
│  fear-greed.ts     ←── fear-greed                                   │
│  web-search.ts     ←── search-web, web-sentiment, sentiment-summary │
│  exa-search.ts     ←── web-search.ts (cascade member)               │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  INFRA (src/infra/)                                                 │
│                                                                     │
│  http-client.ts   — all external HTTP goes through here             │
│  cache.ts         — TTL cache with stale fallback                   │
│  rate-limiter.ts  — per-provider token bucket                       │
│                                                                     │
│  CROSS-CUTTING:                                                     │
│  with-fallback.ts — cascade orchestrator (try providers in order)   │
│  wrap-provider.ts — circuit breaker + failure tracking               │
└─────────────────────────────────────────────────────────────────────┘
```

## Sentiment Pipeline

The unified sentiment pipeline (src/sentiment/) normalizes data from multiple sources into a common `SentinelRecord` format, scores it, persists it, and computes trends + divergence.

```
┌─────────────────────────────────────────────────────────────────────┐
│  SENTIMENT PIPELINE (src/sentiment/)                                │
│                                                                     │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐                       │
│  │ Twitter  │   │  Reddit  │   │   Web    │    ← ADAPTERS          │
│  │ Adapter  │   │ Adapter  │   │ Adapter  │    normalize to        │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘    SentinelRecord     │
│       │              │              │                               │
│       └──────────┬───┘──────────────┘                               │
│                  ▼                                                   │
│  ┌──────────────────────────────┐                                   │
│  │  scorer.ts (keyword-based)   │  scores each record               │
│  │  BULLISH_TERMS / BEARISH_TERMS                                   │
│  │  engagement-weighted                                             │
│  └──────────────┬───────────────┘                                   │
│                 ▼                                                    │
│  ┌──────────────────────────────┐                                   │
│  │  store.ts (SQLite)           │  persists for trend tracking      │
│  └──────────────┬───────────────┘                                   │
│                 ▼                                                    │
│  ┌──────────────────────────────┐                                   │
│  │  trends.ts                   │  sparkline, direction, delta      │
│  │  + divergence detection      │  retail vs news gap               │
│  └──────────────────────────────┘                                   │
│                                                                     │
│  Output: SentimentSummary { fresh, trend, divergence, warnings }    │
└─────────────────────────────────────────────────────────────────────┘
```

## Web Search Cascade

The web search provider (`src/providers/web-search.ts`) uses a fallback cascade. Each member is tried in order; the first success wins. Circuit breakers skip providers that recently failed.

```
Exa (MCP or API key) ──fail──▶ Brave (API key) ──fail──▶ unavailable
```

Used by three tools: `search_web`, `get_web_sentiment`, `get_sentiment_summary`.

## Key Design Principles

- **Tools fetch + format. LLM synthesizes.** Tools never analyze or draw conclusions.
- **Adapters normalize.** Each sentiment source has an adapter that maps to `SentinelRecord`.
- **Pipeline is source-agnostic.** Scorer, store, and trends work on `SentinelRecord[]` regardless of origin.
- **Cascade with circuit breakers.** `withFallback()` + `wrapProvider()` handle provider failures gracefully.
- **Stale cache as safety net.** Every provider falls back to expired cache data before throwing.
