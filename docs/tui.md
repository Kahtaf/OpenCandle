---
title: TUI Quickstart
description: Use the OpenCandle terminal interface, slash commands, sessions, and the local GUI together.
---

# TUI Quickstart

The TUI is OpenCandle's equally complete terminal interface for users who prefer a keyboard-first workflow. It runs the same finance tools and workflows as the local GUI, with the same saved sessions, provider-backed evidence, setup, tool calls, and local market state.

OpenCandle runs on [Pi](https://github.com/earendil-works/pi), the local agent runtime that provides the terminal UI, model auth, session storage, slash commands, and extension hooks. OpenCandle contributes the finance-specific tools, workflows, prompts, and local state.

Start it with:

```bash
opencandle
```

From a source checkout:

```bash
npm start
```

## Basics

Type a question and press Enter. OpenCandle identifies what kind of financial investigation you are asking for, gathers provider-backed evidence when useful, and then asks the model to synthesize. Tools fetch and format evidence; the model writes the answer.

If a ticker, goal, horizon, budget, or risk preference is missing and materially changes the answer, OpenCandle may ask a focused follow-up before continuing. If a provider is missing, stale, or unavailable, the answer should name that gap instead of hiding it.

Slash commands are optional. Plain-English prompts trigger the same investigation paths:

```text
Analyze NVDA and tell me whether to buy, wait, or avoid.
I already own VOO and QQQ. Would SCHD diversify me?
I own 200 shares of AMD. What protective put should I consider?
Is this SPY/MSFT retirement portfolio too risky?
```

If a provider key would improve the result, OpenCandle should name the gap and suggest a `/connect ...` command.

## Slash Commands

| Command | Use it for |
| --- | --- |
| `/setup` | Re-run AI model setup. Use this when chat cannot start, auth changed, or you want a different setup path. |
| `/login` | Sign in to a model provider through Pi. If your Pi version doesn't offer sign-in, use `/setup` with an API key instead. |
| `/model` | Switch between models that are already available through Pi. |
| `/connect` | Connect OpenCandle data providers. Run it bare for a picker, or pass a provider name or category (below). |
| `/new` | Start a fresh session. |
| `/analyze <ticker>` | Run the multi-analyst stock workflow for one ticker, for example `/analyze NVDA`. |

### `/connect` Targets

`/connect` accepts a provider name, a friendly alias, or a category. Categories with more than one provider open a sub-picker.

| Target | Provider(s) | Unlocks |
| --- | --- | --- |
| `financials`, `fundamentals`, `alphavantage` | Alpha Vantage | Fundamentals, earnings, financial statements, DCF, comps |
| `lse`, `london strategic edge` | London Strategic Edge | Free-tier financial statements plus deep split-adjusted intraday history back to 2003 |
| `economy`, `macro`, `fred` | FRED | Macro series: rates, CPI, GDP, unemployment |
| `news`, `finnhub` | Finnhub | Company news in sentiment summaries |
| `search` (category), `brave`, `exa` | Brave Search, Exa | Expanded web search beyond keyless DuckDuckGo |
| `yahoo`, `market-data` | Yahoo Finance | Keyless; listed for diagnostics |
| `polymarket`, `prediction-markets`, `event-probabilities` | Polymarket Gamma API | Keyless event probabilities |
| `tradingview`, `tradingview-scanner`, `screener` | TradingView scanner | Keyless stock screening |
| `reddit`, `twitter` / `x` | Reddit, X/Twitter | Sentiment via `rdt-cli` / `twitter-cli` browser sessions |

`/setup` and `/model` are about the AI model. `/connect` is about market-data providers.

## Sessions

OpenCandle stores session history through Pi and keeps OpenCandle user state under `~/.opencandle/` unless `OPENCANDLE_HOME` is set. A session can include normal chat messages, slash-command output, tool results, provider-gap notes, and the always-visible financial disclaimer.

Running plain `opencandle` resumes the most recent Pi session for the current working directory. To start a fresh session from inside the TUI, run `/new`.

The local GUI reads the same session state as the terminal UI, so you can use both at once. If a view says it is reconnecting or syncing, wait a moment and retry.

## Terminal and the Local GUI

The local GUI is the primary path and the best place to inspect charts, research cards, provider status, saved market state, and prior sessions visually. Start it with:

```bash
opencandle gui
```

From a source checkout:

```bash
npm run gui
```

Then open `http://127.0.0.1:14567`. The local GUI shares the same underlying sessions as the terminal. The web app at web.opencandle.app also exists, but it runs in your browser and does not share local sessions; see [Ways to Run OpenCandle](./ways-to-run.md).

Use the TUI when you prefer the fastest keyboard-driven loop, setup and slash commands, or a plain transcript. It remains feature-complete for financial investigations: prompts route through the same tools and workflows, and the results retain the same evidence, provider gaps, watchlists, portfolios, alerts, and reports.
