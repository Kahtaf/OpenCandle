<p align="center">
  <img src="https://raw.githubusercontent.com/Kahtaf/OpenCandle/main/assets/logo.png" alt="OpenCandle" width="120" />
</p>

<h1 align="center">OpenCandle</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/opencandle"><img src="https://img.shields.io/npm/v/opencandle" alt="npm version" /></a>
  <a href="https://github.com/Kahtaf/OpenCandle/actions/workflows/ci.yml"><img src="https://github.com/Kahtaf/OpenCandle/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/Kahtaf/OpenCandle/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node.js >= 20" />
</p>

<p align="center">A financial agent that talks to markets. Ask it for stock prices, options chains with Greeks, macro data, or sentiment, and it fetches real data, computes analytics locally, and gives you actionable answers.</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Kahtaf/OpenCandle/main/assets/demo.gif" alt="OpenCandle demo" width="640" />
</p>

## Why OpenCandle?

Investors and traders may check Yahoo Finance for quotes, FRED for macro data, Reddit for sentiment, then copy numbers into a spreadsheet for analysis. OpenCandle replaces that workflow with a single terminal agent that fetches live data from all of those sources, computes technical indicators and options Greeks locally, and chains tools together to answer complex questions. No browser tabs, no manual copy-paste, no API dependency for math.

Type `analyze TSLA` and it runs a full 5-analyst breakdown: fundamentals, technicals, options positioning, sentiment, risk — then synthesizes a verdict.

