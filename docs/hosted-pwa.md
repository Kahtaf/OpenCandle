---
title: Web App Quickstart
description: Use OpenCandle at web.opencandle.app with nothing to install.
---

# Web App Quickstart

Open [https://web.opencandle.app](https://web.opencandle.app), connect a model API key, and ask a market question. There is nothing to install; it runs in a current Chromium-based desktop browser (Chrome, Edge, Arc, Brave). How it handles your key and data is explained in [How the Web App Works](./how-the-web-app-works.md).

Privacy blockers that block the in-browser runtime can prevent the web app from starting; allow the site if it fails to load.

## Connect a model

Connect an OpenAI, Anthropic, or Google API key. You choose where each key stays: on this device, or only for this browser session. A session-only key stays in the tab where you entered it. Keys are validated with the provider before being saved.

Browser storage is not a secure vault; choose session-only on shared machines. See [How the Web App Works](./how-the-web-app-works.md) for the details.

## What works, and what needs the local app

The web app runs the full agent: chat, workflows like `/analyze`, charts, symbol pages, watchlists, portfolios, alerts, reports, web search and sentiment evidence, crypto, and prediction markets. Optional keyed providers work too: add your own Alpha Vantage, FRED, Finnhub, London Strategic Edge, or Brave key in Settings and their tools unlock, the same as locally.

A few things need the local app: SEC filings, X and Reddit sentiment, background alert monitoring and webhook delivery, and shell or add-on tools. Alert checks and reports on the web app run only when you ask; nothing runs on a schedule or after the tab closes.

See [Ways to Run OpenCandle](./ways-to-run.md) for the side-by-side table.

## Install it as an app

Install OpenCandle from your browser's menu to get it as a standalone app (a PWA). While offline, saved research stays readable and exportable. Updates download in the background and offer an Install update control when one is ready.

## Your data

Settings > Data and privacy gives you:

- **Export**: one file with your sessions and saved state, never your keys.
- **Import**: restore an exported file.
- **Clear secrets**: remove all keys without deleting research.
- **Clear all**: remove everything for this site. It asks you to type DELETE to confirm.

Multiple tabs are fine; one tab does the work and the others follow along.

## Move research to the local app

Exports use the same session format as local OpenCandle. Extract a session file from the export archive and open it with the local app. There is no live sync between the web app and a local install.
