# OpenCandle

OpenCandle is a terminal-first financial data agent built with TypeScript and Pi. It fetches market, macro, options, fundamentals, sentiment, and portfolio data from real providers, then lets the model synthesize that data into an answer.

This repository is useful in two ways:

- Run `opencandle` as an interactive CLI for market research
- Extend OpenCandle with new tools, providers, or Pi-compatible add-on packages

## What You Can Use It For

- Quote and history lookups for stocks and crypto
- Options chains with locally computed Greeks
- Company fundamentals, earnings, and SEC filings
- FRED macro series and Fear & Greed data
- Reddit-based sentiment and discussion lookups
- Portfolio tracking, watchlists, correlation, and risk analysis
- Multi-step workflows such as `/analyze NVDA`

OpenCandle is designed to fetch and format data. The model handles synthesis. Tool code should not invent financial conclusions or hardcode market numbers.

## Install And Run

Requires Node.js 20+.

### CLI

```bash
npm install -g opencandle
opencandle

# or without installing globally
npx opencandle@latest
```

### From Source

```bash
npm install
cp .env.example .env
npm start
```

On first run, OpenCandle walks you through model setup. You can rerun that flow later with `/setup`.

## Configuration

Model access comes from Pi. Market data providers are optional and additive.

| Key | Required | Used For |
| --- | --- | --- |
| `GEMINI_API_KEY` | No | Google models through Pi |
| `OPENAI_API_KEY` | No | OpenAI models through Pi |
| `ANTHROPIC_API_KEY` | No | Anthropic models through Pi |
| `ALPHA_VANTAGE_API_KEY` | No | Fundamentals, earnings, financial statements |
| `FRED_API_KEY` | No | Macro series such as rates, CPI, GDP, unemployment |

Yahoo Finance, CoinGecko, Reddit, SEC EDGAR, and Fear & Greed data do not require keys.

OpenCandle stores its own user state in `~/.opencandle/` by default. Pi configuration stays in `.pi/` and `~/.pi/agent/`. The CLI should not depend on repo-local `.pi/extensions/`.

Provider keys can also be stored in `~/.opencandle/config.json`:

```json
{
  "providers": {
    "alphaVantage": {
      "apiKey": "..."
    },
    "fred": {
      "apiKey": "..."
    }
  }
}
```

Environment variables override values from `~/.opencandle/config.json`. Set `OPENCANDLE_HOME` if you want OpenCandle state somewhere other than `~/.opencandle/`.

## Basic Usage

OpenCandle runs inside Pi's interactive terminal UI.

Useful commands:

```text
/setup
/login
/model
/analyze AAPL
```

Example prompts:

```text
What is AAPL trading at?
Get the options chain for TSLA expiring April 24
Show me MSFT puts with Greeks
Get the fed funds rate from FRED
Add 100 shares of NVDA at 120 to my portfolio, then show my portfolio
Run risk analysis on SPY
```

## Data Sources And Tool Coverage

| Area | Examples | Source |
| --- | --- | --- |
| Market data | quotes, history, ticker search, crypto price/history | Yahoo Finance, CoinGecko |
| Options | chains, open interest, IV, Greeks | Yahoo Finance plus local calculations |
| Fundamentals | overview, financials, earnings, DCF, company comparison | Alpha Vantage |
| Macro | economic series, Fear & Greed | FRED, alternative.me |
| Sentiment | Reddit sentiment, discussion snapshots | Reddit JSON API |
| Filings | SEC filing search | SEC EDGAR |
| Portfolio | watchlist, prediction tracking, correlation, risk | Local state plus market data |

## Engineering Notes

### Project Shape

```text
src/
├── providers/    API clients
├── tools/        Tool implementations by domain
├── infra/        Cache, rate limiter, HTTP, browser, paths
├── routing/      Intent classification and slot resolution
├── workflows/    Multi-step workflow builders
├── memory/       SQLite-backed state and retrieval
├── analysts/     Multi-analyst orchestration
├── pi/           Pi integration and session wiring
└── index.ts      Public exports
```

### Development Commands

```bash
npm start
npm test
npm run test:watch
npm run test:e2e
npm run test:e2e:cli
npm run test:e2e:providers
```

`npm test` is the required baseline check after changes.

### Repository Rules That Matter

- TDD is mandatory for behavior changes
- Unit tests mock `globalThis.fetch` and use JSON fixtures
- Use `cache` and `rateLimiter` for external calls
- Tools fetch and format data; analysts and prompts synthesize
- Keep typing strict and use `.js` extensions on relative imports

### Public Package Exports

Besides the CLI, the package exposes pieces for engineers building on top of OpenCandle:

- `opencandle`
- `opencandle/tool-kit`
- `opencandle/infra`
- `opencandle/types`
- `opencandle/providers`

If you want to add a new tool or publish an add-on package, start with [docs/build-a-tool.md](./docs/build-a-tool.md).

## Testing The Agent

For end-to-end agent driving with file-based IPC:

```bash
npx tsx tests/harness/manual-run.ts /tmp/opencandle-ipc "What is AAPL trading at?"
```

The harness writes status and trace files into the IPC directory. See [tests/harness/README.md](./tests/harness/README.md) for the full flow.

## Project Docs

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [docs/build-a-tool.md](./docs/build-a-tool.md)
- [tests/harness/README.md](./tests/harness/README.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [SECURITY.md](./SECURITY.md)
- [LICENSE](./LICENSE)
