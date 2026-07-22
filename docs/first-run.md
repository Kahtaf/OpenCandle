---
title: First Run
description: Get from a fresh OpenCandle install to a successful first market answer in about five minutes.
---

# First Run

This path assumes you want the fastest successful run: connect one AI model, ask a keyless market-data prompt, and only add data-provider keys when OpenCandle tells you they would improve the answer.

Model credentials and market-data provider keys are separate. OpenCandle needs a model before chat can start. A keyless market-data prompt means the market data source does not need an OpenCandle provider key; it does not mean the agent can run without model access.

[Pi](https://github.com/earendil-works/pi) is the bundled local agent runtime that handles model sign-in, model keys, the terminal shell, and saved sessions. OpenCandle uses Pi for that runtime layer and adds the finance-specific tools and GUI.

## Five-Minute Path

1. Install and start the OpenCandle GUI.

```bash
npx opencandle@latest gui
```

From a source checkout, use:

```bash
npm install
npm run gui
```

Prefer the terminal? Start the equally complete TUI with `npx opencandle@latest` or `npm start` from a source checkout.

The first launch needs network access; Pi downloads two small helper binaries into `~/.pi/agent/bin`.

2. Connect an AI model when the setup prompt opens.

In the GUI, use the browser setup panel to connect an OpenAI, Anthropic, or Google API key. OpenCandle needs a model before chat can start. If you prefer Pi sign-in, run `/setup` in the terminal first, then refresh the GUI. The TUI also supports API-key setup directly.

3. Start with a keyless market-data prompt.

```text
What is AAPL trading at?
Compare BTC and ETH over the last month
What is the latest SEC filing for AAPL?
```

Yahoo Finance, CoinGecko, SEC EDGAR, and several other sources work without provider keys; Reddit and Twitter/X sentiment use the `rdt-cli` and `twitter-cli` tools with your normal browser sessions. See [Data Sources](./data-sources.md#keyed-and-keyless-sources) for the full list and caveats.

4. Add provider keys only when needed.

If an answer says a provider is missing or degraded, open Providers in the GUI. Terminal users can follow the suggested `/connect ...` command. Common examples:

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

OpenCandle uses Pi for model credentials and model selection. The GUI setup panel accepts API keys for OpenAI, Anthropic, or Google models. In the equally complete terminal interface, you can use Pi sign-in or an API key. Model credentials are stored by Pi; OpenCandle data-provider keys are separate and live in environment variables or `~/.opencandle/config.json`.

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

1. Use a supported Node.js version: 22.19+ (22.x) or 24–26.
2. Retry a clean install.
3. Run `npm rebuild better-sqlite3` after switching Node versions.
4. Install platform build tools if npm has to compile native modules locally.
