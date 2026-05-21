---
title: System Architecture
description: How OpenCandle routes prompts through workflows, tools, providers, and local runtime state.
---

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
│  router.ts           →  default LLM router when                     │
│                         OPENCANDLE_ROUTER_MODE is unset or "llm"    │
│                         structured route, entities, slots, prefs    │
│  classify-intent.ts  →  legacy rule-based pattern matching when     │
│                         OPENCANDLE_ROUTER_MODE=rules                │
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
│  │  fred_data, crypto fear_greed                                  │ │
│  ├─ options/ ─────────────────────────────────────────────────────┤ │
│  │  option_chain with computed Greeks                             │ │
│  ├─ portfolio/ ───────────────────────────────────────────────────┤ │
│  │  tracker, risk_analysis, watchlist, correlation, predictions   │ │
│  └─ sentiment/ ───────────────────────────────────────────────────┘ │
│     search_web          → raw web search (Exa → Brave → DDG)       │
│     get_web_sentiment   → web search + keyword scoring pipeline     │
│     get_reddit_sentiment                                            │
│     get_twitter_sentiment                                           │
│     get_sentiment_summary → cross-source summary, including Finnhub  │
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
│                         requires a local Twitter/X browser session  │
│  finnhub.ts        ←── sentiment-summary                            │
│  sec-edgar.ts      ←── sec-filings                                  │
│  fear-greed.ts     ←── alternative.me crypto Fear & Greed           │
│  web-search.ts     ←── search-web, web-sentiment, sentiment-summary │
│  exa-search.ts     ←── web-search.ts (cascade member)               │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  INFRA (src/infra/)                                                 │
│                                                                     │
│  http-client.ts   — shared helper for many provider calls           │
│  cache.ts         — TTL cache with stale fallback                   │
│  rate-limiter.ts  — per-provider token bucket                       │
│                                                                     │
│  CROSS-CUTTING PROVIDER HELPERS (src/providers/):                   │
│  with-fallback.ts — cascade orchestrator (try providers in order)   │
│  wrap-provider.ts — circuit breaker + failure tracking              │
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
│       │          ┌──────────┐        │                               │
│       │          │ Finnhub  │        │                               │
│       │          │ Adapter  │        │                               │
│       │          └────┬─────┘        │                               │
│       └──────────┬───┴──────────────┘                               │
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
Exa (MCP or API key) ──fail──▶ Brave (API key) ──fail──▶ DuckDuckGo
```

Used by three tools: `search_web`, `get_web_sentiment`, `get_sentiment_summary`.

Provider overrides can force `exa`, `brave`, or `ddg` for a single request. The default cascade tries Exa first, uses Brave when configured, and keeps DuckDuckGo as the keyless final fallback.

## Runtime Configuration

- `OPENCANDLE_ROUTER_MODE` defaults to `llm`. Set `OPENCANDLE_ROUTER_MODE=rules` to force the legacy regex router.
- `OPENCANDLE_HOME` defaults to `~/.opencandle` and contains OpenCandle-owned state such as `config.json`, `onboarding.json`, watchlist/portfolio/prediction files, `state.db`, `sentinel.db`, and `browser-profile/`.
- The local GUI defaults to `http://127.0.0.1:14567`; `/health` reports whether that process is the session `writer` or a read-only `follower`.

## GUI Runtime

The GUI server owns the local browser workbench. It serves the built `gui/web/dist` bundle, reads Pi session state, and publishes chat/session updates over HTTP, server-sent events, and WebSocket.

- `GET /health` reports `{ ok, role }`, where `role` is `writer` or `follower`.
- `GET /api/sessions` lists sessions and the current GUI session.
- `GET /api/session/events` returns the current session's projected chat events.
- `POST /api/chat/run` streams a chat run over SSE when the process is writer.
- `GET /ws` upgrades to a WebSocket for boot, snapshot, setup, catalog, and session update messages.

The browser is organized as reusable UI primitives plus product feature modules: chat, sessions, context panel, catalog, and tool-result renderers. Shared event contracts live under `gui/shared/` so server producers and browser consumers stay aligned.

## Key Design Principles

- **Tools fetch + format. LLM synthesizes.** Tools never analyze or draw conclusions.
- **Adapters normalize.** Each sentiment source has an adapter that maps to `SentinelRecord`.
- **Pipeline is source-agnostic.** Scorer, store, and trends work on `SentinelRecord[]` regardless of origin.
- **Cascade with circuit breakers.** `withFallback()` + `wrapProvider()` handle provider failures gracefully.
- **Stale cache as safety net.** Providers and tools that opt into stale cache can return the last known value with clear degraded-state metadata.
- **Evidence before confidence.** Runtime records and tool details should make source, freshness, and degradation visible before the assistant synthesizes.
