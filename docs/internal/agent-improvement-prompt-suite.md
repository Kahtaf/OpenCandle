# OpenCandle Agent Improvement Prompt Suite

> **Historical record (2026-05).** The operative benchmarking process is now `docs/internal/competitive-benchmarking.md`, which requires naturally worded retail-investor prompts and a 0-10 judge rubric; running this suite's fixed prompts verbatim would violate those rules. This file is kept because `docs/internal/competitive-benchmark-history.md` references its prompt IDs.

This is the first checkpoint artifact for improving OpenCandle as a financial agent. It turns realistic user prompts into repeatable eval cases for the existing product eval and competitive benchmark loops.

The goal is not to make OpenCandle win every comparison. The goal is to learn when a finance-native agent with tools, routing, workflows, and trace evidence gives a more useful answer than a generic no-tool agent, and when generic Claude, Codex, or Gemini answer more clearly.

## Harness Surface (as of 2026-05)

These were the authoritative harness paths when this suite was written:

- `npm run test:evals:product` runs curated OpenCandle-only product evals from `tests/evals/product/cases.ts`.
- `npm run test:evals:competitive` runs `tests/scripts/run-competitive-finance-eval.ts`, which compares OpenCandle to Claude, Codex, and Gemini through `acpx`.
- `OPENCANDLE_COMPETITIVE_PROMPT` and its metadata variables run one fixed competitive prompt.
- `COMPETITIVE_PROMPT_COUNT` and `COMPETITIVE_PROMPT_SEED` generate a prompt set at runtime.
- Raw JSON reports under `tests/evals/runs/` are local evidence only. Durable improvement summaries belong in `docs/internal/competitive-benchmark-history.md`.

The current product eval families are:

- `single_asset`
- `compare_assets`
- `portfolio`
- `options`
- `sentiment`
- `macro`
- `education`

## Prompt Selection Principles

Use prompts that sound like an investor or trader actually typed them:

- Preserve the user's messy wording, time horizon, cost basis, and risk appetite.
- Include prompts where OpenCandle should win because fresh data, options chains, filings, sentiment, macro data, or routing matter.
- Include prompts where generic agents may win because the task is educational, conceptual, or synthesis-heavy.
- Include ambiguous prompts that test whether OpenCandle asks a useful follow-up or states assumptions clearly.
- Prefer prompts that can expose a reusable product gap, not one-off trivia.
- Do not use prompts that require private account data unless the prompt itself provides hypothetical holdings or constraints.

## Scoring Rubric

Score every prompt on the dimensions below. For competitive runs, include the most important dimensions in `OPENCANDLE_COMPETITIVE_PROMPT_FOCUS` so the judge knows what to inspect.

| Dimension | What Good Looks Like | Failure Signals |
| --- | --- | --- |
| Tool selection | Calls the minimum useful tools for the user's actual task and avoids irrelevant workflows. | Wrong workflow, no tools for current-data tasks, overfetching that does not improve the answer. |
| Argument correctness | Uses the right symbols, held tickers, catalyst tickers, horizon, DTE, cost basis, budget, or macro series. | Uses a catalyst ticker as the underlying, drops the horizon, ignores cost basis, confuses BTC/GLD/ETF semantics. |
| Evidence quality | Grounds conclusions in concrete quotes, chains, filings, fundamentals, macro observations, or sentiment source coverage. | Generic market commentary, stale claims without dates, unsupported valuation or return numbers. |
| Financial correctness | Calculates option return, assignment economics, portfolio allocation, valuation, or macro interpretation coherently. | Wrong max loss, wrong premium return, misleading annualization, false certainty, mismatched date assumptions. |
| Risk framing | Names downside, uncertainty, invalidation, liquidity, concentration, assignment, macro regime, or source risk. | Only upside, no bear case, no liquidity or event risk, generic disclaimers instead of real risk. |
| Horizon fit | Adapts evidence and conclusion to the user's stated time horizon. | Uses long-term fundamentals for a 1-week trade, ignores 6-month catalysts, fails to separate short-term and long-term views. |
| Missing-data honesty | States unavailable providers, stale quotes, missing filings, missing sentiment sources, or unverified live data. | Pretends unavailable data exists, hides provider gaps, or treats missing data as proof of absence. |
| Answer usefulness | Gives a clear stance, ranking, next action, or decision framework matched to the prompt. | Waffles, refuses unnecessarily, buries the answer, or answers a different question. |
| Generic-agent comparison | Explains whether a no-tool agent was clearer, more concise, better structured, or appropriately cautious. | Treats every OpenCandle loss as bad luck instead of product signal. |

