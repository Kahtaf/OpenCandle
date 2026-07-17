# OpenCandle

OpenCandle is an open source financial investigator: a terminal agent and local browser workbench for market research that starts from real provider data, shows source gaps, and keeps risk visible.

Requires Node.js 22.19+ or 24–26. macOS and Linux are fully supported; Windows is best-effort (WSL recommended).

```bash
npx opencandle
# or
npx opencandle gui
```

[![CI](https://github.com/Kahtaf/OpenCandle/actions/workflows/ci.yml/badge.svg)](https://github.com/Kahtaf/OpenCandle/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/opencandle)](https://www.npmjs.com/package/opencandle)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Kahtaf/OpenCandle/blob/main/LICENSE)

[Docs](https://opencandle.app/docs/) | [First run](https://opencandle.app/docs/first-run.html) | [GUI quickstart](https://opencandle.app/docs/gui-quickstart.html) | [Data sources](https://opencandle.app/docs/data-sources.html) | [Build a tool](https://opencandle.app/docs/build-a-tool.html)

## See It Work

The 67-second launch video: a real market question through the browser workbench, the evidence trail behind the answer, and the same workflow in the terminal.

https://github.com/user-attachments/assets/334956b1-18b4-4d6f-92b5-3f739824cd29

If the inline player does not load, [watch the MP4 directly](https://github.com/user-attachments/assets/334956b1-18b4-4d6f-92b5-3f739824cd29).

## Why OpenCandle

Most finance agents answer too early. OpenCandle is built around the opposite loop: understand the question, gather market evidence, disclose missing or stale data, then synthesize.

Use it when a question needs inspectable evidence:

- What is this stock or crypto trading at right now?
- How do two companies compare across price action, fundamentals, filings, and sentiment?
- What does the options chain imply, and where are the Greeks?
- How exposed is my local portfolio or watchlist?
- What macro series, filings, or sentiment sources support the answer?

OpenCandle is read-only research software. It does not place trades, route orders, or provide financial advice.

## Highlights

| Capability | What it gives you |
| --- | --- |
| Terminal agent | Fast keyboard-driven research inside the bundled [Pi](https://github.com/earendil-works/pi) local TUI, with sessions, slash commands, model setup, and saved transcripts. Pi is the bundled agent runtime; no separate Pi install is needed. |
| Local browser GUI | Chat with financial result cards and interactive charts, a market dashboard home, per-ticker symbol pages, watchlists and portfolios with sparklines and extended-hours quotes, session history, provider setup, and tool discovery at `http://127.0.0.1:14567`. |
| Evidence-first answers | Tools fetch and format data; the model synthesizes only after evidence is gathered. |
| Finance routing | Quote lookup, comparison, portfolio review, options strategy, filing checks, macro questions, sentiment reads, and educational prompts route differently. |
| Provider transparency | Missing keys, degraded sources, stale cache, and unavailable data are surfaced instead of hidden. |
| Local state | OpenCandle user state lives under `~/.opencandle/` unless `OPENCANDLE_HOME` is set; durable market state is stored in SQLite at `~/.opencandle/state.db` (or `$OPENCANDLE_HOME/state.db`). |
| Extensible tools | TypeScript tool APIs, provider boundaries, workflow builders, and package exports for add-on tools. |
| Eval harness | Unit tests, live provider checks, CLI e2e, GUI browser smoke tests, and competitive finance evals. |

## Quick Start

On first run, OpenCandle walks you through model setup. [Pi](https://github.com/earendil-works/pi) is the bundled agent runtime that handles model setup, the terminal shell, and saved sessions; no separate Pi install is needed. In the terminal, you can use Pi sign-in when available or provide a model API key. In the GUI, use the API-key setup panel or complete terminal `/setup` first and refresh the browser. Data-provider keys are separate and optional.

Start the GUI instead:

```bash
npx opencandle gui
```

Then open `http://127.0.0.1:14567`.

For a five-minute path from install to a successful answer, see [First Run](https://opencandle.app/docs/first-run.html).

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

Useful slash commands:

```text
/setup
/login
/model
/connect
/analyze AAPL   # deep research: multi-analyst debate, takes a few minutes
```

Health diagnostics run from your shell:

```bash
npx opencandle doctor
npx opencandle doctor --json
npx opencandle doctor --sessions
npx opencandle doctor --full
npx opencandle doctor --enable twitter
```

The GUI also has a Diagnostics page at `/diagnostics` with the same health report, provider setup links, model setup actions, and an explicit browser-session check for Reddit and Twitter/X.

## Data Sources

| Area | Examples | Source |
| --- | --- | --- |
| Market data | Quotes, history, indexed price comparisons, ticker search, screeners, crypto price and history | Yahoo Finance, TradingView scanner, Alpha Vantage and London Strategic Edge fallbacks when configured, CoinGecko |
| Options | Chains, open interest, IV, locally computed Greeks | Yahoo Finance plus local calculations |
| Fundamentals | Overview, financials, earnings, DCF, comparable companies | Alpha Vantage; optional London Strategic Edge for financial statements and DCF, with Yahoo Finance fallbacks |
| Macro | Rates, CPI, GDP, unemployment, event probabilities, crypto Fear & Greed | FRED, Polymarket Gamma API, alternative.me |
| Technical | Indicators and strategy backtests | Local calculations over market history |
| Sentiment | Reddit, Twitter/X, Finnhub news, and web sentiment | `rdt-cli` and `twitter-cli` using your normal browser sessions, Finnhub, Exa, Brave, DuckDuckGo |
| Filings | SEC filing search | SEC EDGAR |
| Portfolio | Watchlists, holdings, correlation, risk | Local state plus market data |

Yahoo Finance, TradingView scanner, Polymarket Gamma, CoinGecko, SEC EDGAR, DuckDuckGo search, and the alternative.me crypto Fear & Greed index do not require OpenCandle provider keys. Reddit sentiment requires `rdt-cli` (`uv tool install rdt-cli`) plus an active Reddit session in your normal browser. Twitter/X sentiment requires `twitter-cli` (`uv tool install twitter-cli`) plus an active x.com session in your normal browser. Alpha Vantage, FRED, Brave, Exa, Finnhub, and London Strategic Edge unlock deeper coverage when configured.

## Configuration

Model access comes from Pi. Market data provider keys can be set in the environment, through `/connect`, through the GUI provider setup flow, or in `~/.opencandle/config.json`.

| Key | Used For |
| --- | --- |
| `GEMINI_API_KEY` | Google models through Pi |
| `OPENAI_API_KEY` | OpenAI models through Pi |
| `ANTHROPIC_API_KEY` | Anthropic models through Pi |
| `ALPHA_VANTAGE_API_KEY` | Fundamentals, earnings, financial statements, DCF, comps |
| `FRED_API_KEY` | Macro series such as rates, CPI, GDP, unemployment |
| `BRAVE_API_KEY` | Brave web search fallback |
| `EXA_API_KEY` | Exa web search |
| `FINNHUB_API_KEY` | Finnhub company news for sentiment summaries |
| `LSE_API_KEY` | London Strategic Edge financial statements and deep intraday/long-range price history |
| `OPENCANDLE_HOME` | Override OpenCandle state directory |
| `OPENCANDLE_GUI_HOST` | GUI bind host, default `127.0.0.1` |
| `OPENCANDLE_GUI_PORT` | GUI port, default `14567` |
| `OPENCANDLE_NOTIFICATION_WEBHOOK_URL` | Optional local webhook target for alert/report notification delivery attempts |

Environment variables override `~/.opencandle/config.json`. See [Configuration](https://opencandle.app/docs/configuration.html) for the full reference, including advanced routing and diagnostic switches.

## From Source

```bash
git clone https://github.com/Kahtaf/OpenCandle.git
cd OpenCandle
npm install
cp .env.example .env
npm start
```

On Windows Command Prompt, use `copy .env.example .env` instead of `cp .env.example .env`.

Run the local GUI from a checkout:

```bash
npm run gui
```

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

Project shape:

```text
src/
|-- providers/    API clients
|-- tools/        Tool implementations by domain
|-- infra/        Cache, rate limiter, HTTP client, paths
|-- routing/      Request understanding, entity extraction, slot resolution
|-- workflows/    WorkflowDefinition builders
|-- runtime/      Session coordinator, workflow runner, runtime context
|-- market-state/ Durable watchlists, portfolios, alerts, reports
|-- memory/       SQLite-backed state and retrieval
|-- sentiment/    Cross-source sentiment pipeline, scoring, adapters, trends
|-- analysts/     Multi-analyst orchestration
|-- pi/           Pi integration and session wiring
|-- cli.ts        CLI entry point
|-- monitor.ts    Local automation heartbeat command
|-- tool-kit.ts   Public add-on tool helpers
`-- index.ts      Public package exports
```

Package exports:

- `opencandle`
- `opencandle/tool-kit`
- `opencandle/infra`
- `opencandle/types`
- `opencandle/providers`
- `opencandle/tools`
- `opencandle/workflows`

If you want to add a new first-party tool or publish an add-on package, start with [Build a Tool](https://opencandle.app/docs/build-a-tool.html).

## Development

```bash
npm start
npm run gui
npm run docs:site:build
npm test
npm run test:watch
npm run test:e2e
npm run test:e2e:cli
npm run test:e2e:providers
npm run eval
npm run eval -- cases
npm run eval -- product
npm run eval -- competitive
```

Baseline check:

```bash
npm test
```

The e2e, provider, and eval commands can hit live APIs, live model providers, or local agent CLIs. `npm run eval` lists every eval suite; run suites through `npm run eval -- <suite>`. Run them intentionally; see [Testing and Evals](https://opencandle.app/docs/testing-and-evals.html).

Repository rules that matter:

- Unit tests mock `globalThis.fetch` and use fixture JSON.
- External calls go through shared cache and rate-limiter infrastructure.
- Tools fetch and format; analysts and prompts synthesize.
- Relative TypeScript imports use `.js` extensions.
- Behavior changes should be test-first.

For scripted full-session driving with file-based IPC:

```bash
npx tsx tests/harness/cli.ts run --prompt "What is AAPL trading at?" --ipc /tmp/opencandle-ipc &
npx tsx tests/harness/cli.ts wait --ipc /tmp/opencandle-ipc
npx tsx tests/harness/cli.ts trace --ipc /tmp/opencandle-ipc
```

See [tests/harness/README.md](https://github.com/Kahtaf/OpenCandle/blob/main/tests/harness/README.md) for the full flow.

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
- [Comparisons](https://opencandle.app/docs/comparisons.html)

## License

MIT

## Contributing and Security

See [Contributing](https://opencandle.app/docs/contributing.html), [Security](https://opencandle.app/docs/security.html), and the [Code of Conduct](https://github.com/Kahtaf/OpenCandle/blob/main/CODE_OF_CONDUCT.md) before opening large changes or reporting sensitive issues. Redact API keys, account identifiers, holdings, and local state from public issues.
