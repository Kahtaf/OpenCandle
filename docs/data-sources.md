---
title: Data Sources
description: Provider coverage, credentials, and data boundaries in OpenCandle.
---

# Data Sources

OpenCandle combines free public sources, optional keyed APIs, and local state. Tools gather data and return structured details. The model can synthesize those details, but tool implementations should not invent financial conclusions or hardcode market numbers.

## Provider Coverage

| Domain | Tools | Providers |
| --- | --- | --- |
| Market | `search_ticker`, `screen_stocks`, `get_stock_quote`, `get_stock_history` | Yahoo Finance; TradingView scanner for breadth screening and watchlist batch quotes; Alpha Vantage fallback for quote/history when configured |
| Crypto | `get_crypto_price`, `get_crypto_history` | CoinGecko |
| Options | `get_option_chain` with Greeks computed inside the result | Yahoo Finance plus local calculations |
| Fundamentals | `get_company_overview`, `get_financials`, `get_earnings`, `compute_dcf`, `compare_companies` | Alpha Vantage |
| Macro | `get_economic_data`, `get_fear_greed` | FRED, alternative.me crypto Fear & Greed |
| Technical | `get_technical_indicators`, `backtest_strategy` | Local calculations over market history |
| Sentiment | `get_reddit_sentiment`, `get_twitter_sentiment`, `search_web`, `get_web_sentiment`, `get_sentiment_summary`, `get_sentiment_trend` | Reddit JSON API, Twitter/X local browser session, Finnhub, DuckDuckGo, Brave, Exa |
| Filings | `get_sec_filings` | SEC EDGAR |
| Portfolio | `track_portfolio`, `analyze_risk`, `manage_watchlist`, `analyze_correlation`, `track_prediction` | Local state plus market providers |

## Keyed and Keyless Sources

Keyless by default:

- Yahoo Finance
- TradingView scanner (unofficial, delayed scanner endpoint; used read-only and batch-first)
- CoinGecko
- Reddit JSON API
- SEC EDGAR
- DuckDuckGo search
- alternative.me crypto Fear & Greed

Optional keys:

- `ALPHA_VANTAGE_API_KEY` expands fundamentals, earnings, financial statements, DCF, and company comparison coverage.
- `FRED_API_KEY` enables macro series lookups.
- `BRAVE_API_KEY` enables Brave as a web search fallback.
- `EXA_API_KEY` enables Exa web search.
- `FINNHUB_API_KEY` enables Finnhub company news in sentiment summaries.
- Search and social providers can degrade based on available credentials, local browser login state, and provider health. Twitter/X sentiment requires a local browser session.

## Caching and Degradation

External provider calls should use OpenCandle's shared cache and rate limiter. When a provider fails, tools should prefer a clear degraded response over pretending the data is fresh.

Expected behavior:

- Fresh data is returned when the provider succeeds.
- Stale cache can be used when the provider is temporarily unavailable.
- Missing credentials are reported as setup gaps.
- Circuit breakers avoid repeatedly calling failing providers.
- Unit tests mock provider responses with fixtures.

TradingView scanner data is keyless but unofficial and can be delayed by about 15 minutes. `screen_stocks` is intended for broad filtered scans such as market movers, oversold lists, or large-cap screens. Single-security quotes, history, options, and company analysis should still use the Yahoo-backed quote/history tools and the fundamentals/options workflow tools. Watchlist checks use TradingView batch quotes for equity-like symbols and fill unresolved or unsupported symbols through Yahoo.

The TradingView scanner implementation reimplements request grammar and decoding discipline in TypeScript rather than copying source. Reference projects used for protocol cross-checking include `himself65/finance-skills`, `shner-elmo/TradingView-Screener`, `deepentropy/tvscreener`, `Fynnius/TradingView.Screener`, and `ryar001/tradingview-screener-wrapper`; confirm upstream licenses before adapting non-trivial source.

## Local State

OpenCandle user state defaults to `~/.opencandle/`. Pi configuration is separate and stays in `.pi/` or `~/.pi/agent/`.

The CLI and GUI should not depend on repo-local `.pi/extensions/`. This keeps installed-package usage, source checkouts, and local GUI sessions from relying on accidental development artifacts.

## Safety Boundary

OpenCandle does not guarantee completeness, accuracy, or suitability for trading decisions. It is designed to collect and organize research evidence. It should call out missing data, stale data, downside scenarios, and provider limitations instead of smoothing them over.