Recommended 1-5 scoring:

- 5: Strong answer that directly helps the user decide and uses the right evidence.
- 4: Useful answer with minor synthesis, completeness, or clarity gaps.
- 3: Partly useful but misses an important tool, risk, or user constraint.
- 2: Weak answer with substantial routing, evidence, or financial reasoning problems.
- 1: Misleading, mostly generic, or wrong for the prompt.

## Prompt Suite

### Options And Income Trades

#### `covered-call-runup-cost-basis`

Initial prompt:

```text
ASTS ran up recently and I want to sell a covered call. I am looking 1-2 weeks out. Cost basis is 76. What is the best one?
```

Likely follow-ups:

- "Would you still pick that strike if I don't want to lose the shares?"
- "Show static and annualized return, and compare the 1 week vs 2 week choice."

Expected route and data:

- Workflow: `options_screener`
- Tools: `get_option_chain`, `get_stock_quote`, optionally `search_web` or sentiment if catalyst context matters
- Must preserve: underlying ASTS, covered-call sale, 1-2 week DTE, cost basis 76

Generic-agent hypothesis:

- Generic agents may explain covered-call tradeoffs well but cannot verify current chain, premium, bid/ask, open interest, or Greeks.

Evaluation focus:

- Compare contract ranking, return math, cost-basis-aware assignment economics, liquidity caution, and whether the answer avoids long-call max-loss framing.

#### `covered-call-catalyst-held-symbol`

Initial prompt:

```text
NVDA earnings are today. If I have DRAM, what is the best covered call to sell right now? Cost basis is $51.
```

Likely follow-ups:

- "Did you use DRAM or NVDA for the option chain?"
- "What if I want to avoid assignment unless the premium is exceptional?"

Expected route and data:

- Workflow: `options_screener`
- Tools: `get_option_chain` for DRAM, `get_stock_quote` for DRAM, optional quote/search context for NVDA as catalyst
- Must preserve: DRAM is the held underlying; NVDA is context, not the option-chain underlying

Generic-agent hypothesis:

- Generic agents may ask clarifying questions or explain the ambiguity, but cannot verify live DRAM chain conditions.

Evaluation focus:

- Held-symbol extraction, catalyst separation, cost basis, stale/closed-market quote handling, assignment risk, and clear interpretation line.

#### `protective-put-after-rally`

Initial prompt:

```text
I own 200 shares of NVDA after a big rally. What's a reasonable protective put 30-45 days out that doesn't cost too much?
```

Likely follow-ups:

- "What percent of position value am I spending on the hedge?"
- "How much downside am I protected against?"

Expected route and data:

- Workflow: `options_screener`
- Tools: `get_option_chain`, `get_stock_quote`, optionally `analyze_risk`
- Must preserve: long shares, protective put, 30-45 DTE, cost sensitivity

Generic-agent hypothesis:

- Generic agents can explain protective puts, but should lose on live strike/premium/liquidity specifics.

Evaluation focus:

- Moneyness, premium as percent of position, hedge floor, liquidity, expiration fit, and downside/assignment distinctions.

### Compare Assets And Allocation Decisions

#### `aapl-msft-six-month`

Initial prompt:

```text
Should I compare AAPL and MSFT for a 6 month investment horizon, and what evidence should matter most?
```

Likely follow-ups:

- "Which would you pick if I only care about the next earnings cycle?"
- "What would make you change the pick?"

Expected route and data:

- Workflow: `compare_assets`
- Tools: `get_stock_quote`, `compare_companies`, `get_technical_indicators`, `analyze_risk`, optional sentiment/search
- Must preserve: six-month horizon and forward-looking catalyst emphasis

Generic-agent hypothesis:

- Generic agents may produce a cleaner framework, but lack live valuation, trend, and risk evidence.

Evaluation focus:

- Whether OpenCandle combines comparable evidence with a direct stance instead of dumping metrics.

#### `spy-qqq-rate-cut-allocation`

Initial prompt:

