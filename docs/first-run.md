---
title: First Run
description: Get from a fresh OpenCandle install to a successful first market answer in about five minutes.
---

# First Run

This path assumes you want the fastest successful run: connect one AI model, ask a keyless market-data prompt, and only add data-provider keys when OpenCandle tells you they would improve the answer.

Model credentials and market-data provider keys are separate. OpenCandle needs a model before chat can start. A keyless market-data prompt means the market data source does not need an OpenCandle provider key; it does not mean the agent can run without model access.

[Pi](https://github.com/earendil-works/pi) is the bundled local agent runtime that handles model sign-in, model keys, the terminal shell, and saved sessions. OpenCandle uses Pi for that runtime layer and adds the finance-specific tools and GUI.

## Five-Minute Path

1. Install and start OpenCandle.

```bash
npx opencandle@latest
```

From a source checkout, use:

```bash
npm install
npm start
```

2. Connect an AI model when the setup prompt opens.

In the terminal, choose Pi sign-in when available or paste an API key. OpenCandle needs a model before chat can start. After a successful connection, it selects a fast default model when one is available; otherwise it asks you to choose a model.

If you start with `opencandle gui`, the browser setup panel currently supports model API keys. Users who prefer Pi sign-in should complete terminal `/setup` first, then refresh the GUI.

3. Start with a keyless market-data prompt.

```text
What is AAPL trading at?
Compare BTC and ETH over the last month
What is the latest SEC filing for AAPL?
```

[Yahoo Finance](https://finance.yahoo.com), [TradingView](https://www.tradingview.com) scanner, [Polymarket](https://polymarket.com) Gamma API, [CoinGecko](https://www.coingecko.com), [SEC EDGAR](https://www.sec.gov/edgar/search/), [DuckDuckGo](https://duckduckgo.com) search, and the [alternative.me crypto Fear & Greed index](https://alternative.me/crypto/fear-and-greed-index/) work without OpenCandle-specific provider keys. Reddit sentiment uses [`rdt-cli`](https://github.com/public-clis/rdt-cli) plus your normal Reddit browser session; Twitter/X sentiment uses [`twitter-cli`](https://github.com/public-clis/twitter-cli) plus your normal x.com browser session. See [Data Sources](./data-sources.md#keyed-and-keyless-sources) for the canonical keyless-source list and caveats.

4. Add provider keys only when needed.

If an answer says a provider is missing or degraded, follow the suggested `/connect ...` command. Common examples:

```text
/connect financials
/connect economy
/connect search
```

`financials` connects [Alpha Vantage](https://www.alphavantage.co), `economy` connects [FRED](https://fred.stlouisfed.org), and `search` picks between [Brave](https://brave.com/search/api/) and [Exa](https://exa.ai). The full list of `/connect` targets is in [TUI](./tui.md#connect-targets).

## What Success Looks Like

A good first answer should show that OpenCandle gathered evidence before synthesizing. For a quote prompt, expect a current price, daily move, timestamp or source context, and any caveats about availability. For a comparison prompt, expect per-asset data plus a short synthesis. If a provider was unavailable, the answer should say what was missing instead of pretending the data was complete.

OpenCandle is research software, not a financial advisor. Treat warnings, stale-data notes, and data gaps as part of the output.

## Model Setup Expectations

OpenCandle uses Pi for model credentials and model selection. In the terminal/TUI, you can connect with sign-in or with an API key for OpenAI, Anthropic, or Google models. In the GUI, use the API-key setup panel, or complete terminal `/setup` for sign-in based setup and refresh the browser. Model credentials are stored by Pi; OpenCandle data-provider keys are separate and live in environment variables or `~/.opencandle/config.json`.

Use `/setup` later if you want to reconnect auth or choose a different model setup path. Use `/model` when you only want to switch among models that are already available.

## Common Setup Failures

| Symptom | What to do |
| --- | --- |
| Setup exits before chat starts | Start OpenCandle again and complete model setup. Chat requires a connected model. |
| A model key was rejected during setup | Check that the key matches the selected provider and paste a fresh key; rejected keys are not saved. |
| A provider key was rejected | Re-run the suggested `/connect ...` command and paste a fresh key. Rejected keys are not saved. |
| `/connect` says a provider is set by an environment variable | Update or unset that environment variable in your shell profile, or in the `.env` file in the launch directory if it is set there. Environment variables override `~/.opencandle/config.json`. |
| Fundamentals, macro, or premium news are missing | Connect the matching data provider. Alpha Vantage covers many fundamentals, FRED covers macro series, and Finnhub/Brave/Exa expand news or search coverage. |
| The GUI is open but not updating | Wait for any active run to settle, refresh the browser, or restart the GUI and reopen `http://127.0.0.1:14567`. |

## Native Dependency Troubleshooting

OpenCandle stores local state with [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3), which uses a native module. Most users get a prebuilt binary during install. If npm reports a native build, ABI mismatch, or `node-gyp` failure:

1. Use a supported Node.js version: 22.19+ or 24–26.
2. Retry a clean install.
3. Run `npm rebuild better-sqlite3` after switching Node versions.
4. Install platform build tools if npm has to compile native modules locally.

On first launch, Pi downloads its `fd` and `ripgrep` helper binaries into `~/.pi/agent/bin`; that first launch needs network access.
