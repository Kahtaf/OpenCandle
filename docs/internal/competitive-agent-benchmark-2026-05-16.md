# Competitive Agent Benchmark — 2026-05-16

## Goal

Find where OpenCandle can outperform generic coding/chat agents on investor prompts, then turn the strongest gap into a small tested improvement.

## Prompt Set

1. Should I buy NVDA today? Give me an entry, stop, target, and what would change your mind.
2. Compare AAPL and MSFT for a 6-month trade. I care more about downside than upside.
3. Build a $25000 ETF portfolio for a conservative investor over 3 years.
4. Find an options trade idea for TSLA with defined risk and explain the Greeks.
5. What recent SEC filings for COIN could change the investment thesis?
6. Is Bitcoin sentiment getting overheated or improving? Compare price action and retail sentiment.
7. I own 40% NVDA, 25% MSFT, 20% AAPL, 15% cash. What is my biggest portfolio risk?
8. Backtest a simple moving-average strategy on SPY and tell me if it beats buy-and-hold.
9. What is the market pricing in for rate cuts, and which stock sectors are most exposed?
10. Give me the bull and bear case for PLTR, then force yourself to pick a side.

## Runs

OpenCandle was run through the deterministic source router with the same prompt set. A runtime smoke was also run through `tests/harness/manual-run.ts` for prompt 10 after the fix. That trace classified the prompt as `single_asset_analysis` and called `get_company_overview`, `get_stock_quote`, `get_earnings`, `get_financials`, `get_technical_indicators`, `get_sentiment_summary`, and `search_web`.

Codex and Claude were run once each as no-tool generic agents over the same 10 prompts. Both produced plausible frameworks, but repeatedly marked current market data as unavailable.

## OpenCandle Routing Result

| # | Expected tool-backed path | Before fix | After fix |
|---|---|---|---|
| 1 | `single_asset_analysis` | `single_asset_analysis` | `single_asset_analysis` |
| 2 | `compare_assets` | `compare_assets` | `compare_assets` |
| 3 | `portfolio_builder` | `portfolio_builder` | `portfolio_builder` |
| 4 | `options_screener` | `options_screener` | `options_screener` |
| 5 | `general_finance_qa` with `COIN` only | `general_finance_qa` with `SEC`, `COIN` | `general_finance_qa` with `COIN` only |
| 6 | `general_finance_qa` | `compare_assets` | `general_finance_qa` |
| 7 | `watchlist_or_tracking` | `compare_assets` | `watchlist_or_tracking` |
| 8 | `general_finance_qa` | `unclassified` | `general_finance_qa` |
| 9 | `general_finance_qa` | `general_finance_qa` | `general_finance_qa` |
| 10 | `single_asset_analysis` | `unclassified` | `single_asset_analysis` |

## Generic Agent Findings

Codex:
- Explicitly could not know today's prices, filings, options chains, IV, sentiment, rate-cut odds, or backtest results.
- Gave sensible but generic frameworks for entries, ETF allocations, options spreads, and rate-sensitive sectors.
- Could identify portfolio concentration risk well without tools.

Claude:
- Explicitly marked current prices, filings, sentiment, and Fed funds futures as stale.
- Gave stronger generic finance structure than Codex in several places, especially options Greeks and portfolio concentration.
- Still could not verify live EDGAR filings, Bitcoin sentiment, SPY backtest results, or current rate-cut pricing.

## Top Candidate

The best near-term improvement is router coverage for competitive financial prompts. This is more valuable than prompt polish because the generic agents' weakness is not wording; it is lack of fresh, domain-specific data. OpenCandle only gets that advantage when the router sends the prompt to a workflow that can call quote, options, SEC, sentiment, backtest, macro, or portfolio tools.

## Implemented Fix

- Route bull/bear single-stock prompts to `single_asset_analysis`.
- Route existing-holdings risk prompts before multi-symbol compare routing.
- Route backtest, sentiment, and rate-cut prompts to the tool-backed general finance path.
- Stop extracting `SEC` as a ticker in natural-language filing prompts.
- Pin all 10 competitive prompts in `tests/unit/routing/classify-intent.test.ts`.

## Validation

- Red test: the new targeted routing cases initially failed for prompts 5, 6, 7, 8, and 10.
- Green test: `./node_modules/.bin/vitest run tests/unit/routing/classify-intent.test.ts` passes with 54 tests.
- Full unit suite: `npm test` passes with 120 files and 1257 tests.
- Build: `npm run build` passes.
- Runtime smoke: `perl -e 'alarm 240; exec @ARGV' npx tsx tests/harness/manual-run.ts /private/tmp/oc-runtime-smoke 'Give me the bull and bear case for PLTR, then force yourself to pick a side.'` completed and wrote a trace with `single_asset_analysis` classification plus tool calls.
- Review smoke: `perl -e 'alarm 240; exec @ARGV' npx tsx tests/harness/manual-run.ts /private/tmp/oc-review-smoke 'Compare AAPL and MSFT sentiment'` completed and wrote a trace with `compare_assets` classification plus compare workflow tool calls.
