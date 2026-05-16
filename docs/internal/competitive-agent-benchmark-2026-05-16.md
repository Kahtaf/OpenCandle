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

## Loop 1: Sentiment Comparison Evidence

Issue found after the first routing fix: `Compare AAPL and MSFT sentiment` routed to `compare_assets`, but the compare workflow only fetched quote, fundamentals, technicals, risk, and correlation. It did not fetch sentiment data, so OC still did not have concrete evidence generic agents lacked.

Fix:
- Extract `compareMetrics: ["sentiment"]` from prompts that mention sentiment.
- Carry that focus into `compare_assets` workflow resolution.
- Add `get_sentiment_summary` instructions for each compared symbol when the comparison asks for sentiment.
- Preserve more-specific options and multi-symbol compare routing before the generic sentiment rule.

Focused benchmark prompt: `Compare AAPL and MSFT sentiment`

| Agent | Evidence gathered | Answer quality signal |
|---|---|---|
| OpenCandle | Classified as `compare_assets`; called `get_stock_quote`, `compare_companies`, `get_technical_indicators`, `analyze_risk`, `analyze_correlation`, and `get_sentiment_summary` for both symbols. | Produced current prices and aggregate sentiment scores: AAPL `-0.50 (Bearish)`, MSFT `-0.07 (Leaning Bearish)`, with source-availability caveats. |
| Codex no-tool baseline | No fresh data. | Explicitly said current market/news/social sentiment was unavailable and gave a general non-current view. |
| Claude no-tool baseline | No fresh data. | Explicitly said no live data and gave an August 2025-stale view. |

Conclusion: for this prompt OC now works better than generic agents in the concrete way that matters for the product: it investigates with fresh tool-backed sentiment evidence while generic agents can only provide stale frameworks.

## Loop 2: Exact SEC Ticker Evidence

Issue found in the next focused run: `What recent SEC filings for COIN could change the investment thesis?` called the SEC filings tool, but the provider accepted EDGAR text-search decoys whose filing text mentioned COIN while the actual registrant ticker was not COIN. OC was using tools, but the evidence was wrong-company evidence.

Fix:
- Filter SEC search hits to display names that contain the requested ticker as an exact ticker group.
- Keep accession de-duplication after the ticker check so decoys do not consume result slots.
- Add a provider regression test with a Datavault decoy before a Coinbase filing.

Focused benchmark prompt: `What recent SEC filings for COIN could change the investment thesis?`

| Agent | Evidence gathered | Answer quality signal |
|---|---|---|
| OpenCandle | Called `get_sec_filings`; returned Coinbase Global, Inc. filings with CIK `1679788` and SEC archive links. | Avoided wrong-company filings and produced concrete EDGAR links that generic agents cannot verify without tools. |
| Generic no-tool baseline | No live EDGAR access. | Can describe what forms matter, but cannot prove the recent filing set or validate the registrant. |

Conclusion: OC is better only if tool output is entity-correct. Exact ticker filtering turns SEC retrieval from plausible-but-risky into concrete evidence.

## Loop 3: ETF Portfolio Constraint Evidence

Issue found in the portfolio prompt: `Build a $25000 ETF portfolio for a conservative investor over 3 years.` routed correctly, but slot extraction lost two user constraints. It defaulted to `1y_plus` and `mixed_etf_and_large_cap_equities`, which let the workflow drift toward generic portfolio construction.

Fix:
- Extract explicit multi-year horizons such as `3 years` into `3_years`.
- Extract `ETF` / `ETFs` as `assetScope: "etf_focused"`.
- Resolve portfolio `assetScope` from user entities before preferences/defaults.

Focused benchmark prompt: `Build a $25000 ETF portfolio for a conservative investor over 3 years.`

| Agent | Evidence gathered | Answer quality signal |
|---|---|---|
| OpenCandle | Runtime trace resolved `budget: 25000`, `riskProfile: conservative`, `timeHorizon: 3_years`, and `assetScope: etf_focused`; called ETF quote, risk, and correlation tools. | Produced an ETF-only draft using live ETF prices, drawdowns, volatility, and correlations. |
| Generic no-tool baseline | No live ETF risk/correlation data. | Can suggest a reasonable allocation framework, but cannot compute current ETF risk and diversification evidence. |

