# OpenCandle

A financial agent that talks to markets. Ask it for stock prices, options chains with Greeks, macro data, sentiment — it fetches real data, computes analytics locally, and gives you actionable answers.

## What This Does

OpenCandle is an AI-powered terminal agent for investors and traders. Instead of switching between Yahoo Finance, FRED, Reddit, and a spreadsheet, you ask one agent and it chains the right tools together. It computes technical indicators and options Greeks locally (Black-Scholes), so there's no API dependency for math.

Type `analyze TSLA` and it runs a full 5-analyst breakdown — fundamentals, technicals, options positioning, sentiment, risk — then synthesizes a verdict.

[Pi](https://pi.dev/) powers the runtime, TUI, auth, and model selection. OpenCandle keeps its own user data in `~/.opencandle/`.

## Getting Started

### Standalone CLI

```bash
npm install -g opencandle
opencandle

# or run without installing globally
npx opencandle@latest
```

On first run, OpenCandle guides you through AI model setup before chat starts. If you want to rerun that flow later, use `/setup`.

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
- OpenCandle user data lives in `~/.opencandle/`:
  - `~/.opencandle/watchlist.json`
  - `~/.opencandle/portfolio.json`
  - `~/.opencandle/predictions.json`
  - `~/.opencandle/state.db`
  - `~/.opencandle/logs/...`
- The published CLI should work from any directory without depending on a repo-local `.pi/extensions/...` file. Project `.pi/` remains optional for user overrides.

## Usage

OpenCandle now runs inside Pi's interactive TUI. Useful controls:

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
npm test              # 208 unit tests
npm run test:watch    # watch mode
```

## Project Docs

- OSS launch and npm release plan: [docs/production-plan.md](https://github.com/Kahtaf/OpenCandle/blob/main/docs/production-plan.md)
- Contributor guide: [CONTRIBUTING.md](https://github.com/Kahtaf/OpenCandle/blob/main/CONTRIBUTING.md)
- Security policy: [SECURITY.md](https://github.com/Kahtaf/OpenCandle/blob/main/SECURITY.md)
- Release history: [CHANGELOG.md](https://github.com/Kahtaf/OpenCandle/blob/main/CHANGELOG.md)

## Tech Stack

- **Runtime**: TypeScript, Node.js
- **LLM**: Pi model registry with Gemini, OpenAI, Anthropic, and custom providers
- **Browser**: Camoufox (anti-detection Firefox for scraping fallback)
- **Testing**: Vitest with fixture-mocked `fetch`
- **No frameworks**: Raw providers, no LangChain/LlamaIndex
