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
| Sentiment | `get_reddit_sentiment`, `get_twitter_sentiment`, `search_web`, `get_web_sentiment`, `get_sentiment_summary`, `get_sentiment_trend` | `rdt-cli` and `twitter-cli` using your normal browser sessions, Finnhub, DuckDuckGo, Brave, Exa |
| Filings | `get_sec_filings` | SEC EDGAR |
| Portfolio | `track_portfolio`, `analyze_risk`, `manage_watchlist`, `analyze_correlation`, `track_prediction` | Local state plus market providers |

## Keyed and Keyless Sources

Keyless by default:

- Yahoo Finance
- TradingView scanner (unofficial, delayed scanner endpoint; used read-only and batch-first)
- CoinGecko
- SEC EDGAR
- DuckDuckGo search
- alternative.me crypto Fear & Greed

External local tools:

- Reddit sentiment uses `rdt-cli` and the user's normal Reddit browser session. Install with `uv tool install rdt-cli`, then run `rdt login` if prompted. `opencandle doctor` checks install status; `opencandle doctor --sessions` or the GUI Diagnostics page explicitly checks browser-session readiness.
- Twitter/X sentiment uses `twitter-cli` and the user's normal x.com browser session. Install with `uv tool install twitter-cli`. `opencandle doctor` checks install status; `opencandle doctor --sessions` or the GUI Diagnostics page explicitly checks browser-session readiness.

Optional keys:

- `ALPHA_VANTAGE_API_KEY` expands fundamentals, earnings, financial statements, DCF, and company comparison coverage.
- `FRED_API_KEY` enables macro series lookups.
- `BRAVE_API_KEY` enables Brave as a web search fallback.
- `EXA_API_KEY` enables Exa web search.
- `FINNHUB_API_KEY` enables Finnhub company news in sentiment summaries.
- Search and social providers can degrade based on available credentials, external-tool availability, local browser login state, and provider health. Reddit sentiment requires `rdt-cli` plus a usable Reddit browser session; Twitter/X sentiment requires `twitter-cli` plus a usable x.com browser session.

## Caching and Degradation

External provider calls go through OpenCandle's shared cache and rate limiter. When a provider fails, tools return a clear degraded response instead of pretending the data is fresh:

- Fresh data is returned when the provider succeeds.
- Stale cache can be used when the provider is temporarily unavailable, and is labeled as stale.
- Missing credentials are reported as setup gaps.
- Circuit breakers avoid repeatedly calling failing providers.

TradingView scanner data is keyless but unofficial and can be delayed by about 15 minutes. `screen_stocks` is intended for broad filtered scans such as market movers, oversold lists, or large-cap screens; single-security quotes, history, options, and company analysis use the Yahoo-backed quote/history tools and the fundamentals/options workflow tools. Watchlist checks use TradingView batch quotes for equity-like symbols and fill unresolved or unsupported symbols through Yahoo.

## Local State

OpenCandle user state defaults to `~/.opencandle/`. Pi configuration is separate and stays in `.pi/` or `~/.pi/agent/`.

The CLI and GUI should not depend on repo-local `.pi/extensions/`. This keeps installed-package usage, source checkouts, and local GUI sessions from relying on accidental development artifacts.

## Safety Boundary

OpenCandle does not guarantee completeness, accuracy, or suitability for trading decisions. It is designed to collect and organize research evidence. It should call out missing data, stale data, downside scenarios, and provider limitations instead of smoothing them over.