```text
For the next 12 months, should I overweight SPY or QQQ if rates start falling?
```

Likely follow-ups:

- "How would the answer change if inflation stays sticky?"
- "Give me a 60/40 style allocation between the two."

Expected route and data:

- Workflow: `compare_assets` or `general_finance_qa` with compare semantics
- Tools: `get_stock_quote`, `get_stock_history`, `analyze_risk`, `get_economic_data`, optional `get_fear_greed`
- Must preserve: 12-month horizon, rate-cut macro premise, allocation decision

Generic-agent hypothesis:

- Generic agents may frame duration/growth sensitivity well; OpenCandle should add current price/risk/macro context.

Evaluation focus:

- Macro-to-asset linkage, scenario split, risk-adjusted recommendation, and no false precision about future Fed moves.

#### `btc-gld-macro-hedge`

Initial prompt:

```text
For the next 6 months, should I use BTC or GLD as a macro hedge?
```

Likely follow-ups:

- "What exactly am I hedging: inflation, recession, or dollar weakness?"
- "Would you use both, and in what rough split?"

Expected route and data:

- Workflow: `compare_assets`
- Tools: `get_stock_quote` or crypto/ETF quote/history, `analyze_risk`, `get_crypto_history`, optional macro tools
- Must preserve: hedge objective, 6-month horizon, BTC vs GLD distinction

Generic-agent hypothesis:

- Generic agents often explain GLD as a steadier hedge and BTC as asymmetric/risk-on; OpenCandle should improve with current volatility and drawdown evidence.

Evaluation focus:

- Whether the answer asks or states what hedge objective matters and avoids treating BTC and GLD as interchangeable inflation hedges.

### Single-Asset Research

#### `nvda-buy-right-now`

Initial prompt:

```text
Should I buy NVDA right now? Give me a clear recommendation and risks.
```

Likely follow-ups:

- "What entry price would make this more attractive?"
- "Give me the bear case in one paragraph."

Expected route and data:

- Workflow: `single_asset_analysis`
- Tools: `get_stock_quote`, `get_company_overview`, `get_technical_indicators`, `get_earnings`, optional sentiment/search/sec
- Must preserve: direct buy/hold/avoid style stance and risk framing

Generic-agent hypothesis:

- Generic agents can give a concise framework; OpenCandle should win when it grounds the recommendation in current price and evidence.

Evaluation focus:

- Directness, evidence-backed stance, valuation/trend/risk balance, and no invented current metrics.

#### `tsla-bull-bear-change-mind`

Initial prompt:

```text
Give me the bull and bear case for TSLA and what would change your mind.
```

Likely follow-ups:

- "Which side has better evidence right now?"
- "What should I watch over the next quarter?"

Expected route and data:

- Workflow: `single_asset_analysis`
- Tools: `get_stock_quote`, `get_technical_indicators`, `get_earnings`, sentiment/search if configured
- Must preserve: explicit invalidation or change-of-mind criteria

Generic-agent hypothesis:

- Generic agents may be strong on narrative structure; OpenCandle needs concrete current evidence and watchpoints.

Evaluation focus:

- Balanced thesis, current evidence, explicit watchpoints, and avoided stale narrative claims.

### Portfolio Construction And Risk

#### `balanced-50k-three-years`

Initial prompt:

```text
Build me a balanced $50k portfolio for a 3 year horizon.
```

Likely follow-ups:

- If asked for risk tolerance: "Moderate risk, no single position above 20%."
- "Show why each holding belongs and what could go wrong."

Expected route and data:

- Workflow: `portfolio_builder`
- Tools: `ask_user` if needed, `get_stock_quote`, `analyze_risk`, `analyze_correlation`, macro/sentiment as useful
- Must preserve: budget 50k, balanced, 3-year horizon

Generic-agent hypothesis:

- Generic agents may create a clean generic allocation; OpenCandle should win if it uses current quotes/risk and respects constraints.

Evaluation focus:

- Whether the answer is actionable without pretending to know private preferences, and whether follow-up questions are limited to decision-critical gaps.

#### `conservative-income-100k`

Initial prompt:

```text
Create a conservative income portfolio with $100k for the next 5 years.
```

Likely follow-ups:

- "I care more about drawdown than yield."
- "How much should be in cash or short-term Treasuries?"

Expected route and data:

- Workflow: `portfolio_builder`
- Tools: `ask_user` if risk details are missing, `get_stock_quote`, macro/rates data, `analyze_risk`
- Must preserve: conservative income, 100k, 5-year horizon

Generic-agent hypothesis:

- Generic agents may handle allocation philosophy well; OpenCandle should add current rate and risk context.

Evaluation focus:

- Risk-first income construction, rate sensitivity, concentration limits, and clear assumptions.

### Macro And Market Regime

#### `falling-rates-growth-stocks`

Initial prompt:

```text
How should falling rates affect growth stocks over the next year?
```

Likely follow-ups:

- "Which indicators would tell us the setup is failing?"
- "Should I express this with QQQ or individual stocks?"

Expected route and data:

- Workflow: `general_finance_qa` or macro-focused agent task
- Tools: `get_economic_data`, `get_fear_greed`, optional `get_stock_quote` or `get_stock_history` for QQQ/SPY proxies
- Must preserve: one-year horizon and conditional macro reasoning

Generic-agent hypothesis:

- Generic agents may explain discount-rate mechanics well; OpenCandle should win if it adds current macro observations and market proxies.

Evaluation focus:

- Macro mechanism, current data dates, scenario split, and no overclaiming Fed path certainty.

#### `inflation-balanced-portfolio-risk`

Initial prompt:

```text
What macro risks matter most for a balanced portfolio right now?
```

Likely follow-ups:

- "Rank them by what I should monitor monthly."
- "How would you hedge the top two risks?"

Expected route and data:

- Workflow: `general_finance_qa`
- Tools: `get_economic_data`, `get_fear_greed`, optional market/risk tools
- Must preserve: balanced portfolio, current macro risks, practical monitoring

Generic-agent hypothesis:

- Generic agents may give a strong generic risk taxonomy; OpenCandle should add current macro data and market risk context.

Evaluation focus:

- Risk ranking, data freshness, monitoring indicators, and practical hedge framing.

### Sentiment And Narrative

#### `meta-reddit-news-source-gaps`

Initial prompt:

```text
What is Reddit and news sentiment saying about META, and which sources are missing?
```

Likely follow-ups:

- "Is retail sentiment diverging from the stock move?"
- "What should I not conclude from this data?"

Expected route and data:

- Workflow: `single_asset_analysis` or sentiment-focused agent task
- Tools: `get_sentiment_summary`, `get_reddit_sentiment`, `get_web_sentiment`, `get_stock_quote`, optional `get_sentiment_trend`
- Must preserve: source-specific coverage and missing-source disclosure

Generic-agent hypothesis:

- Generic agents should be cautious about lacking live sentiment; OpenCandle should win if sentiment providers return usable data.

Evaluation focus:

- Source separation, missing-data honesty, sentiment vs price divergence, and not overstating social chatter.

#### `ai-stocks-sentiment-winners`

Initial prompt:

```text
Summarize sentiment around AI stocks and tell me which names look most overhyped versus supported by evidence.
```

Likely follow-ups:

- "Which sources did you actually check?"
- "Separate mega-cap AI from speculative AI names."

Expected route and data:

- Workflow: `general_finance_qa` or sentiment-focused agent task
- Tools: `search_ticker`, `get_sentiment_summary`, `search_web`, `get_stock_quote`, optional fundamentals
- Must preserve: broad theme, evidence-supported vs hype split

Generic-agent hypothesis:

- Generic agents can structure the theme well; OpenCandle must avoid unsupported broad claims if source coverage is thin.

Evaluation focus:

- Ticker selection discipline, source coverage, hype/evidence distinction, and explicit uncertainty.

### SEC Filings And Thesis Change

#### `aapl-recent-filings-thesis`

Initial prompt:

```text
Find recent SEC filings for AAPL and tell me if anything would change a long-term investor's thesis.
```

Likely follow-ups:

- "Which filing did you rely on most?"
- "What did you not inspect in detail?"

Expected route and data:

- Workflow: `single_asset_analysis` or SEC-focused agent task
- Tools: `get_sec_filings`, `get_company_overview`, `get_stock_quote`, optional `search_web`
- Must preserve: primary-source filing trail and cautious thesis-change language

Generic-agent hypothesis:

- Generic agents cannot inspect current filings without tools and should say so; OpenCandle should win on primary-source evidence.