Conclusion: preserving user constraints is part of OC's edge. The portfolio answer now stays inside the requested ETF-only, 3-year shape while adding live risk data.

## Loop 4: Rate-Cut Pricing Evidence

Issue found in the macro prompt: `What is the market pricing in for rate cuts, and which stock sectors are most exposed?` used macro and search tools, but the prompt guidance let the model blur historical Fed funds data with market-implied cut expectations.

Fix:
- Add prompt guidance requiring `get_economic_data` for the current Fed funds backdrop.
- Add prompt guidance requiring web search for CME FedWatch / Federal Funds futures probabilities before stating what the market is pricing.
- Add a prompt-context regression test so this instruction stays in the tool-use contract.

Focused benchmark prompt: `What is the market pricing in for rate cuts, and which stock sectors are most exposed?`

| Agent | Evidence gathered | Answer quality signal |
|---|---|---|
| OpenCandle | Called `get_economic_data` for `FEDFUNDS`; searched for `CME FedWatch Tool Federal Funds futures probabilities rate cuts` and other futures-pricing queries. | Distinguished the 3.64% latest Fed funds print from market-implied expectations and cited current rate-cut pricing evidence. |
| Generic no-tool baseline | No live futures/FedWatch access. | Can list rate-sensitive sectors, but cannot verify current pricing. |

Conclusion: OC now does the thing generic agents explicitly cannot: separate historical rates from live market-implied probabilities before naming the setup.

## Loop 5: Options Greeks Evidence

Issue found in the options prompt: `Find an options trade idea for TSLA with defined risk and explain the Greeks.` called quote and option-chain tools, but the response table only required delta, IV, open interest, and spread. That made the answer look closer to a generic options framework than a full chain-backed Greeks answer.

Fix:
- Require the ranked options table to include delta, gamma, theta, vega, and rho.
- Add a workflow prompt regression test for the full Greeks table contract.

Focused benchmark prompt: `Find an options trade idea for TSLA with defined risk and explain the Greeks.`

| Agent | Evidence gathered | Answer quality signal |
|---|---|---|
| OpenCandle | Called `get_stock_quote` and `get_option_chain`; runtime answer included Delta, Gamma, Theta, Vega, Rho, IV, OI, and Bid-Ask columns. | Ranked live TSLA contracts and surfaced missing Greek fields as `N/A` instead of silently omitting them. |
| Generic no-tool baseline | No current option chain, IV, spread, or open-interest data. | Can explain Greeks conceptually, but cannot rank live contracts or prove liquidity. |

Conclusion: OC's advantage is not only knowing definitions. It can bind the Greeks explanation to the live chain and make missing data visible.

## Loop 6: Backtest Metric Evidence

Issue found in the backtest prompt: `Backtest a simple moving-average strategy on SPY and tell me if it beats buy-and-hold.` called the backtest tool, but the final answer initially compressed the output to return comparison. It left out trades, win rate, and max drawdown even though the tool had computed them.

Fix:
- Add prompt guidance requiring `backtest_strategy` results to report strategy return, buy-and-hold return, outperformance, trade count, win rate, and max drawdown.
- Add a prompt-context regression test covering win rate and max drawdown requirements.

Focused benchmark prompt: `Backtest a simple moving-average strategy on SPY and tell me if it beats buy-and-hold.`

| Agent | Evidence gathered | Answer quality signal |
|---|---|---|
| OpenCandle | Called `backtest_strategy`; runtime answer reported 20.31% strategy return, 39.81% buy-and-hold return, -19.50% outperformance, 5 trades, 60% win rate, and 9.63% max drawdown. | Answered the user-facing question and exposed enough metrics to judge whether the backtest is robust. |
| Generic no-tool baseline | No live historical backtest execution. | Can describe how to backtest, but cannot produce current computed SPY results. |

Conclusion: OC works better when it preserves the full computed result, not just the headline.

## Implemented Fix

