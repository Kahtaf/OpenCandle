---
title: Getting Started
description: Install OpenCandle, connect a model, and get a first market answer in about five minutes.
---

# Getting Started

OpenCandle runs three ways: the web app at web.opencandle.app, the local GUI, and the terminal (TUI). The fastest start is the web app, with nothing to install. Installing locally unlocks everything, including the SEC filings tool, X/Reddit sentiment, and background alert monitoring. See [Ways to Run OpenCandle](./ways-to-run.md) for the comparison.

This page covers the local install path. The local GUI is its primary interface: chat, visual tool results, workflows, charts, watchlists, portfolios, alerts, reports, and a settings page in one workspace, backed by the bundled [Pi](https://github.com/earendil-works/pi) agent runtime, which handles model sign-in, model keys, sessions, and the terminal shell. Users who prefer the terminal get an equally complete TUI over the same tools, workflows, saved state, and evidence trail.

> **No install needed?** To use OpenCandle in your browser right now, see the [Web App Quickstart](./hosted-pwa.md).

OpenCandle is read-only research software. It does not place trades, route orders, or provide financial advice.

## Requirements

To run locally:

- [Node.js](https://nodejs.org) 22.19+ (22.x) or 24–26
- One model provider: an OpenAI, Anthropic, or Google API key, or Pi sign-in
- Optional market-data provider keys for expanded coverage

The web app needs only a current Chromium-based desktop browser and a model API key.

OpenCandle is free and open source, and its core data sources need no keys. Model usage is billed by the model provider whose key or account you connect; OpenCandle adds no charge on top.

## Install and Start

```bash
npm install -g opencandle
opencandle gui       # browser GUI at http://127.0.0.1:14567
opencandle           # terminal (TUI)
```

You can also run without a global install with `npx opencandle@latest gui`, or from a source checkout with `npm install` followed by `npm run gui` (GUI) or `npm start` (terminal).

The first launch needs network access; Pi downloads small helper binaries into `~/.pi/agent/bin`. OpenCandle stores local state in `~/.opencandle` on macOS/Linux and `%USERPROFILE%\.opencandle` on Windows unless `OPENCANDLE_HOME` is set.

## Connect a Model

On first run, the GUI opens model setup before chat: connect an OpenAI, Anthropic, or Google API key. Chat cannot start without a model. If you prefer Pi sign-in, run `/setup` in the terminal first, then refresh the GUI. The TUI supports both paths directly.

Model credentials are stored by Pi. Market-data provider keys are separate, optional, and live in environment variables or `~/.opencandle/config.json`.

## Ask a Keyless First Prompt

```text
What is AAPL trading at?
Compare BTC and ETH over the last month
What is the latest SEC filing for AAPL?
```

Yahoo Finance, CoinGecko, SEC EDGAR, and several other sources work without provider keys; Reddit and Twitter/X sentiment use the `rdt-cli` and `twitter-cli` tools with your normal browser sessions. See [Data Sources](./data-sources.md#keyed-and-keyless-sources) for the full list and caveats.

A good first answer shows that OpenCandle gathered evidence before synthesizing: a current price, daily move, source or timestamp context, and explicit caveats when a provider was unavailable. Treat warnings, stale-data notes, and data gaps as part of the answer.

## Add Provider Keys When Needed

If an answer says a provider is missing or degraded, open Settings, then Data providers, in the GUI, or run the suggested `/connect ...` command in the terminal:

```text
/connect financials   # Alpha Vantage: fundamentals, earnings, statements
/connect economy      # FRED: rates, CPI, GDP, unemployment
/connect search       # Brave or Exa web search
```

The full `/connect` target list is in [TUI](./tui.md#connect-targets). Env var names, the `~/.opencandle/config.json` format, precedence rules, and state-file locations are in [Configuration](./configuration.md).

## Choose Your Interface

Start with the local GUI for the visual investigation workspace. Choose the TUI when you prefer a keyboard-first loop, slash commands, or a plain terminal transcript. It is not a reduced mode: it uses the same tools, workflows, saved session state, and provider-backed evidence, and you can move between both interfaces during the same investigation. The web app at web.opencandle.app is a third option when you want nothing installed. See [Ways to Run OpenCandle](./ways-to-run.md) for the comparison, plus [GUI Quickstart](./gui-quickstart.md) and [TUI Quickstart](./tui.md).

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Setup exits before chat starts | Start OpenCandle again and complete model setup. Chat requires a connected model. |
| A model key was rejected during setup | Check that the key matches the selected provider and paste a fresh key; rejected keys are not saved. |
| A provider key was rejected | Re-run the suggested `/connect ...` command and paste a fresh key. Rejected keys are not saved. |
| `/connect` says a provider is set by an environment variable | Update or unset that environment variable in your shell profile, or in the `.env` file in the launch directory if it is set there. Environment variables override `~/.opencandle/config.json`. |
| Fundamentals, macro, or premium news are missing | Connect the matching data provider. Alpha Vantage covers many fundamentals, FRED covers macro series, and Finnhub/Brave/Exa expand news or search coverage. |
| The GUI is open but not updating | Wait for any active run to settle, refresh the browser, or restart the GUI and reopen `http://127.0.0.1:14567`. |

### Native dependency (`better-sqlite3`)

OpenCandle stores local state with [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3), which uses a native module. Most users get a prebuilt binary during install. If npm reports a native build, ABI mismatch, or `node-gyp` failure:

1. Use a supported Node.js version: 22.19+ (22.x) or 24–26.
2. Retry a clean install.
3. Run `npm rebuild better-sqlite3` after switching Node versions.
4. Install platform build tools if npm has to compile native modules locally.

## Uninstall

```bash
npm uninstall -g opencandle
```

OpenCandle keeps its state in `~/.opencandle`; Pi keeps model credentials and sessions in `~/.pi`. Delete those directories to remove all local data.
