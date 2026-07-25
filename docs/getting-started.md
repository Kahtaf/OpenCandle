---
title: Getting Started
description: Install OpenCandle, start the local GUI, and use the equally complete terminal interface when you prefer it.
---

# Getting Started

OpenCandle runs primarily as a local browser GUI, backed by the bundled [Pi](https://github.com/earendil-works/pi) agent runtime. The GUI is the primary path: it brings chat, visual tool results, workflows, provider status, session history, charts, watchlists, portfolios, alerts, and reports into one workspace. Users who prefer the terminal get an equally complete TUI over the same tools, workflows, saved state, and evidence trail.

OpenCandle is read-only research software. It does not place trades, route orders, or provide financial advice.

## Requirements

- [Node.js](https://nodejs.org) 22.19+ (22.x) or 24–26
- One supported model provider configured through Pi: OpenAI, Anthropic, or Google
- Optional market data provider keys for expanded coverage

## Install

```bash
npm install -g opencandle
opencandle gui
```

You can also run the latest package without a global install:

```bash
npx opencandle@latest gui
```

From a source checkout:

```bash
npm install
cp .env.example .env # optional
npm run gui
```

On Windows Command Prompt, use `copy .env.example .env` instead of `cp .env.example .env`. OpenCandle stores local state in `~/.opencandle` on macOS/Linux and `%USERPROFILE%\.opencandle` on Windows unless `OPENCANDLE_HOME` is set.

On first run, the GUI opens model setup before chat. The terminal interface also supports Pi sign-in and `/setup`.

For the fastest successful path, follow [First Run](./first-run.md). It shows a keyless first prompt, what success looks like, and how to handle common setup failures, including native `better-sqlite3` install errors.

## Choose Your Interface

Start with the GUI for the visual investigation workspace: chat, workflow cards, charts, tool results, provider setup, session history, and financial context in one browser tab.

Choose the TUI when you prefer a keyboard-first loop, slash commands, or a plain terminal transcript. It is not a reduced mode: it uses the same OpenCandle tools, workflows, saved session state, and provider-backed evidence. You can move between both interfaces during the same investigation.

## Run the Local GUI

From a source checkout:

```bash
npm run gui
```

From an installed package:

```bash
opencandle gui
```

Then open `http://127.0.0.1:14567`. The GUI binds locally and shares Pi sessions with the terminal UI.

Good first GUI flow:

1. Ask `What is AAPL trading at?`
2. Open the tool and workflow catalog with `⌘K` (macOS) or `Ctrl+K` (Windows/Linux).
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

Yahoo Finance, CoinGecko, SEC EDGAR, and several other sources need no keys; Reddit and Twitter/X sentiment use the `rdt-cli` and `twitter-cli` tools with your normal browser sessions. See [Data Sources](./data-sources.md#keyed-and-keyless-sources) for the full list and caveats.

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
/analyze NVDA   # deep research: multi-analyst debate, takes a few minutes
```

OpenCandle should tell you when a provider is unavailable, a key is missing, or a result is degraded. Treat those warnings as part of the answer.

For the equally complete keyboard-first path, slash commands, and terminal session behavior, see [TUI](./tui.md). Contributors validating a source checkout should follow [Testing and Evals](./testing-and-evals.md).