- Route bull/bear single-stock prompts to `single_asset_analysis`.
- Route existing-holdings risk prompts before multi-symbol compare routing.
- Route backtest, sentiment, and rate-cut prompts to the tool-backed general finance path.
- Stop extracting `SEC` as a ticker in natural-language filing prompts.
- Add sentiment-focused compare workflow instructions when a multi-asset comparison asks for sentiment.
- Pin all 10 competitive prompts in `tests/unit/routing/classify-intent.test.ts`.
- Filter SEC filing search hits to the exact requested ticker.
- Preserve explicit ETF-only portfolio scope and multi-year horizon slots.
- Require futures/FedWatch search for rate-cut pricing prompts.
- Require full Greeks columns in options rankings.
- Require trade count, win rate, and max drawdown in backtest summaries.

## Validation

- Red test: the new targeted routing cases initially failed for prompts 5, 6, 7, 8, and 10.
- Green test: `./node_modules/.bin/vitest run tests/unit/routing/classify-intent.test.ts` passes with 54 tests.
- Targeted regression set: `./node_modules/.bin/vitest run tests/unit/providers/sec-edgar.test.ts tests/unit/routing/entity-extractor.test.ts tests/unit/routing/slot-resolver.test.ts tests/unit/prompts/context-builder.test.ts tests/unit/prompts/workflow-prompts.test.ts tests/unit/workflows/compare-assets.test.ts tests/unit/routing/classify-intent.test.ts` passes with 7 files and 175 tests.
- Full unit suite: `npm test` passes with 120 files and 1266 tests.
- Build: `npm run build` passes.
- Diff hygiene: `git diff --check` passes.
- Runtime smoke: `perl -e 'alarm 240; exec @ARGV' npx tsx tests/harness/manual-run.ts /private/tmp/oc-runtime-smoke 'Give me the bull and bear case for PLTR, then force yourself to pick a side.'` completed and wrote a trace with `single_asset_analysis` classification plus tool calls.
- Review smoke: `perl -e 'alarm 240; exec @ARGV' npx tsx tests/harness/manual-run.ts /private/tmp/oc-review-smoke 'Compare AAPL and MSFT sentiment'` completed and wrote a trace with `compare_assets` classification plus compare workflow tool calls.
- Loop 1 smoke: `perl -e 'alarm 240; exec @ARGV' npx tsx tests/harness/manual-run.ts /private/tmp/oc-loop1-smoke 'Compare AAPL and MSFT sentiment'` completed and wrote a trace with `compare_assets`, `compareMetrics: ["sentiment"]`, and two `get_sentiment_summary` calls.
- Loop 2 smoke: `perl -e 'alarm 240; exec @ARGV' npx tsx tests/harness/manual-run.ts /private/tmp/oc-loop2-sec 'What recent SEC filings for COIN could change the investment thesis?'` completed and wrote a trace with Coinbase Global, Inc. filings under CIK `1679788`.
- Loop 3 smoke: `perl -e 'alarm 240; exec @ARGV' npx tsx tests/harness/manual-run.ts /private/tmp/oc-loop3-portfolio 'Build a $25000 ETF portfolio for a conservative investor over 3 years.'` completed and wrote a trace with `timeHorizon: "3_years"`, `assetScope: "etf_focused"`, ETF quotes, risk, and correlation calls.
- Loop 4 smoke: `perl -e 'alarm 240; exec @ARGV' npx tsx tests/harness/manual-run.ts /private/tmp/oc-loop4-rates 'What is the market pricing in for rate cuts, and which stock sectors are most exposed?'` completed and wrote a trace with `FEDFUNDS` plus CME FedWatch / Federal Funds futures searches.
- Loop 5 smoke: `perl -e 'alarm 240; exec @ARGV' npx tsx tests/harness/manual-run.ts /private/tmp/oc-loop5-options 'Find an options trade idea for TSLA with defined risk and explain the Greeks.'` completed and wrote a trace with stock quote, option-chain calls, and full Greeks columns.
- Loop 6 smoke: `perl -e 'alarm 240; exec @ARGV' npx tsx tests/harness/manual-run.ts /private/tmp/oc-loop6-backtest 'Backtest a simple moving-average strategy on SPY and tell me if it beats buy-and-hold.'` completed and wrote a trace with `backtest_strategy`, returns, trade count, win rate, and max drawdown.
