---
title: Comparisons
description: How OpenCandle compares with general chatbots, finance websites, spreadsheets, and custom scripts, grounded in head-to-head benchmark runs.
---

# Comparisons

OpenCandle is best compared with the tools people already use for market research: a general chatbot, a browser full of finance sites, a spreadsheet, or custom scripts. The difference is that OpenCandle gathers provider-backed evidence through explicit finance tools, discloses when a source was missing, stale, or degraded, and synthesizes from that evidence trail.

OpenCandle is read-only research software. It does not place trades, route orders, or provide financial advice.

## OpenCandle vs General Chatbots

OpenCandle runs blind head-to-head comparisons against generic frontier-model agents answering the same prompts without finance tools. A judge scores the answers without knowing which agent wrote them. [Testing and Evals](./testing-and-evals.md#competitive-benchmarking) describes the method. The patterns below come from those runs, including the ones OpenCandle lost.

### Where no-tool chatbots fail

**They fabricate current data.** Asked what changed in a company's most recent 10-Q, a no-tool agent produced specific, plausible, invented filing changes. Asked for the current social mood around a volatile stock, another invented current posts and sentiment. The fabricated answers read better than honest ones, and judges rewarded that specificity until the scoring penalized unverifiable claims explicitly. OpenCandle fetches the actual filings and the actual posts, and says when a source is unavailable.

**They cannot see today's market.** "Why did this stock move today" needs a current quote. In benchmark runs, no-tool agents either declined or guessed; with a live quote, the answer can state the move, the session, and how fresh the number is.

**They lose track of position math.** Options prompts exposed recurring slips: quoting per-contract premiums as per-share, and dropping a stated share count or cost basis when sizing a hedge or covered call. OpenCandle reads the option chain and carries the stated position through the answer.

**They cannot review your portfolio.** Whether your holdings are overexposed to interest rates depends on your actual lots and watchlist. OpenCandle stores that state locally and reuses it; a chatbot needs it re-pasted every conversation.

### Where chatbots win

OpenCandle's benchmark losses cluster in two places:

- **Conceptual education.** Questions like how to use P/E ratios without over-relying on them need no live data. A well-structured chatbot explanation can beat a tool-driven answer.
- **Judgment-heavy personal finance.** Brokerage selection, mortgage-versus-investing tradeoffs, and tax-loss-harvesting mechanics turn on stable facts and judgment rather than live market data.

Both prompt classes stay in the benchmark set so the comparison stays honest.

| Capability | OpenCandle | General chatbot |
| --- | --- | --- |
| Finance tools | Built in: market, macro, options, filings, sentiment, fundamentals, crypto, portfolio | Depends on plan, connectors, or custom setup |
| Missing or stale data | Disclosed in the answer | Usually silent, sometimes covered by fabrication |
| Local portfolio state | Stored locally, reused across sessions | Re-pasted every conversation |
| Local browser GUI and terminal TUI | Yes | No |

## OpenCandle vs Finance Websites

Finance sites are strong for single-source lookup: a quote page, a filing, a chart. OpenCandle is for questions that cross sources. One investigation can combine a quote snapshot, [SEC EDGAR](https://www.sec.gov/edgar/search/) filings, [FRED](https://fred.stlouisfed.org) macro series, an option chain, sentiment, and your saved portfolio, then cite what it gathered and what was missing instead of leaving you to reconcile tabs.

## OpenCandle vs Spreadsheets

Spreadsheets are the right home for owned models and repeatable calculations. They are less ergonomic for conversational investigation and ad hoc evidence gathering.

| Capability | OpenCandle | Spreadsheet |
| --- | --- | --- |
| Evidence gathering | Prompts route to explicit finance tools | Manual imports, formulas, plugins, or pasted data |
| Missing or stale data | Surfaced in the session | Tracked manually, if at all |
| Repeatable models | Not the goal; findings feed your own models | Best fit for valuation, allocation, and scenario models |

Use them together: OpenCandle gathers the facts and caveats, then stable assumptions move into a workbook where you control every formula.

## OpenCandle vs Custom Scripts

Custom scripts fit a stable workflow with a known provider and fixed output shape, and get brittle when the question changes or a provider returns partial data. OpenCandle keeps the explicit-tool benefits while routing conversationally across quote, filing, options, macro, sentiment, and portfolio tools, and records degraded sources in the session.

## When OpenCandle Is Not The Right Tool

Use something else when you need order routing, regulated financial advice, high-frequency trading infrastructure, proprietary terminal data, or fully automated investment decisions. OpenCandle is built for research and evidence inspection, not execution.

Use a spreadsheet or notebook when the primary task is maintaining a model you already understand. Use a finance terminal or paid data feed when the binding requirement is proprietary data coverage, exchange licensing, or institutional workflow integration.
