---
title: Data Sources
description: Provider coverage, credentials, and data boundaries in OpenCandle.
---

# Data Sources

OpenCandle combines free public sources, optional keyed APIs, and local state. Tools gather data and return structured details. The model can synthesize those details, but tool implementations should not invent financial conclusions or hardcode market numbers.

## Provider Coverage

| Domain | Tools | Providers |
| --- | --- | --- |
| Market | `search_ticker`, `screen_stocks`, `get_stock_quote`, `get_stock_history`, `get_price_comparison` | Yahoo Finance; TradingView scanner for breadth screening and watchlist batch quotes; Alpha Vantage fallback for quote/history when configured; London Strategic Edge fallback for intraday and deep-range history (back to 2003) when configured |
| Crypto | `get_crypto_price`, `get_crypto_history` | CoinGecko |
| Options | `get_option_chain` with Greeks computed inside the result | Yahoo Finance plus local calculations |
| Fundamentals | `get_company_overview`, `get_financials`, `get_earnings`, `compute_dcf`, `compare_companies` | Alpha Vantage; London Strategic Edge first for financial statements and DCF statements when configured; Yahoo Finance fallbacks for comparison fundamentals and DCF statements |
| Macro | `get_economic_data`, `get_event_probabilities`, `get_fear_greed` | FRED, [Polymarket](https://polymarket.com) Gamma API, alternative.me crypto Fear & Greed |
| Technical | `get_technical_indicators`, `backtest_strategy` | Local calculations over market history |
| Sentiment | `get_reddit_sentiment`, `get_twitter_sentiment`, `search_web`, `get_web_sentiment`, `get_sentiment_summary`, `get_sentiment_trend` | `rdt-cli` and `twitter-cli` using your normal browser sessions, Finnhub, DuckDuckGo, Brave, Exa |
| Filings | `get_sec_filings` | SEC EDGAR |
| Portfolio | `track_portfolio`, `analyze_risk`, `manage_watchlist`, `analyze_correlation`, `analyze_holdings_overlap`, `daily_watchlist_report`, `manage_alerts`, `manage_notifications` | Local state plus market providers |

## Keyed and Keyless Sources

Keyless by default:

- [Yahoo Finance](https://finance.yahoo.com)
- [TradingView](https://www.tradingview.com) scanner (unofficial, delayed scanner endpoint; used read-only and batch-first)
- [Polymarket](https://polymarket.com) Gamma API for read-only prediction-market probabilities and resolution criteria
- [CoinGecko](https://www.coingecko.com)
- [SEC EDGAR](https://www.sec.gov/edgar/search/)
- [DuckDuckGo](https://duckduckgo.com) search
- [alternative.me crypto Fear & Greed](https://alternative.me/crypto/fear-and-greed-index/)

External local tools:

- Reddit sentiment uses [`rdt-cli`](https://github.com/public-clis/rdt-cli) and the user's normal Reddit browser session. Install with `uv tool install rdt-cli`, then run `rdt login` if prompted. `opencandle doctor` checks install status; `opencandle doctor --sessions` or the GUI Diagnostics page explicitly checks browser-session readiness.
- Twitter/X sentiment uses [`twitter-cli`](https://github.com/public-clis/twitter-cli) and the user's normal x.com browser session. Install with `uv tool install twitter-cli`. `opencandle doctor` checks install status; `opencandle doctor --sessions` or the GUI Diagnostics page explicitly checks browser-session readiness.

Optional keys:

- `ALPHA_VANTAGE_API_KEY` expands fundamentals, earnings, financial statements, DCF, and company comparison coverage through [Alpha Vantage](https://www.alphavantage.co).
- `FRED_API_KEY` enables [FRED](https://fred.stlouisfed.org) macro series lookups.
- `BRAVE_API_KEY` enables [Brave](https://brave.com/search/api/) as a web search fallback.
- `EXA_API_KEY` enables [Exa](https://exa.ai) web search.
- `FINNHUB_API_KEY` enables [Finnhub company news](https://finnhub.io/api/v1/news?category=general) in sentiment summaries.
- `LSE_API_KEY` enables the [London Strategic Edge](https://londonstrategicedge.com/databank) free tier: financial-statement access (used before Alpha Vantage by `get_financials` and `compute_dcf`) and split-adjusted intraday plus deep-range daily candles back to 2003 as the last fallback behind Yahoo Finance and Alpha Vantage. The data is licensed per key — bring your own key; OpenCandle does not redistribute LSE data.
- Search and social providers can degrade based on available credentials, external-tool availability, local browser login state, and provider health. Reddit sentiment requires `rdt-cli` plus a usable Reddit browser session; Twitter/X sentiment requires `twitter-cli` plus a usable x.com browser session.

## Caching and Degradation

External provider calls go through OpenCandle's shared cache and rate limiter. When a provider fails, tools return a clear degraded response instead of pretending the data is fresh:

- Fresh data is returned when the provider succeeds.
- Stale cache can be used when the provider is temporarily unavailable, and is labeled as stale.
- Missing credentials are reported as setup gaps.
- Circuit breakers avoid repeatedly calling failing providers.

TradingView scanner data is keyless but unofficial and can be delayed by about 15 minutes. `screen_stocks` is intended for broad filtered scans such as market movers, oversold lists, or large-cap screens; single-security quotes, history, options, and company analysis use the Yahoo-backed quote/history tools and the fundamentals/options workflow tools. Watchlist checks use TradingView batch quotes for equity-like symbols and fill unresolved or unsupported symbols through Yahoo.

London Strategic Edge usage is metered against its free-tier allowance: OpenCandle persists a monthly byte budget and quietly removes LSE from fallback chains once 80% of the allowance is used, with an advisory in `opencandle doctor`. Doctor and the GUI Diagnostics page report LSE readiness automatically when a key is configured.

Polymarket probabilities are market-implied prices from a crypto-settled venue, not calibrated forecasts. `get_event_probabilities` reports the market question, per-outcome probability, volume/liquidity, close date, and the market's resolution criteria so the model can compare the market wording with the user's question.

Kalshi is intentionally deferred. Its market-data API has attractive macro contracts, but the Kalshi Data Terms prohibit feeding the data to an AI/ML system and providing cached data sets without prior written consent. Do not add a Kalshi provider until the maintainer records written clearance or a legal review that clears OpenCandle's AI-ingestion and cache usage.

## Local State

OpenCandle user state defaults to `~/.opencandle/`. Pi configuration is separate and stays in `.pi/` or `~/.pi/agent/`.

The CLI and GUI should not depend on repo-local `.pi/extensions/`. This keeps installed-package usage, source checkouts, and local GUI sessions from relying on accidental development artifacts.

## Safety Boundary

OpenCandle does not guarantee completeness, accuracy, or suitability for trading decisions. It is designed to collect and organize research evidence. It should call out missing data, stale data, downside scenarios, and provider limitations instead of smoothing them over.
