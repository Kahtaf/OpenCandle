---
title: Getting Started
description: Install OpenCandle, configure providers, and run the CLI or GUI.
---

# Getting Started

OpenCandle runs as an interactive Pi agent in the terminal and as a local browser GUI. Pi is the bundled local agent runtime that handles model setup, the terminal shell, and saved sessions; OpenCandle adds the financial tools and workflows on top. The CLI is the primary entry point; the GUI is a local workbench for chat, tool discovery, provider status, session history, and financial context.

OpenCandle is read-only research software. It does not place trades, route orders, or provide financial advice.

## Requirements

- Node.js `>=22.19.0 <27`
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
cp .env.example .env
npm start
```

On Windows Command Prompt, use `copy .env.example .env` instead of `cp .env.example .env`. OpenCandle stores local state in `~/.opencandle` on macOS/Linux and `%USERPROFILE%\.opencandle` on Windows unless `OPENCANDLE_HOME` is set.

## Native Dependency Troubleshooting

OpenCandle uses `better-sqlite3`, a native dependency, for local state. Most installs use a prebuilt binary automatically. If install or startup fails with a native module, ABI, or `node-gyp` error:

1. Confirm your Node.js version matches the supported range above.
2. Retry from a clean install by removing `node_modules` and running `npm install` again.
3. Run `npm rebuild better-sqlite3` after changing Node versions.
4. Install your platform build tools if npm falls back to compiling native modules.

On first run, OpenCandle walks through model setup. You can rerun setup later from inside the agent with `/setup`.

For the fastest successful path, follow [First Run](./first-run.md). It shows a keyless first prompt, what success looks like, and how to handle common setup failures.

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

Then open `http://127.0.0.1:14567`. The GUI binds locally and shares Pi sessions through a writer/follower lock so only one process mutates a session at a time.

Good first GUI flow:

1. Ask `What is AAPL trading at?`
2. Open the catalog with `⌘K` on macOS or `Ctrl+K` on Windows/Linux.
3. Pick a workflow such as Comprehensive Analysis or Compare Assets.
4. Inspect the tool card or drawer to see what data was used.
5. Open the provider tab if the answer says a data source is missing.

See [GUI Quickstart](./gui-quickstart.md) for catalog usage, health checks, Tailscale access, and writer/follower behavior.

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

Yahoo Finance, CoinGecko, SEC EDGAR, DuckDuckGo search, and the alternative.me crypto Fear & Greed index do not require keys. Reddit sentiment uses `rdt-cli` plus your normal Reddit browser session; Twitter/X sentiment uses `twitter-cli` plus your normal x.com browser session.

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

See [Configuration](./configuration.md) for the complete env var list, config precedence, state files, and GUI host/port settings.

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

For slash commands, session behavior, and CLI-vs-GUI tradeoffs, see [TUI](./tui.md).

## Validate a Checkout

```bash
npm test
npm run gui:web:build
npm run docs:site:build
```

Use `npm run test:e2e` and `npm run test:e2e:providers` only when you intentionally want tests that hit live providers.
