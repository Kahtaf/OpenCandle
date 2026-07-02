---
title: TUI
description: Use the OpenCandle terminal interface, slash commands, sessions, and the local GUI together.
---

# TUI

The terminal UI is the main OpenCandle agent experience. It runs chat, setup, slash commands, tool calls, and session state in one place.

OpenCandle runs on Pi, the local agent runtime that provides the terminal UI, model auth, session storage, slash commands, and extension hooks. OpenCandle contributes the finance-specific tools, workflows, prompts, and local state.

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

Good first prompts:

```text
What is AAPL trading at?
/analyze NVDA
Compare MSFT and GOOGL using price, fundamentals, and sentiment
Show me TSLA puts with Greeks
Get the fed funds rate from FRED
```

Slash commands are optional. Plain-English prompts can trigger the same investigation paths:

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
| `/login` | Sign in to a model provider through Pi when supported by your local Pi install. |
| `/model` | Switch between models that are already available through Pi. |
| `/connect` | Connect OpenCandle data providers such as Alpha Vantage, FRED, Finnhub, Brave, or Exa. Run it bare for a picker, or pass a provider/category such as `/connect economy`. |
| `/analyze <ticker>` | Run the multi-analyst stock workflow for one ticker, for example `/analyze NVDA`. |

`/setup` and `/model` are about the AI model. `/connect` is about market-data providers. Keeping those separate makes setup easier to debug.

## Sessions

OpenCandle stores session history through Pi and keeps OpenCandle user state under `~/.opencandle/` unless `OPENCANDLE_HOME` is set. A session can include normal chat messages, slash-command output, tool results, provider-gap notes, and the always-visible financial disclaimer.

The local GUI reads the same Pi session state as the terminal UI. OpenCandle coordinates local browser and terminal surfaces so prompts and supported session actions are forwarded to the active session owner when needed. If a view is reconnecting or syncing, wait for the current run to settle and retry.

## CLI vs GUI

Use the TUI when you want the fastest keyboard-driven agent loop, setup commands, or a plain transcript in your terminal.

Use the GUI when you want a local browser workbench: chat history, tool catalog, provider status, session navigation, and richer cards for market data. Start it with:

```bash
opencandle gui
```

From a source checkout:

```bash
npm run gui
```

Then open `http://127.0.0.1:14567`. The GUI is local-only and shares the same underlying sessions as the terminal.