Evaluation focus:

- Filing dates/forms, thesis impact vs mere filing description, and honest limits on what was inspected.

#### `small-cap-8k-red-flags`

Initial prompt:

```text
A small-cap I follow just filed an 8-K. What red flags should I look for before deciding whether to stay in?
```

Likely follow-ups:

- "Use XYZ as the ticker."
- "What language in the filing would be most concerning?"

Expected route and data:

- Workflow: clarification first if no ticker, then SEC-focused agent task
- Tools: `ask_user` for missing ticker, then `get_sec_filings`, optional quote/search
- Must preserve: no ticker in initial prompt means clarify instead of guessing

Generic-agent hypothesis:

- Generic agents may give an excellent educational checklist; OpenCandle should only win after a ticker is supplied and filings are checked.

Evaluation focus:

- Clarification behavior, no ticker hallucination, filing-specific red flag extraction, and practical decision framing.

### Education And Conceptual Finance

#### `pe-ratio-limits`

Initial prompt:

```text
Explain how to use P/E ratios without over relying on them.
```

Likely follow-ups:

- "Give me a checklist I can use before comparing two stocks."
- "When is P/E actively misleading?"

Expected route and data:

- Workflow: `general_finance_qa`
- Tools: none required; optional tools only if examples are requested
- Must preserve: educational clarity without fake current data

Generic-agent hypothesis:

- Generic agents may win because this is mostly conceptual and does not need current tools.

Evaluation focus:

- Clear teaching, practical checklist, limitations, and avoiding unnecessary tool ceremony.

#### `options-greeks-beginner`

Initial prompt:

```text
Explain delta and theta for a beginner considering options.
```

Likely follow-ups:

- "Show me how that changes for a covered call."
- "What is the biggest beginner mistake here?"

Expected route and data:

- Workflow: `general_finance_qa`
- Tools: none required initially; `get_option_chain` only if user asks for live examples
- Must preserve: beginner level and practical risk framing

Generic-agent hypothesis:

- Generic agents may win on concise pedagogy; OpenCandle should not force live data unless it improves the answer.

Evaluation focus:

- Pedagogical clarity, correct Greeks intuition, risk warnings, and no unnecessary fetching.

### Watchlist, Memory, And Tracking

#### `watchlist-with-thesis`

Initial prompt:

```text
Add AMD, TSM, and ASML to my watchlist and remind me what would make each one worth buying.
```

Likely follow-ups:

- "Make the thesis conservative and valuation-sensitive."
- "Which one should I research first?"

Expected route and data:

- Workflow: `watchlist_or_tracking`
- Tools: `manage_watchlist`, `get_stock_quote`, optional fundamentals/search
- Must preserve: watchlist side effect plus thesis trigger for each name

Generic-agent hypothesis:

- Generic agents cannot actually update OpenCandle state; OpenCandle should win if the state change and thesis are both clear.

Evaluation focus:

- Correct state-oriented tool use, no generic watchlist prose only, and useful buy-trigger criteria.

#### `prediction-trackable`

Initial prompt:

```text
Track this prediction: if CPI keeps cooling, QQQ will beat SPY over the next 6 months.
```

Likely follow-ups:

- "What data should we use to judge it later?"
- "Can you restate the prediction so it is falsifiable?"

Expected route and data:

- Workflow: `watchlist_or_tracking` or `general_finance_qa`
- Tools: `track_prediction`, optional `get_stock_quote` for baseline, macro tools for CPI context
- Must preserve: falsifiable prediction, benchmark pair, 6-month horizon

Generic-agent hypothesis:

- Generic agents can rewrite the claim, but cannot persist the prediction in OpenCandle.

Evaluation focus:

- Falsifiability, baseline capture, evaluation date, and clear success metric.

## Recommended First Competitive Batch

Run these first because together they exercise the existing harness, likely OpenCandle strengths, and likely generic-agent strengths.

