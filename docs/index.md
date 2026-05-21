---
title: OpenCandle Docs
description: Documentation for the open source financial investigator.
---

# OpenCandle Docs

OpenCandle is an open source financial investigator: a terminal-first agent and local browser workbench for gathering market evidence, inspecting tool output, and turning real provider data into research answers.

It is built for investors, builders, and researchers who want the speed of an agent without hiding the source data. Tools fetch and format market, macro, options, fundamentals, filings, sentiment, and portfolio data. The model synthesizes after the evidence is gathered.

## Start Here

- [Getting Started](./getting-started.md) for install, setup, and first investigations.
- [First Run](./first-run.md) for a five-minute path from install to a successful keyless market answer.
- [TUI](./tui.md) for terminal usage, slash commands, sessions, and CLI-vs-GUI tradeoffs.
- [Investigation Recipes](./investigation-recipes.md) for repeatable research paths.
- [Data Sources](./data-sources.md) for provider coverage, optional keys, and local state.
- [Configuration](./configuration.md) for env vars, file config, OpenCandle state files, and GUI runtime knobs.
- [GUI Quickstart](./gui-quickstart.md) for the local browser workbench.
- [System Architecture](./system-architecture.md) for routing, tools, providers, and runtime boundaries.
- [Build a Tool](./build-a-tool.md) for adding first-party tools or external add-on packages.
- [Testing and Evals](./testing-and-evals.md) for unit tests, harness traces, router fixtures, and live checks.
- [Benchmarking](./benchmarking.md) for comparing OpenCandle against generic no-tool agents.

## What OpenCandle Investigates

| Area | Examples |
| --- | --- |
| Market data | Quotes, price history, ticker lookup, crypto price and history |
| Options | Option chains, open interest, implied volatility, locally computed Greeks |
| Fundamentals | Company overview, financial statements, earnings, DCF, comparable companies |
| Macro | FRED series, rates, inflation, GDP, unemployment, crypto Fear & Greed |
| Sentiment | Reddit, Twitter/X local browser session, web search, cross-source sentiment summaries |
| Filings | SEC EDGAR filing search |
| Portfolio | Watchlists, holdings, correlation, prediction tracking, risk analysis |

## Operating Principles

- Evidence first. OpenCandle should show the data it used and avoid unsupported conclusions.
- Tools do not analyze. They fetch and format; analyst prompts and the model synthesize.
- Provider gaps are visible. Missing keys, stale data, and degraded sources should be surfaced.
- Local state stays local. OpenCandle user state lives under `~/.opencandle/` unless `OPENCANDLE_HOME` is set.
- Contributions stay testable. Unit tests use fixtures and mocked fetch calls, not live APIs.

## When To Use OpenCandle

Use OpenCandle when a question needs current or inspectable financial evidence: quotes, price history, options chains, filings, macro data, sentiment, watchlists, portfolio state, or a visible trail of what data was missing.

Use a generic agent when the question is purely educational, does not need current market data, and would be better served by a short conceptual explanation. OpenCandle is designed for auditable market research, not for pretending every finance question needs a tool call.

## Common Workflows

```bash
opencandle
opencandle gui
npm run gui
npm test
npm run docs:site:build
```

Inside the agent, start with prompts like:

```text
/analyze NVDA
What is AAPL trading at?
Compare MSFT and GOOGL using price, fundamentals, and sentiment
Show me TSLA puts with Greeks
Get the fed funds rate from FRED
```

OpenCandle is research software, not a financial advisor. It can gather and organize evidence, but final judgment and risk assessment remain with the user.
