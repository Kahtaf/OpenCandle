---
title: OpenCandle Docs
description: Documentation for the open source financial investigator.
---

# OpenCandle Docs

OpenCandle is an open source financial investigator: a terminal agent and local browser workbench that fetches real market data before the model writes an answer.

It is read-only research software. It does not place trades, route orders, or provide financial advice.

## How OpenCandle Works

1. You ask a financial question in the terminal or GUI.
2. OpenCandle classifies the investigation and asks a follow-up only if a missing detail changes the answer.
3. Tools fetch quotes, filings, options, macro data, and sentiment. Gaps and stale data are surfaced.
4. The model writes an answer that separates facts from judgment and names the risks.

[Pi](https://github.com/earendil-works/pi) is the bundled agent runtime (model setup, sessions, terminal shell). OpenCandle adds the finance tools, workflows, providers, and local state on top. No separate Pi install needed.

## Start here

- [Why OpenCandle](./comparisons.md): how it compares to chatbots, finance sites, and spreadsheets.
- [Getting Started](./getting-started.md): requirements, install, provider keys.
- [First Run](./first-run.md): install to a keyless market answer in five minutes.
- [GUI Quickstart](./gui-quickstart.md): the local browser workbench.

## Guides and reference

- [Terminal (TUI)](./tui.md): terminal usage, slash commands, sessions.
- [Investigation Recipes](./investigation-recipes.md): repeatable research paths.
- [Data Sources](./data-sources.md): provider coverage and optional keys.
- [Configuration](./configuration.md): env vars, file config, state files.

## Build on it

- [System Architecture](./system-architecture.md): how questions become investigations and answers.
- [Build a Tool](./build-a-tool.md): first-party tools and add-on npm packages.
- [Testing and Evals](./testing-and-evals.md): tests, session quality, benchmarking.

## What OpenCandle Investigates

| Area | Examples |
| --- | --- |
| Market data | Quotes, price history, ticker lookup, crypto price and history |
| Options | Option chains, open interest, implied volatility, locally computed Greeks |
| Fundamentals | Company overview, financial statements, earnings, DCF, comparable companies |
| Macro | FRED series, rates, inflation, GDP, unemployment, crypto Fear & Greed |
| Sentiment | Reddit via `rdt-cli`, Twitter/X via `twitter-cli`, web search, and cross-source sentiment summaries |
| Filings | SEC EDGAR filing search |
| Portfolio | Watchlists, holdings, correlation, risk analysis |

## Operating Principles

- Evidence first. Show the data used; avoid unsupported conclusions.
- Tools fetch and format. The model synthesizes.
- Provider gaps stay visible: missing keys, stale data, degraded sources.
- Local state stays local, under `~/.opencandle/`.
- Contributions stay testable: fixtures and mocked fetch, not live APIs.

## Try it

```bash
opencandle
opencandle gui
```

First prompts:

```text
What is AAPL trading at?
Compare MSFT and GOOGL using price, fundamentals, and sentiment
Show me TSLA puts with Greeks
Get the fed funds rate from FRED
/analyze NVDA   # deep research: multi-analyst debate, takes a few minutes
```

OpenCandle gathers and organizes evidence. Judgment and risk stay with you.