| Order | Prompt ID | Why It Is First |
| --- | --- | --- |
| 1 | `covered-call-runup-cost-basis` | Proven high-signal options case; tests DTE, cost basis, current chain, and return math. |
| 2 | `spy-qqq-rate-cut-allocation` | Tests macro plus asset allocation and whether generic agents explain rates better. |
| 3 | `aapl-recent-filings-thesis` | Tests primary-source SEC value that no-tool agents should not fake. |
| 4 | `meta-reddit-news-source-gaps` | Tests sentiment tools and missing-source honesty. |
| 5 | `balanced-50k-three-years` | Tests portfolio workflow, constraints, and whether OpenCandle asks only useful follow-ups. |
| 6 | `pe-ratio-limits` | Deliberately gives generic agents a likely strength case. |
| 7 | `btc-gld-macro-hedge` | Regression-sensitive macro hedge case with known benchmark history. |
| 8 | `nvda-buy-right-now` | Simple but high-value user prompt; tests whether OpenCandle gives a direct, evidence-backed stance. |

Example fixed-prompt run for the first case:

```bash
OPENCANDLE_COMPETITIVE_PROMPT_ID=covered-call-runup-cost-basis \
OPENCANDLE_COMPETITIVE_PROMPT_TOPIC=options \
OPENCANDLE_COMPETITIVE_PROMPT_COMPLEXITY=moderate \
OPENCANDLE_COMPETITIVE_PROMPT_FOCUS="Covered-call candidate quality after a run-up: preserve 1-2 week DTE and 76 cost basis, compare premium/return/assignment economics, frame downside and liquidity risk, and compare OpenCandle against generic no-tool agents." \
OPENCANDLE_COMPETITIVE_PROMPT="ASTS ran up recently and I want to sell a covered call. I am looking 1-2 weeks out. Cost basis is 76. What is the best one?" \
npm run test:evals:competitive
```

Example fixed-prompt run for a likely generic-agent strength case:

```bash
OPENCANDLE_COMPETITIVE_PROMPT_ID=pe-ratio-limits \
OPENCANDLE_COMPETITIVE_PROMPT_TOPIC=education \
OPENCANDLE_COMPETITIVE_PROMPT_COMPLEXITY=simple \
OPENCANDLE_COMPETITIVE_PROMPT_FOCUS="Conceptual explanation quality: compare clarity, practical checklist quality, limitations, risk framing, and whether OpenCandle avoids unnecessary live-data ceremony." \
OPENCANDLE_COMPETITIVE_PROMPT="Explain how to use P/E ratios without over relying on them." \
npm run test:evals:competitive
```

For a generated batch seeded from this suite:

```bash
COMPETITIVE_PROMPT_COUNT=5 \
COMPETITIVE_PROMPT_SEED=agent-improvement-suite-v1 \
npm run test:evals:competitive
```

## Follow-Up Flow Expectations

Use follow-up questions to test conversation quality, not only first-turn answers.

Good follow-up behavior:

- Ask for missing budget, risk tolerance, ticker, or objective only when it changes the decision.
- State assumptions when the prompt is ambiguous but still answerable.
- Keep prior-turn facts such as cost basis, horizon, held ticker, and risk preference.
- Tighten the recommendation after the user supplies constraints.
- Admit when the first answer used incomplete data or stale quotes.

Bad follow-up behavior:

- Re-ask for facts already provided.
- Lose the prior cost basis or horizon.
- Treat a catalyst ticker as the held ticker after the user clarified.
- Convert an investment decision into a generic explainer after the user asks for a pick.
- Hide tool/provider gaps on the second turn.

## Turning Prompt Results Into Product Work

After each competitive run:

1. Read the OpenCandle classification, router telemetry, tool calls, ask-user transcript, final answer, judge reason, `competitorsDidBetter`, and `openCandleImprovementIdeas`.
2. Classify the gap into one layer: routing, slot/entity extraction, workflow prompt, tool/provider data, transformation/calculation, final synthesis, or harness/judge.
3. If the gap is reusable, add or update a focused regression test before changing code.
4. Rerun the exact prompt with fixed `OPENCANDLE_COMPETITIVE_PROMPT_*` metadata.
5. If a committed change improves the result, add a compact row to `docs/internal/competitive-benchmark-history.md`.

Do not broaden from a single prompt until the failure recurs or the fix is clearly generic. Do not copy benchmark-specific tickers, rates, dollar amounts, share counts, or exact prompt phrases into production prompt guidance. If prompt guidance changes, prefer the selected policy card, workflow prompt, evidence normalization, answer contract, or structured check over the fallback playbook, and run `npx vitest run tests/unit/prompts/prompt-debt-guard.test.ts`.
