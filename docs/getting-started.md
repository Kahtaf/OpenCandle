---
title: Getting Started
description: Install OpenCandle, configure providers, and run the CLI or GUI.
---

# Getting Started

OpenCandle runs as an interactive Pi agent in the terminal and as a local browser GUI. The CLI is the primary entry point; the GUI is a local workbench for chat, tool discovery, provider status, session history, and financial context.

## Requirements

- Node.js `^20.19.0`, `^22.12.0`, or `>=24.0.0 <27`
- One supported model provider configured through Pi
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
cp .env.example .env
npm start
```

On first run, OpenCandle walks through model setup. You can rerun setup later from inside the agent with `/setup`.

## Run the Local GUI

From a source checkout:

```bash
npm run gui
```

From an installed package:

```bash
opencandle gui
```

Then open `http://127.0.0.1:14567`. The GUI binds locally and shares Pi sessions through a writer/follower lock so only one process mutates a session at a time.

## Configure Providers

Model credentials are handled by Pi. OpenCandle-specific provider keys can come from environment variables or `~/.opencandle/config.json`.

| Key | Required | Used for |
| --- | --- | --- |
| `GEMINI_API_KEY` | No | Google models through Pi |
| `OPENAI_API_KEY` | No | OpenAI models through Pi |
| `ANTHROPIC_API_KEY` | No | Anthropic models through Pi |
| `ALPHA_VANTAGE_API_KEY` | No | Fundamentals, earnings, financial statements |
| `FRED_API_KEY` | No | Macro series such as rates, CPI, GDP, unemployment |
| `BRAVE_API_KEY` | No | Brave web search fallback |
| `EXA_API_KEY` | No | Exa web search |
| `FINNHUB_API_KEY` | No | Finnhub company news for sentiment summaries |

Yahoo Finance, CoinGecko, Reddit, SEC EDGAR, DuckDuckGo search, and Fear & Greed data do not require keys.

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
    }
  }
}
```

Environment variables override `~/.opencandle/config.json`. Set `OPENCANDLE_HOME` to store OpenCandle state somewhere other than `~/.opencandle/`.

## First Investigations

```text
What is AAPL trading at?
Run /analyze NVDA
Compare BTC and ETH over the last month
Show MSFT puts with Greeks
Get CPI from FRED
Add 100 shares of NVDA at 120 to my portfolio, then show my portfolio
```

OpenCandle should tell you when a provider is unavailable, a key is missing, or a result is degraded. Treat those warnings as part of the answer.

## Validate a Checkout

```bash
npm test
npm run gui:web:build
npm run docs:site:build
```

Use `npm run test:e2e` and `npm run test:e2e:providers` only when you intentionally want tests that hit live providers.
