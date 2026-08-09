# OpenCandle

OpenCandle is an open source financial investigator that uses real-time provider data to try to accurately answer financial questions. Use it at [web.opencandle.app](https://web.opencandle.app) with nothing to install, or install locally for the local GUI and the terminal (TUI).

[![CI](https://img.shields.io/github/actions/workflow/status/Kahtaf/OpenCandle/ci.yml?branch=main&label=CI)](https://github.com/Kahtaf/OpenCandle/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/opencandle)](https://www.npmjs.com/package/opencandle)
[![Node](https://img.shields.io/node/v/opencandle)](https://www.npmjs.com/package/opencandle)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

```bash
# Web app: open https://web.opencandle.app (nothing to install)
npx opencandle       # terminal
npx opencandle gui   # local browser UI at http://127.0.0.1:14567
```

[Docs](https://opencandle.app/docs/) | [Getting started](https://opencandle.app/docs/getting-started.html) | [GUI quickstart](https://opencandle.app/docs/gui-quickstart.html) | [Data sources](https://opencandle.app/docs/data-sources.html) | [Build a tool](https://opencandle.app/docs/build-a-tool.html)

## See It Work

https://github.com/user-attachments/assets/334956b1-18b4-4d6f-92b5-3f739824cd29

![OpenCandle GUI answering "How is NVDA doing today?" with a quote table, cited news sources, and the research steps panel open.](https://raw.githubusercontent.com/Kahtaf/OpenCandle/main/docs/images/gui-chat-research.png)

## Why OpenCandle

Generic LLMs answer too early. OpenCandle is built around the opposite loop: understand the question, gather market evidence, disclose missing or stale data, then synthesize.

Use it when a question needs inspectable evidence:

- What is this stock or crypto trading at right now?
- How do two companies compare across price action, fundamentals, filings, and sentiment?
- What does the options chain imply, and where are the Greeks?
- How exposed is my local portfolio or watchlist?
- What macro series, filings, or sentiment sources support the answer?

OpenCandle is read-only research software. It does not place trades, route orders, or provide financial advice.

## Features

- **Web app**: the same agent running in your browser at [web.opencandle.app](https://web.opencandle.app), with nothing to install and your data kept in the browser.
- **Terminal agent**: keyboard-driven research in the bundled [Pi](https://github.com/earendil-works/pi) TUI, with sessions, slash commands, and saved transcripts.
- **Local browser GUI**: chat with result cards and interactive charts, a market dashboard, per-ticker symbol pages, watchlists and portfolios with live sparklines.
- **Evidence-first answers**: tools fetch and format data; the model synthesizes only after evidence is gathered.
- **Finance routing**: quotes, comparisons, portfolio reviews, options, filings, macro, sentiment, and education each get a purpose-built research path.
- **Provider transparency**: missing keys, degraded sources, and stale data are disclosed instead of hidden.
- **Local state**: watchlists, portfolios, and alerts stay on your device, under `~/.opencandle/` for local installs and in browser storage for the web app.
- **Extensible**: typed TypeScript tool APIs for building and publishing add-on tools.

## Quick Start

Local installs require [Node.js](https://nodejs.org/) 22.19+ or 24–26. macOS and Linux are fully supported; Windows is best-effort (WSL recommended). The web app at [web.opencandle.app](https://web.opencandle.app) needs no install.

```bash
npx opencandle
```

On first run, OpenCandle walks you through model setup: use Pi sign-in when offered, or provide a model API key (in the GUI, use the API-key setup panel). Data-provider keys are separate and optional. For the five-minute path from install to a first answer, see [Getting Started](https://opencandle.app/docs/getting-started.html).

Check your setup anytime with `npx opencandle doctor` (or Settings, then Diagnostics, in the GUI).

## Example Prompts

```text
What is AAPL trading at?
Compare MSFT and GOOGL using price, fundamentals, and sentiment
Show me TSLA puts with Greeks
Get the fed funds rate from FRED
Add 100 shares of NVDA at 120 to my portfolio, then show my portfolio
Run risk analysis on SPY
/analyze NVDA   # deep research: multi-analyst debate, takes a few minutes
```

## Data Sources

Quotes, history, screeners, options chains, crypto, SEC filings, macro series, event probabilities, and cross-source sentiment, from Yahoo Finance, TradingView, CoinGecko, SEC EDGAR, FRED, Polymarket, alternative.me, and more. Most sources work without API keys; Alpha Vantage, FRED, Brave, Exa, Finnhub, and London Strategic Edge unlock deeper coverage when configured, and Reddit/Twitter sentiment uses `rdt-cli` / `twitter-cli` with your normal browser sessions. Full coverage tables in [Data Sources](https://opencandle.app/docs/data-sources.html).

## Configuration

Model access is configured through Pi on first run (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or Pi sign-in). Data-provider keys are optional and can be set in the environment, through `/connect`, through Settings, then Data providers, in the GUI, or in `~/.opencandle/config.json`; environment variables override the config file. See [Configuration](https://opencandle.app/docs/configuration.html) for the full key reference and advanced switches.

## How It Fits Together

![OpenCandle architecture diagram showing the user prompt flowing through OpenCandle routing, saved market state, finance data tools, evidence trace, a configured AI model, and external data sources.](https://raw.githubusercontent.com/Kahtaf/OpenCandle/main/assets/opencandle-architecture.png)

```text
User prompt
  -> routing and slot resolution
  -> tools and workflows gather provider-backed evidence
  -> provider gaps, stale data, and warnings are preserved
  -> model synthesizes a risk-aware answer
  -> terminal or GUI session records the trace
```

To add a first-party tool or publish an add-on package, start with [Build a Tool](https://opencandle.app/docs/build-a-tool.html).

## Development

```bash
git clone https://github.com/Kahtaf/OpenCandle.git
cd OpenCandle
npm install
cp .env.example .env   # optional provider keys (copy .env.example .env on Windows CMD)
npm start              # terminal agent
npm run gui            # browser GUI
npm test               # unit tests
```

Contributor conventions live in [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md). The e2e, provider, and eval suites can hit live APIs and model providers; run them intentionally, and see [Testing and Evals](https://opencandle.app/docs/testing-and-evals.html).

## Documentation

- [Getting Started](https://opencandle.app/docs/getting-started.html)
- [Ways to Run OpenCandle](https://opencandle.app/docs/ways-to-run.html)
- [Web App Quickstart](https://opencandle.app/docs/hosted-pwa.html)
- [How the Web App Works](https://opencandle.app/docs/how-the-web-app-works.html)
- [TUI Quickstart](https://opencandle.app/docs/tui.html)
- [GUI Quickstart](https://opencandle.app/docs/gui-quickstart.html)
- [Investigation Recipes](https://opencandle.app/docs/investigation-recipes.html)
- [Data Sources](https://opencandle.app/docs/data-sources.html)
- [Configuration](https://opencandle.app/docs/configuration.html)
- [System Architecture](https://opencandle.app/docs/system-architecture.html)
- [Testing and Evals](https://opencandle.app/docs/testing-and-evals.html)
- [Why OpenCandle](https://opencandle.app/docs/comparisons.html)

## Community and Contributing

Questions and bug reports are welcome in [GitHub Issues](https://github.com/Kahtaf/OpenCandle/issues); redact API keys, account identifiers, holdings, and local state from public issues. Before opening large changes or reporting sensitive issues, see [Contributing](CONTRIBUTING.md), [Security](https://opencandle.app/docs/security.html), and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

MIT. See [LICENSE](LICENSE).
