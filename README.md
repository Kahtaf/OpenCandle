# Vantage

A financial agent that talks to markets. Ask it for stock prices, options chains with Greeks, macro data, sentiment — it fetches real data, computes analytics locally, and gives you actionable answers.

## What This Does

Vantage is an AI-powered terminal agent for investors and traders. Instead of switching between Yahoo Finance, FRED, Reddit, and a spreadsheet, you ask one agent and it chains the right tools together. It computes technical indicators and options Greeks locally (Black-Scholes), so there's no API dependency for math.

Type `analyze TSLA` and it runs a full 6-analyst breakdown — fundamentals, technicals, options positioning, sentiment, risk — then synthesizes a verdict.

## Getting Started

```bash
npm install
cp .env.example .env
# Add your GEMINI_API_KEY to .env
npm start
```

### API Keys

| Key | Required | Free Tier | What It Unlocks |
|-----|----------|-----------|-----------------|
| `GEMINI_API_KEY` | Yes | Yes | LLM (switchable to any provider via Pi-mono) |
| `ALPHA_VANTAGE_API_KEY` | No | 25 req/day | Company fundamentals, earnings, financials |
| `FRED_API_KEY` | No | Generous | Fed rates, CPI, GDP, unemployment, yield curve |

Yahoo Finance, CoinGecko, Reddit, and Fear & Greed Index need no keys.

## Usage

```
> What's the price of AAPL?
> Get the options chain for TSLA expiring April 24
> Show me MSFT puts with Greeks
> What's the Fear and Greed index?
> Get the fed funds rate from FRED
> Add 100 shares of NVDA at 120 to my portfolio, then show my portfolio
> Run risk analysis on SPY
> analyze AAPL
```

## Tools (16)

| Category | Tools | Data Source |
|----------|-------|------------|
| **Market Data** | `search_ticker`, `get_stock_quote`, `get_stock_history`, `get_crypto_price`, `get_crypto_history` | Yahoo Finance, CoinGecko |
| **Options** | `get_option_chain` — strikes, bids/asks, volume, OI, IV, computed Greeks | Yahoo Finance + Black-Scholes |
| **Fundamentals** | `get_company_overview`, `get_financials`, `get_earnings` | Alpha Vantage |
| **Technical** | `get_technical_indicators` — SMA, EMA, RSI, MACD, Bollinger Bands | Computed locally from OHLCV |
| **Macro** | `get_economic_data`, `get_fear_greed` | FRED, alternative.me |
| **Sentiment** | `get_reddit_sentiment`, `get_news_sentiment` | Reddit JSON API |
| **Portfolio** | `track_portfolio`, `analyze_risk` — Sharpe, VaR, max drawdown | Yahoo Finance + local math |

## How It Works

Built on [Pi-mono](https://github.com/badlogic/pi-mono)'s `pi-ai` (unified LLM API across 20+ providers) and `pi-agent-core` (agentic loop with parallel tool execution). Tools are defined with [TypeBox](https://github.com/sinclairzx81/typebox) schemas.

```
User prompt -> Gemini -> tool calls -> execute in parallel -> results -> Gemini -> response
                ^                                                          |
                |__________ loop until no more tool calls ________________|
```

Key architectural choices:
- **Local computation** over API calls for math (indicators, Greeks, risk metrics)
- **Stealth browser fallback** via [Camoufox](https://github.com/daijro/camoufox) when Yahoo rate-limits Node.js `fetch`
- **TTL caching + token bucket rate limiting** per provider
- **Multi-analyst orchestration** via Pi-mono's follow-up message hooks

## Test

```bash
npm test              # 116 unit tests
npm run test:watch    # watch mode
```

## Tech Stack

- **Runtime**: TypeScript, Node.js
- **LLM**: Gemini 2.5 Flash via Pi-mono (swappable to Anthropic, OpenAI, etc.)
- **Browser**: Camoufox (anti-detection Firefox for scraping fallback)
- **Testing**: Vitest with fixture-mocked `fetch`
- **No frameworks**: Raw providers, no LangChain/LlamaIndex
