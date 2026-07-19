# OpenCandle

OpenCandle is an open source financial investigator: a terminal agent and local browser workbench for market research that uses real-time provider data to try to accurately answer financial questions.

[![CI](https://img.shields.io/github/actions/workflow/status/Kahtaf/OpenCandle/ci.yml?branch=main&label=CI)](https://github.com/Kahtaf/OpenCandle/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/opencandle)](https://www.npmjs.com/package/opencandle)
[![Node](https://img.shields.io/node/v/opencandle)](https://www.npmjs.com/package/opencandle)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

```bash
npx opencandle       # terminal
npx opencandle gui   # browser UI at http://127.0.0.1:14567
```

[Docs](https://opencandle.app/docs/) | [First run](https://opencandle.app/docs/first-run.html) | [GUI quickstart](https://opencandle.app/docs/gui-quickstart.html) | [Data sources](https://opencandle.app/docs/data-sources.html) | [Build a tool](https://opencandle.app/docs/build-a-tool.html)

## See It Work

https://github.com/user-attachments/assets/334956b1-18b4-4d6f-92b5-3f739824cd29

![OpenCandle GUI workbench showing a chat session with financial result cards alongside the market dashboard.](https://cdn.jsdelivr.net/gh/Kahtaf/OpenCandle@main/docs/images/gui-workbench.png)

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

- **Terminal agent** — keyboard-driven research in the bundled [Pi](https://github.com/earendil-works/pi) TUI, with sessions, slash commands, and saved transcripts.
- **Local browser GUI** — chat with result cards and interactive charts, a market dashboard, per-ticker symbol pages, watchlists and portfolios with live sparklines.
- **Evidence-first answers** — tools fetch and format data; the model synthesizes only after evidence is gathered.
- **Finance routing** — quotes, comparisons, portfolio reviews, options, filings, macro, sentiment, and education each get a purpose-built research path.
- **Provider transparency** — missing keys, degraded sources, and stale data are disclosed instead of hidden.
- **Local state** — watchlists, portfolios, and alerts stay on your machine under `~/.opencandle/`; sessions in Pi's local storage.
- **Extensible** — typed TypeScript tool APIs for building and publishing add-on tools.

## Quick Start

Requires [Node.js](https://nodejs.org/) 22.19+ or 24–26. macOS and Linux are fully supported; Windows is best-effort (WSL recommended).

```bash
npx opencandle
```

On first run, OpenCandle walks you through model setup — use Pi sign-in when offered, or provide a model API key (in the GUI, use the API-key setup panel). Data-provider keys are separate and optional. For the five-minute path from install to a first answer, see [First Run](https://opencandle.app/docs/first-run.html).

Check your setup anytime with `npx opencandle doctor` (or the GUI's `/diagnostics` page).

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

| Area         | Examples                                                                                       | Source                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Market data  | Quotes, history, indexed price comparisons, ticker search, screeners, crypto price and history | Yahoo Finance, TradingView scanner, Alpha Vantage and London Strategic Edge fallbacks when configured, CoinGecko |
| Options      | Chains, open interest, IV, locally computed Greeks                                             | Yahoo Finance plus local calculations                                                                            |
| Fundamentals | Overview, financials, earnings, DCF, comparable companies                                      | Alpha Vantage; optional London Strategic Edge for financial statements and DCF, with Yahoo Finance fallbacks     |
| Macro        | Rates, CPI, GDP, unemployment, event probabilities, crypto Fear & Greed                        | FRED, Polymarket Gamma API, alternative.me                                                                       |
| Technical    | Indicators and strategy backtests                                                              | Local calculations over market history                                                                           |
| Sentiment    | Reddit, Twitter/X, Finnhub news, and web sentiment                                             | `rdt-cli` and `twitter-cli` using your normal browser sessions, Finnhub, Exa, Brave, DuckDuckGo                  |
| Filings      | SEC filing search                                                                              | SEC EDGAR                                                                                                        |
| Portfolio    | Watchlists, holdings, correlation, risk                                                        | Local state plus market data                                                                                     |

Most sources work without API keys. Reddit and Twitter/X sentiment use `rdt-cli` / `twitter-cli` (`uv tool install ...`) with your normal browser sessions. Alpha Vantage, FRED, Brave, Exa, Finnhub, and London Strategic Edge unlock deeper coverage when configured — see [Data Sources](https://opencandle.app/docs/data-sources.html).

## Configuration

Model access is configured through Pi on first run (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or Pi sign-in). Data-provider keys are optional and can be set in the environment, through `/connect`, through the GUI provider setup flow, or in `~/.opencandle/config.json`; environment variables override the config file. See [Configuration](https://opencandle.app/docs/configuration.html) for the full key reference and advanced switches.

## How It Fits Together

![OpenCandle architecture diagram showing the user prompt flowing through OpenCandle routing, saved market state, finance data tools, evidence trace, a configured AI model, and external data sources.](https://cdn.jsdelivr.net/gh/Kahtaf/OpenCandle@main/assets/opencandle-architecture.png)

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

Contributor conventions live in [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md). The e2e, provider, and eval suites can hit live APIs and model providers — run them intentionally; see [Testing and Evals](https://opencandle.app/docs/testing-and-evals.html).

## Documentation

- [Getting Started](https://opencandle.app/docs/getting-started.html)
- [First Run](https://opencandle.app/docs/first-run.html)
- [TUI](https://opencandle.app/docs/tui.html)
- [GUI Quickstart](https://opencandle.app/docs/gui-quickstart.html)
- [Investigation Recipes](https://opencandle.app/docs/investigation-recipes.html)
- [Data Sources](https://opencandle.app/docs/data-sources.html)
- [Configuration](https://opencandle.app/docs/configuration.html)
- [System Architecture](https://opencandle.app/docs/system-architecture.html)
- [Testing and Evals](https://opencandle.app/docs/testing-and-evals.html)
- [Why OpenCandle](https://opencandle.app/docs/comparisons.html)

## Community and Contributing

Questions and bug reports are welcome in [GitHub Issues](https://github.com/Kahtaf/OpenCandle/issues) — redact API keys, account identifiers, holdings, and local state from public issues. Before opening large changes or reporting sensitive issues, see [Contributing](CONTRIBUTING.md), [Security](https://opencandle.app/docs/security.html), and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

MIT — see [LICENSE](LICENSE).
