---
title: Comparisons
description: Compare OpenCandle with general chatbots, spreadsheets, finance websites, and custom scripts.
---

# Comparisons

OpenCandle is best compared with the tools people already use for market research: a general chatbot, a browser full of finance sites, a spreadsheet, or custom scripts. OpenCandle is different because it gathers provider-backed evidence through explicit finance tools, preserves provider gaps, and then asks the model to synthesize from the evidence trail.

OpenCandle is read-only research software. It does not place trades, route orders, or provide financial advice.

## OpenCandle vs ChatGPT

ChatGPT is a general assistant. It can explain concepts and help structure research, but it does not automatically call OpenCandle's finance tools, track local portfolio state, or show a provider-by-provider evidence trail unless you build that workflow yourself.

OpenCandle uses model providers for synthesis, but the finance workflow starts with explicit tools for quotes, options, filings, macro data, sentiment, fundamentals, crypto data, and portfolio context. This makes it better suited to questions where the user needs to know which data source was used, whether the source was stale, and which risks were visible before the final answer was written.

Read the focused comparison: [OpenCandle vs ChatGPT](./opencandle-vs-chatgpt.md).

## OpenCandle vs Finance Websites

Finance websites are strong for single-source lookup: a quote page, a filing page, a chart, or a news feed. They become slower when a question needs evidence from several domains at once.

OpenCandle is useful when the research path crosses sources. A single investigation can combine a quote snapshot, SEC EDGAR filings, FRED macro series, option chain data, Reddit or web sentiment, and local portfolio state. The answer can then cite the gathered evidence and call out gaps instead of leaving the user to reconcile tabs manually.

## OpenCandle vs Spreadsheets

Spreadsheets are excellent for owned models, repeatable calculations, and portfolio tracking. They are less ergonomic for conversational investigation, provider degradation, and ad hoc evidence gathering.

OpenCandle complements spreadsheets by handling the research loop before a model is built: identify the question, gather current evidence, surface missing inputs, and produce a risk-aware summary. When a spreadsheet is the right final artifact, OpenCandle can still be the first pass for finding the relevant facts and caveats.

Read the focused comparison: [OpenCandle vs Spreadsheets](./opencandle-vs-spreadsheets.md).

## OpenCandle vs Custom Scripts

Custom scripts are ideal when a team has a stable workflow, a known provider, and a fixed output shape. They can be brittle when the question changes or the provider returns partial data.

OpenCandle keeps the script-like benefits of explicit tools while adding a conversational routing layer. It can choose a quote lookup, filing search, options read, macro pull, sentiment summary, or portfolio review based on the prompt, then record degraded sources in the same session.

## When OpenCandle Is Not The Right Tool

Use something else when you need order routing, regulated financial advice, high-frequency trading infrastructure, proprietary terminal data, or fully automated investment decisions. OpenCandle is built for research and evidence inspection, not execution.

Use a spreadsheet or notebook when the primary task is a model you already understand and need to maintain over time. Use a finance terminal or paid data feed when the binding requirement is proprietary data coverage, exchange licensing, or institutional workflow integration.
