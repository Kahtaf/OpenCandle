---
title: How the Web App Works
description: What runs in your browser, where your keys and data live, and what leaves your device.
---

# How the Web App Works

The web app at web.opencandle.app asks for your model API key, so you deserve a precise answer about where that key goes. The short version: everything runs in your browser, there is no OpenCandle server, and the code is open source.

## Everything runs in your browser

The agent is the same OpenCandle that runs locally. It executes inside your browser tab in an in-browser Node.js runtime (WebContainer, by StackBlitz). The published site is static files. There is no OpenCandle application server, no database on our side, and no account.

## Where your API key lives

When you connect a key you choose where it stays: on this device (browser storage) or only for this browser session (cleared when the last tab closes). Keys are stored per provider in your browser only. They are never included in exports, saved sessions, or market state, and there is no OpenCandle server to send them to. Clear secrets in Settings removes them and restarts the in-browser runtime so nothing retains them.

One honest caveat: browser storage is not a secure vault. A malicious extension or someone with access to your browser profile could read a saved key. Choose session-only storage on shared machines.

## The relay, and why it exists

Browsers block direct requests to some data and model APIs (a browser rule called CORS). A small Cloudflare Worker relays the few requests that need it.

The relay is deliberately narrow:

- It forwards only the supported model and data-provider endpoints, with strict request shape, size, and time limits. It is not a general-purpose proxy.
- It has no OpenCandle database, cache, account system, or application logs. Requests pass through in memory and are not retained by OpenCandle.
- Your key passes through Cloudflare in transit on its way to the provider, as it would through any HTTPS intermediary. Cloudflare may retain its own platform-level security or operational metadata under its policies; OpenCandle does not claim otherwise.

The relay source is open, and an automated audit test enforces its privacy and routing guarantees.

## Who is involved

- **OpenCandle**: the static site and the relay. Stores nothing, no accounts, no analytics or tracking.
- **Cloudflare**: hosts the static site and runs the relay. Traffic passes through it in transit.
- **StackBlitz**: provides the in-browser Node.js engine.
- **Data providers**: receive the same requests they would from a local install. Alpha Vantage, CoinGecko, and Polymarket are called directly from your browser.
- **ticker-line.com**: renders the small sparkline charts. Sees only ticker symbols.

## What is stored in your browser, and your controls

Saved sessions, watchlists, portfolios, alerts, and reports live in browser storage on your device. Settings > Data and privacy gives you:

- **Export**: one file with your sessions and saved state. It never contains keys.
- **Import**: restore an exported file.
- **Clear secrets**: remove all keys without deleting research.
- **Clear all**: remove everything for this site.

Offline, saved research stays readable and exportable.

## A simple picture

```text
Your browser
[your key + your saved research]
  |
  v
OpenCandle agent (runs in your tab)
  |
  +--> directly to some providers
  |
  +--> through the relay
       (passes through, stores nothing:
        no storage, no logs)
         |
         v
     model + data providers
```

The web app is the same open source code as the local app. If you want the strongest isolation, run OpenCandle locally: see [Getting Started](./getting-started.md).
