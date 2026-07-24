---
title: Comparisons
description: Compare OpenCandle with general chatbots, finance websites, spreadsheets, and custom scripts.
---

# Comparisons

OpenCandle is best compared with the tools people already use for market research: a general chatbot, a browser full of finance sites, a spreadsheet, or custom scripts. OpenCandle is different because it gathers provider-backed evidence through explicit finance tools, tells you when a data source was missing, stale, or degraded, and then asks the model to synthesize from the evidence trail.

OpenCandle is read-only research software. It does not place trades, route orders, or provide financial advice.

## OpenCandle vs ChatGPT and General Chatbots

A general chatbot can explain concepts, organize a thesis, and help write analysis, but it does not automatically call finance tools, track local portfolio state, or show a provider-by-provider evidence trail unless you build that workflow yourself.

OpenCandle uses model providers for synthesis, but the finance workflow starts with explicit tools for quotes, options, filings, macro data, sentiment, fundamentals, crypto data, and portfolio context. Quote answers show the provider and timestamp. Filing answers link to [SEC EDGAR](https://www.sec.gov/edgar/search/) results, options answers preserve per-share versus per-contract context, macro answers name the [FRED](https://fred.stlouisfed.org) series, and portfolio answers separate saved local holdings from new input.

| Capability | OpenCandle | General chatbot |
| --- | --- | --- |
| Finance tools | Built-in tool calls for market, macro, options, filings, sentiment, fundamentals, crypto, and portfolio workflows | Depends on plan, connectors, browsing mode, or custom setup |
| Missing/stale data disclosure | Preserved in the session and answer context | Usually manual unless a custom workflow records them |
| Local portfolio state | Supported through OpenCandle state | Requires a separate file, spreadsheet, or connector |
| Local browser GUI and equally complete terminal TUI | Yes | No |

Use a general chatbot when the task is mostly writing, education, brainstorming, or turning already-collected facts into a cleaner explanation. Use OpenCandle when the task depends on current or inspectable financial evidence.

## OpenCandle vs Finance Websites

Finance websites are strong for single-source lookup: a quote page, a filing page, a chart, or a news feed. They become slower when a question needs evidence from several domains at once.

OpenCandle is useful when the research path crosses sources. A single investigation can combine a quote snapshot, SEC EDGAR filings, FRED macro series, option chain data, Reddit or web sentiment, and local portfolio state. The answer can then cite the gathered evidence and call out gaps instead of leaving the user to reconcile tabs manually.

## OpenCandle vs Spreadsheets

Spreadsheets are excellent for owned models, repeatable calculations, and portfolio tracking. They are less ergonomic for conversational investigation, provider degradation, and ad hoc evidence gathering.

| Capability | OpenCandle | Spreadsheet |
| --- | --- | --- |
| Evidence gathering | Agent routes prompts to explicit finance tools | Manual imports, formulas, plugins, or pasted data |
| Missing/stale data disclosure | Surfaced in the session | Usually tracked manually in notes or formulas |
| Repeatable models | Not the goal; findings feed into your own models | Best fit for durable valuation, allocation, and scenario models |

Use them together: OpenCandle gathers the facts and caveats, then stable assumptions move into a spreadsheet. Discounted cash flow models, position sizing tables, tax lots, and rebalancing plans belong in a workbook where you control every formula.

## OpenCandle vs Custom Scripts

Custom scripts are ideal when a team has a stable workflow, a known provider, and a fixed output shape. They can be brittle when the question changes or the provider returns partial data.

OpenCandle keeps the script-like benefits of explicit tools while adding a conversational routing layer. It can choose a quote lookup, filing search, options read, macro pull, sentiment summary, or portfolio review based on the prompt, then record degraded sources in the same session.

## Where OpenCandle Should Shine

OpenCandle does its best work when the answer depends on current quote, options, filing, macro, sentiment, or crypto data.

Generic agents may still win when a prompt is purely educational, needs no current data, or rewards a shorter explanation over inspectable evidence. OpenCandle's [competitive benchmark](./testing-and-evals.md#competitive-benchmarking) is designed to keep that comparison honest.

## When OpenCandle Is Not The Right Tool

Use something else when you need order routing, regulated financial advice, high-frequency trading infrastructure, proprietary terminal data, or fully automated investment decisions. OpenCandle is built for research and evidence inspection, not execution.

Use a spreadsheet or notebook when the primary task is a model you already understand and need to maintain over time. Use a finance terminal or paid data feed when the binding requirement is proprietary data coverage, exchange licensing, or institutional workflow integration.
