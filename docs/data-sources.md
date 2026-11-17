---
title: Data Sources
description: Review OpenCandle market, filings, options, macro, news, and sentiment data sources, including credentials, limits, and fallback behavior.
---

# Data Sources

OpenCandle combines free public sources, optional keyed APIs, and local state. Tools gather the data; the model writes the analysis. Tools never invent numbers.

In the web app at web.opencandle.app, most sources work the same. SEC EDGAR filings and X/Reddit sentiment need the local app, and Alpha Vantage, FRED, Finnhub, London Strategic Edge, and Brave need your own key there just like locally. See the [Web App Quickstart](./hosted-pwa.md).

## Provider Coverage

| Domain | Tools | Providers |
| --- | --- | --- |
| Market | `search_ticker`, `screen_stocks`, `get_stock_quote`, `get_stock_history`, `get_price_comparison` | Yahoo Finance; TradingView scanner for breadth screening and watchlist batch quotes; Alpha Vantage fallback for quote/history when configured; London Strategic Edge fallback for intraday and deep-range history where available when configured |
| Crypto | `get_crypto_price`, `get_crypto_history` | CoinGecko |
| Options | `get_option_chain` with Greeks computed inside the result | Yahoo Finance plus local calculations |
| Fundamentals | `get_company_overview`, `get_financials`, `get_earnings`, `compute_dcf`, `compare_companies` | London Strategic Edge (when configured), then Alpha Vantage for financial statements; `compute_dcf` additionally falls back to Yahoo Finance for statements and market cap; Alpha Vantage with Yahoo Finance fallbacks for overview, earnings, and comparisons |
| Macro | `get_economic_data`, `get_event_probabilities`, `get_fear_greed` | FRED, [Polymarket](https://polymarket.com) Gamma API, alternative.me crypto Fear & Greed |
| Technical | `get_technical_indicators`, `backtest_strategy` | Local calculations over market history |
| Sentiment | `get_reddit_sentiment`, `get_twitter_sentiment`, `search_web`, `get_web_sentiment`, `get_sentiment_summary`, `get_sentiment_trend` | `rdt-cli` and `twitter-cli` using your normal browser sessions, Finnhub, DuckDuckGo, Brave, Exa |
| Filings | `get_sec_filings` | SEC EDGAR |
| Portfolio | `track_portfolio`, `analyze_risk`, `manage_watchlist`, `analyze_correlation`, `analyze_holdings_overlap`, `daily_watchlist_report`, `manage_alerts`, `manage_notifications` | Local state plus market providers |

## Keyed and Keyless Sources

Keyless by default:

- [Yahoo Finance](https://finance.yahoo.com)
- [TradingView](https://www.tradingview.com) scanner (unofficial, delayed by roughly 15 minutes; read-only)
- [Polymarket](https://polymarket.com) Gamma API for read-only prediction-market probabilities and resolution criteria
- [CoinGecko](https://www.coingecko.com)
- [SEC EDGAR](https://www.sec.gov/edgar/search/)
- [DuckDuckGo](https://duckduckgo.com) search
- [Exa](https://exa.ai) web search, through its keyless MCP endpoint
- [alternative.me crypto Fear & Greed](https://alternative.me/crypto/fear-and-greed-index/)

External local tools:

- Reddit sentiment uses [`rdt-cli`](https://github.com/public-clis/rdt-cli) and the user's normal Reddit browser session. Install with `uv tool install rdt-cli`, then run `rdt login` if prompted. `opencandle doctor` checks install status; `opencandle doctor --sessions` or the GUI Diagnostics section under Settings explicitly checks browser-session readiness.
- Twitter/X sentiment uses [`twitter-cli`](https://github.com/public-clis/twitter-cli) and the user's normal x.com browser session. Install with `uv tool install twitter-cli`. `opencandle doctor` checks install status; `opencandle doctor --sessions` or the same Diagnostics section explicitly checks browser-session readiness.

Optional keys (see [configuration.md](./configuration.md) for env var names and setup):

- [Alpha Vantage](https://www.alphavantage.co) expands fundamentals, earnings, financial statements, DCF, and company comparison coverage.
- [FRED](https://fred.stlouisfed.org) adds macro series lookups.
- [Brave](https://brave.com/search/api/) adds a web search fallback.
- [Exa](https://exa.ai) web search runs keylessly through its MCP endpoint by default; a key upgrades it to the direct API for better quality and limits.
- [Finnhub](https://finnhub.io) adds company news to sentiment summaries.
- [London Strategic Edge](https://londonstrategicedge.com/data) unlocks its free tier: financial-statement access (used before Alpha Vantage by `get_financials` and `compute_dcf`) and split-adjusted intraday plus deep-range daily candles where the archive has coverage as the last fallback behind Yahoo Finance and Alpha Vantage. The data is licensed per key; bring your own key. OpenCandle does not redistribute LSE data.

## Caching and Degradation

External provider calls go through OpenCandle's shared cache and rate limiter. When a provider fails, tools return a clear degraded response instead of pretending the data is fresh. Search and social sources can also degrade based on available credentials, external-tool availability, and browser login state.

- Fresh data is returned when the provider succeeds.
- Stale cache can be used when the provider is temporarily unavailable, and is labeled as stale.
- Missing credentials are reported as setup gaps.
- Circuit breakers avoid repeatedly calling failing providers.

TradingView scanner data is keyless but unofficial and can be delayed by about 15 minutes. `screen_stocks` is intended for broad filtered scans such as market movers, oversold lists, or large-cap screens; single-security quotes, history, options, and company analysis use the Yahoo-backed quote/history tools and the fundamentals/options workflow tools. Watchlist checks use TradingView batch quotes for equity-like symbols and fill unresolved or unsupported symbols through Yahoo.

London Strategic Edge uses the LSE Data 3.0 API. Create an account-associated key at its [data dashboard](https://londonstrategicedge.com/data) and add it as `LSE_API_KEY` or in Settings. An old key may need replacing: `key-unknown` means the new API does not recognize it; `account-required` means the key needs an account. Doctor and GUI Diagnostics check financial-report access rather than just key presence.

OC downloads financial reports once per symbol and serializes CSV exports. Candle exports explicitly request split adjustment; checksums are verified when supplied, and malformed or incomplete files fail with a fallback instead of a partial success. OC supports US equities and Yahoo-style UK (`.L`/`.UK`) and Canadian (`.TO`) ticker suffixes for history. Availability depends on the symbol and dates: OC does not promise that every instrument has history back to 2003. A request beyond the provider's export limits or OC's 16 MiB local download bound should be narrowed; the hosted relay additionally limits responses to 4 MiB.

The free v3 plan currently allows 60 requests/minute, 12.5 GiB/week (reset Monday 00:00 UTC), 2.5 million measured rows per export, and 12.5 million measured rows/day. OC reads `/v3/usage`, persists a meter per credential in `lse-v3-usage.json`, and stops new LSE requests at 80% of the byte allowance or a reported quota exhaustion. Paid-plan unlimited byte allowances are respected. Daily row exhaustion and weekly byte exhaustion have separate resets. Doctor reports local quota blocks. Limits can change; the server's refusal and reset timing take precedence.

LSE's own-market prices are derived prices, not an official exchange or consolidated feed. Its [data licence](https://londonstrategicedge.com/licence/) permits personal research with your own key; organizational use and redistribution need separate licensing. OC's integration does not grant those rights. Paid Nasdaq/CME feeds, Level 3 orders, options, and macro datasets are not enabled by this compatibility update.

Polymarket probabilities are market-implied prices from a crypto-settled venue, not calibrated forecasts. `get_event_probabilities` reports the market question, per-outcome probability, volume/liquidity, close date, and the market's resolution criteria so the model can compare the market wording with the user's question.

Kalshi is intentionally deferred. Its market-data API has attractive macro contracts, but the Kalshi Data Terms prohibit feeding the data to an AI/ML system and providing cached data sets without prior written consent. OpenCandle will not add Kalshi support unless its data terms permit this use.

## Local State

OpenCandle user state defaults to `~/.opencandle/` for the local GUI and terminal; the web app keeps its state in your browser. Pi configuration is separate and stays in `.pi/` or `~/.pi/agent/`.

## Safety Boundary

OpenCandle does not guarantee completeness, accuracy, or suitability for trading decisions. It is designed to collect and organize research evidence. It should call out missing data, stale data, downside scenarios, and provider limitations instead of smoothing them over.
