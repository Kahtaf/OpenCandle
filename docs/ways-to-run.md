---
title: Ways to Run OpenCandle
description: The web app, the local GUI, and the terminal compared, so you can pick by how much you want to install.
---

# Ways to Run OpenCandle

OpenCandle is one product with one agent, and you can run it three ways: the web app at web.opencandle.app, the local GUI, and the terminal (TUI). All three fetch real market data before the model writes an answer. Pick by how much you want to install.

| | Web app | Local GUI | Terminal |
| --- | --- | --- | --- |
| Get started | Open web.opencandle.app | `npx opencandle@latest gui` | `npx opencandle@latest` |
| Install anything | No | Node.js 22.19+ | Node.js 22.19+ |
| Model access | OpenAI, Anthropic, or Google API key | Same, plus Pi sign-in | Same, plus Pi sign-in |
| Market data | Most sources (see note below the table) | All sources | All sources |
| Charts, dashboard, symbol pages | Yes | Yes | Text answers |
| Watchlists, portfolios, alerts, reports | Yes | Yes | Yes |
| Alert checks in the background | No. Manual checks and on-demand reports only | Yes, while running, plus `opencandle monitor` | Yes, same as the local GUI |
| Where your data lives | In your browser | On your computer (`~/.opencandle`) | On your computer (`~/.opencandle`) |
| Works offline | Read and export saved research | No | No |
| Browser support | Current Chromium-based desktop browser (Chrome, Edge, Arc, Brave) | Any modern browser | n/a |

"Most sources" means the web app covers nearly everything, with two exceptions: SEC filings and X/Reddit sentiment need the local app. Alpha Vantage, FRED, Finnhub, London Strategic Edge, and Brave need your own free or paid key on every surface.

Moving between them is easy in one direction and manual in the other. The local GUI and the terminal share the same sessions and saved state, so you can switch mid-investigation. The web app keeps its own data in your browser; you can export it and open sessions locally. See the [Web App Quickstart](./hosted-pwa.md).

Entering an API key into a website is a real decision. [How the Web App Works](./how-the-web-app-works.md) explains exactly where your key lives and what leaves your browser.

To install locally, see [Getting Started](./getting-started.md).
