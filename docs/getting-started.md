---
title: Getting Started
description: Install OpenCandle, configure providers, and run the CLI or GUI.
---

# Getting Started

OpenCandle runs as an interactive [Pi](https://github.com/earendil-works/pi) agent in the terminal and as a local browser GUI. Pi is the bundled local agent runtime that handles model setup, the terminal shell, and saved sessions; OpenCandle adds the financial tools and workflows on top. The CLI is the primary entry point; the GUI is a local workbench for chat, tool discovery, provider status, session history, and financial context.

OpenCandle is read-only research software. It does not place trades, route orders, or provide financial advice.

## Requirements

- [Node.js](https://nodejs.org) 22.19+ or 24–26
- One supported model provider configured through Pi: OpenAI, Anthropic, or Google
- Optional market data provider keys for expanded coverage

## Install

```bash
npm install -g opencandle
opencandle
```

You can also run the latest package without a global install:

```bash
npx opencandle@latest
```

From a source checkout:

```bash
npm install
cp .env.example .env # optional
npm start
```

On Windows Command Prompt, use `copy .env.example .env` instead of `cp .env.example .env`. OpenCandle stores local state in `~/.opencandle` on macOS/Linux and `%USERPROFILE%\.opencandle` on Windows unless `OPENCANDLE_HOME` is set.

On first run, OpenCandle walks through model setup. You can rerun setup later from inside the agent with `/setup`.

For the fastest successful path, follow [First Run](./first-run.md). It shows a keyless first prompt, what success looks like, and how to handle common setup failures — including native `better-sqlite3` install errors.

## Choose Your Interface

Use the terminal UI when you want the fastest keyboard loop, slash commands, and a plain transcript.

Use the GUI when you want a visual investigation workspace: chat, workflow cards, tool results, provider setup, session history, and financial context in one browser tab.

Both use the same OpenCandle tools and saved session state. You can start in the terminal and later inspect sessions in the GUI.

## Run the Local GUI

From a source checkout:

```bash
npm run gui
```

From an installed package:

```bash
opencandle gui
```

Then open `http://127.0.0.1:14567`. The GUI binds locally and shares Pi sessions with the terminal UI. OpenCandle coordinates local browser and terminal surfaces automatically so actions stay attached to the active session.

Good first GUI flow:

1. Ask `What is AAPL trading at?`
2. Open the catalog with `⌘K` on macOS or `Ctrl+K` on Windows/Linux.
3. Pick a workflow such as Comprehensive Analysis or Compare Assets.
4. Inspect the tool card details to see what data was used.
5. Open the provider tab if the answer says a data source is missing.

See [GUI Quickstart](./gui-quickstart.md) for catalog usage, health checks, Tailscale access, and local session coordination.

## Configure Providers

Model credentials and data-provider keys are separate. OpenCandle needs one model provider before chat can start; every data-provider key is optional.

Model credentials, handled by Pi (sign-in or one of these keys):

| Key | Required | Used for |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | One model provider required | Anthropic models through Pi |
| `OPENAI_API_KEY` | One model provider required | OpenAI models through Pi |
| `GEMINI_API_KEY` | One model provider required | Google models through Pi |

Data-provider keys, from environment variables or `~/.opencandle/config.json`:

| Key | Required | Used for |
| --- | --- | --- |
| `ALPHA_VANTAGE_API_KEY` | No | Fundamentals, earnings, financial statements |
| `FRED_API_KEY` | No | Macro series such as rates, CPI, GDP, unemployment |
| `BRAVE_API_KEY` | No | Brave web search fallback |
| `EXA_API_KEY` | No | Exa web search |
| `FINNHUB_API_KEY` | No | Finnhub company news for sentiment summaries |
| `LSE_API_KEY` | No | London Strategic Edge financial statements and deep intraday/long-range history |

[Yahoo Finance](https://finance.yahoo.com), [TradingView](https://www.tradingview.com) scanner, [Polymarket](https://polymarket.com) Gamma API, [CoinGecko](https://www.coingecko.com), [SEC EDGAR](https://www.sec.gov/edgar/search/), [DuckDuckGo](https://duckduckgo.com) search, and the [alternative.me crypto Fear & Greed index](https://alternative.me/crypto/fear-and-greed-index/) do not require keys. Reddit sentiment uses [`rdt-cli`](https://github.com/public-clis/rdt-cli) plus your normal Reddit browser session; Twitter/X sentiment uses [`twitter-cli`](https://github.com/public-clis/twitter-cli) plus your normal x.com browser session. See [Data Sources](./data-sources.md#keyed-and-keyless-sources) for the canonical keyless-source list and caveats.

Example config:

```json
{
  "providers": {
    "alphaVantage": {
      "apiKey": "..."
    },
    "fred": {
      "apiKey": "..."
    },
    "brave": {
      "apiKey": "..."
    },
    "exa": {
      "apiKey": "..."
    },
    "finnhub": {
      "apiKey": "..."
    },
    "lse": {
      "apiKey": "..."
    }
  }
}
```

Environment variables override `~/.opencandle/config.json`. Set `OPENCANDLE_HOME` to store OpenCandle state somewhere other than `~/.opencandle/`.

See [Configuration](./configuration.md) for the complete env var list, config precedence, state files, and GUI host/port settings.

## First Investigations

```text
What is AAPL trading at?
Compare BTC and ETH over the last month
Show MSFT puts with Greeks
Get CPI from FRED
Add 100 shares of NVDA at 120 to my portfolio, then show my portfolio
Run /analyze NVDA when you want deep research — a multi-analyst debate that takes a few minutes
```

OpenCandle should tell you when a provider is unavailable, a key is missing, or a result is degraded. Treat those warnings as part of the answer.

For slash commands, session behavior, and CLI-vs-GUI tradeoffs, see [TUI](./tui.md). Contributors validating a source checkout should follow [Testing and Evals](./testing-and-evals.md).
