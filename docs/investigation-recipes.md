---
title: Investigation Recipes
description: Repeatable OpenCandle research paths for market, macro, filings, sentiment, and portfolio work.
---

# Investigation Recipes

OpenCandle works best when prompts name the evidence you want, not only the conclusion you hope to reach. These recipes are starting points for repeatable investigations.

You can run these recipes as natural-language chat prompts, slash commands where available, or GUI catalog workflows. The GUI catalog pre-fills structured prompts, but the investigation still appears in the normal chat timeline.

## Stock Snapshot

Use this when you want a quick but inspectable view of one public company. In the GUI, start from Comprehensive Analysis.

```text
/analyze NVDA
```

Expected evidence:

- current quote and recent price context
- company overview or fundamentals when a keyed provider is available
- relevant news or web context when search is configured
- clear warnings for unavailable providers

Good follow-up:

```text
What parts of that answer are based on stale or missing data?
```

## Compare Assets

Use this when choosing between two or more tickers. In the GUI, start from Compare Assets.

```text
Compare MSFT, GOOGL, and AMZN using price trend, fundamentals, and sentiment.
```

Expected evidence:

- normalized quote/history context for each symbol
- comparable-company or financial-statement data when available
- sentiment or web search context if configured
- a synthesis that separates data-backed observations from judgment calls

## Options Screen

Use this when exploring contracts and Greeks. In the GUI, start from Options Screener.

```text
Show me TSLA puts expiring next month with Greeks and open interest.
```

Expected evidence:

- available expirations and matching option-chain rows
- implied volatility, open interest, and volume when provider data includes them
- locally computed Greeks
- missing-expiration or missing-symbol clarification when needed

## SEC Filing Trail

Use this when you need primary-source company disclosure context. SEC filings need the local app; they are not available in the web app.

```text
Find recent SEC filings for AAPL and summarize what each filing type is for.
```

Expected evidence:

- [SEC EDGAR](https://www.sec.gov/edgar/search/) filing records
- filing dates, accession links, or available identifiers
- cautious synthesis that does not overstate what was inspected

## Macro Check

Use this when a market question depends on rates, inflation, labor data, or growth.

```text
Get the latest fed funds rate and compare it with CPI and unemployment.
```

Expected evidence:

- [FRED](https://fred.stlouisfed.org) series values when `FRED_API_KEY` is configured
- dates for the reported observations
- warning if a requested series is missing or unavailable

## Sentiment Triangulation

Use this when market narrative matters and you want cross-source evidence. X and Reddit sentiment need the local app; they are not available in the web app.

```text
Give me a sentiment read on AMD across Reddit, Twitter/X, and web results.
```

Expected evidence:

- source-specific sentiment records where available
- web search results through [Exa](https://exa.ai), [Brave](https://brave.com/search/api/), or [DuckDuckGo](https://duckduckgo.com) fallback
- divergence notes when retail chatter and news context disagree
- explicit provider/setup warnings

## Portfolio Risk

Use this when checking local holdings or a hypothetical allocation. In the GUI, use chat for existing holdings or Portfolio Builder when you want OpenCandle to build a proposed allocation from goals and constraints.

```text
Add 100 shares of NVDA at 120 and 50 shares of MSFT at 430, then run risk analysis.
```

Expected evidence:

- locally stored portfolio entries
- current market data used for valuation
- concentration and correlation output where available
- risk language that calls out downside scenarios

## Prompting Pattern

For stronger answers, ask for the evidence path:

```text
Analyze NVDA. Use quote, fundamentals, recent filings, sentiment, and macro context if available. Tell me which sources were unavailable before giving the synthesis.
```

That phrasing gives the agent permission to gather broadly while keeping provider gaps visible.