[Pi](https://pi.dev/) powers the runtime, TUI, auth, and model selection. OpenCandle keeps its own user data in `~/.opencandle/`.

## Getting Started

**Requires Node.js ≥ 20.**

### Standalone CLI

```bash
npm install -g opencandle
opencandle

# or run without installing globally
npx opencandle@latest
```

On first run, OpenCandle walks you through setup:

1. **Connect an AI provider** — sign in with OAuth (Google, OpenAI, Anthropic) or paste an API key
2. **Pick a model** — choose from the available models on your connected provider
3. **Optional: add market-data keys** — Alpha Vantage and FRED for fundamentals and macro data (can skip)

To rerun setup later, use `/setup`.

### From Source

```bash
npm install
cp .env.example .env
# Add any LLM env vars you want to use locally (for example GEMINI_API_KEY)
npm start
```

### API Keys

| Key | Required | Free Tier | What It Unlocks |
|-----|----------|-----------|-----------------|
| `GEMINI_API_KEY` | No | Yes | Google Gemini via Pi auth/model registry |
| `OPENAI_API_KEY` | No | Paid | OpenAI models via Pi auth/model registry |
| `ANTHROPIC_API_KEY` | No | Paid | Anthropic models via Pi auth/model registry |
| `ALPHA_VANTAGE_API_KEY` | No | 25 req/day | Company fundamentals, earnings, financials |
| `FRED_API_KEY` | No | Generous | Fed rates, CPI, GDP, unemployment, yield curve |

Yahoo Finance, CoinGecko, Reddit, and Fear & Greed Index need no keys.
Pi also supports OAuth-backed and custom providers through `~/.pi/agent/auth.json`, `/login`, `/model`, and `~/.pi/agent/models.json`.

### State and Config

- Pi runtime config and optional project overrides live in `.pi/` and `~/.pi/agent/...`.
- OpenCandle finance-provider config lives in `~/.opencandle/config.json`:

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

- Environment variables still work and override `~/.opencandle/config.json`.
- Set `OPENCANDLE_HOME` to override the default `~/.opencandle/` data directory.
- OpenCandle user data lives in `~/.opencandle/` (or `$OPENCANDLE_HOME`):
  - `~/.opencandle/watchlist.json`
  - `~/.opencandle/portfolio.json`
  - `~/.opencandle/predictions.json`
  - `~/.opencandle/state.db`
  - `~/.opencandle/logs/...`
- The published CLI should work from any directory without depending on a repo-local `.pi/extensions/...` file. Project `.pi/` remains optional for user overrides.

## Usage

OpenCandle runs inside Pi's interactive TUI. Useful controls:

```text
/model          Switch provider/model
/login          Authenticate an OAuth-backed provider
/setup          Rerun OpenCandle setup
/analyze NVDA   Run the multi-analyst workflow
```

Natural-language prompts still work:

```text
What's the price of AAPL?
Get the options chain for TSLA expiring April 24
Show me MSFT puts with Greeks
What's the Fear and Greed index?
Get the fed funds rate from FRED
Add 100 shares of NVDA at 120 to my portfolio, then show my portfolio
Run risk analysis on SPY
analyze AAPL
```

## Tools (23)

| Category | Tools | Data Source |
|----------|-------|------------|
| **Market Data** | `search_ticker`, `get_stock_quote`, `get_stock_history`, `get_crypto_price`, `get_crypto_history` | Yahoo Finance, CoinGecko |
| **Options** | `get_option_chain` — strikes, bids/asks, volume, OI, IV, computed Greeks | Yahoo Finance + Black-Scholes |
| **Fundamentals** | `get_company_overview`, `get_financials`, `get_earnings`, `compute_dcf`, `compare_companies`, `get_sec_filings` | Alpha Vantage, SEC EDGAR |
| **Technical** | `get_technical_indicators`, `backtest_strategy` — SMA, EMA, RSI, MACD, Bollinger Bands, backtesting | Computed locally from OHLCV |
| **Macro** | `get_economic_data`, `get_fear_greed` | FRED, alternative.me |
| **Sentiment** | `get_reddit_sentiment`, `get_reddit_discussions` | Reddit JSON API |
| **Portfolio** | `track_portfolio`, `analyze_risk`, `manage_watchlist`, `analyze_correlation`, `track_prediction` | Yahoo Finance + local math |

## How It Works

Built on [Pi-mono](https://github.com/badlogic/pi-mono)'s `pi-coding-agent` SDK and TUI, with OpenCandle loaded as a bundled finance-only Pi extension. Tools are defined with [TypeBox](https://github.com/sinclairzx81/typebox) schemas and registered through Pi's extension system.

```
User prompt -> Pi session -> selected provider/model -> tool calls -> execute in parallel -> response
                ^                                                                  |
                |____________________ Pi session + model registry _________________|
```

Key architectural choices:
- **Local computation** over API calls for math (indicators, Greeks, risk metrics)
- **Stealth browser fallback** via [Camoufox](https://github.com/daijro/camoufox) when Yahoo rate-limits Node.js `fetch`
- **TTL caching + token bucket rate limiting** per provider
- **Pi-native auth/model flow** via `/model`, `/login`, `auth.json`, and `models.json`
- **Global OpenCandle state** under `~/.opencandle/`, separate from Pi config
- **Multi-analyst orchestration** via Pi extension commands and follow-up message hooks

## Test

```bash
npm test              # unit tests
npm run test:watch    # watch mode
```

## Project Docs

- Build a tool guide: [docs/build-a-tool.md](https://github.com/Kahtaf/OpenCandle/blob/main/docs/build-a-tool.md)
- Contributor guide: [CONTRIBUTING.md](https://github.com/Kahtaf/OpenCandle/blob/main/CONTRIBUTING.md)
- Security policy: [SECURITY.md](https://github.com/Kahtaf/OpenCandle/blob/main/SECURITY.md)
- Release history: [CHANGELOG.md](https://github.com/Kahtaf/OpenCandle/blob/main/CHANGELOG.md)

## Tech Stack

- **Runtime**: TypeScript, Node.js
- **LLM**: Pi model registry with Gemini, OpenAI, Anthropic, and custom providers
- **Browser**: Camoufox (anti-detection Firefox for scraping fallback)
- **Testing**: Vitest with fixture-mocked `fetch`
- **No frameworks**: Raw providers, no LangChain/LlamaIndex
