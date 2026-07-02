# OpenCandle Codebase Audit

**Date:** 2026-03-29
**Last reviewed:** 2026-07-02
**Scope:** Repository review of the financial agent implementation, focusing on correctness, code quality, architecture, UX, and improvement opportunities.

This is an internal audit snapshot, not the public product reference. Statuses below have been updated where the current code clearly contradicts the original March 2026 finding; use the public docs for current command, provider, and tool coverage.

## Method

- Read the core runtime, provider, tool, infra, and test files.
- Ran `npm test`.
- Original result: 189 tests passed, 1 failed. The failing test was `tests/unit/providers/yahoo-options.test.ts`, which exposed a real options-Greeks correctness issue.
- Current local baseline on 2026-05-23: `npm test` passed with 1434 tests across 132 files.

## Executive Summary

The codebase is small, readable, and easy to navigate, but it has several finance-specific correctness problems that matter more than ordinary app bugs. The biggest risks are:

1. incorrect analytics being presented as reliable financial signals
2. misleading naming around data sources and tool capabilities
3. architecture that will become unstable once tool usage or concurrency increases
4. local hidden-file persistence that is convenient for demos but weak for a serious financial assistant

The highest-priority fixes are the options Greeks time handling, DCF net debt logic, correlation alignment, and backtest drawdown calculation.

---

## 1. Bugs

| Priority | Issue | Status | Evidence | Why it matters |
|----------|-------|--------|----------|----------------|
| P0 | Expiration-day options Greeks can collapse to zero | **FIXED** | `src/providers/yahoo-finance.ts` now uses `computeTimeToExpiry()` with market-close offset (21:00 UTC) and 1-hour floor. | The agent can show incorrect delta/theta/vega for same-day options, which is a serious finance correctness failure. |
| P0 | DCF net debt is effectively always zero | **FIXED** | `src/tools/fundamentals/dcf.ts` now uses `computeNetDebt()` with `totalDebt - cashAndEquivalents` when available. Fallback formula (`totalLiabilities - totalAssets`) is still questionable — see note below. | The DCF output systematically ignores leverage, overstating equity value for indebted companies. |
| P1 | `avgVolume` is mapped from the wrong Alpha Vantage field | **FIXED** | `src/providers/alpha-vantage.ts` now explicitly sets `avgVolume: 0` with a comment that Alpha Vantage OVERVIEW does not expose average volume. | Any downstream logic or UI using average volume will silently receive a price moving average instead of volume. |
| P1 | SEC filing "direct links" are not direct links | **FIXED** | New `src/tools/fundamentals/sec-filings.ts` added with accession-specific URLs. | Users are told they are getting filing links, but they are not taken to the actual filing document. |
| P1 | Prediction scoring ignores time horizon and target price | **FIXED** | `src/tools/portfolio/predictions.ts` now implemented with time-aware scoring. | Accuracy metrics are misleading because they do not answer whether the prediction succeeded within its intended window. |
| P1 | Correlation is calculated by index, not by date | **FIXED** | `src/tools/portfolio/correlation.ts` now includes `alignReturnsByDate()` that joins histories on common dates before computing returns. | Assets with different calendars, missing sessions, or sparse history will produce incorrect correlation numbers. |
| P1 | Backtest max drawdown is understated | **FIXED** | `src/tools/technical/backtest.ts` now tracks mark-to-market equity for drawdown (verified 2026-07-02). | The reported risk profile can look much safer than the actual path of the strategy. |

### Detailed Bug Notes

#### 1. Expiration-day options Greeks can collapse to zero

**Context**
The provider calculates time to expiry once per chain in `src/providers/yahoo-finance.ts:229-236`, using the raw expiration timestamp from Yahoo.

**Root cause**
Yahoo expiration values are date-based, but the code treats them as if they represent the precise end of the tradable session. On the expiration date itself, `Date.now()` quickly passes midnight UTC, so `timeYears` becomes `0` long before the options market is actually done trading.

**Observed symptom**
- The current test suite already exposes this on 2026-03-29.
- `npm test` fails in `tests/unit/providers/yahoo-options.test.ts` because a put delta is `0` instead of negative.

**Why another agent should care**
- This is not just a test fragility issue.
- Same-day options are one of the highest-sensitivity use cases.
- Returning `delta = 0` for a live OTM put materially changes the trading interpretation.

**Likely fix direction**
- Convert expiration to a market-close timestamp rather than midnight UTC.
- Consider using market close in Eastern Time for US equity options.
- Add a floor so "same day but not yet expired" still has a small positive `timeYears`.

**How to verify**
- Freeze time just before and just after market close on expiration day.
- Assert call delta stays positive and put delta stays negative before close.
- Assert Greeks collapse only after the contract is actually expired.

#### 2. DCF net debt is effectively always zero

**Context**
The DCF tool derives shares outstanding from market cap and price, then derives net debt from the latest financial statement in `src/tools/fundamentals/dcf.ts:177-189`.

**Root cause**
The formula `totalLiabilities - totalAssets + totalEquity` is algebraically equivalent to zero when the statement is internally consistent, because `equity = assets - liabilities`.

**Impact**
- Highly levered companies will be valued as if debt does not exist.
- The more debt-sensitive the equity story is, the more misleading the DCF becomes.

**Likely fix direction**
- Derive net debt from cash and debt fields if available.
- If those fields are unavailable, either surface "net debt unavailable" or use a clearly labeled approximation.
- Do not silently treat missing debt detail as true zero debt.

**How to verify**
- Add a tool-level unit test with synthetic statements where debt should reduce intrinsic value.
- Add an integration-level assertion that changing debt changes valuation.

#### 3. `avgVolume` is mapped from the wrong Alpha Vantage field

**Context**
`CompanyOverview.avgVolume` is filled in `src/providers/alpha-vantage.ts:43-46`.

**Root cause**
The code maps `avgVolume` from `50DayMovingAverage`, which is a price field, not a volume field.

**Impact**
- Any future screening, liquidity ranking, or UX that displays average volume will be wrong.
- This kind of mapping bug is especially dangerous because it looks like valid data rather than failing loudly.

**Likely fix direction**
- Map this to an actual volume field if Alpha Vantage exposes one in the overview response.
- Otherwise remove `avgVolume` from the normalized type for this provider rather than inventing it.

**How to verify**
- Add a contract test that asserts provider field mappings against a fixture with obviously different moving-average and volume values.

#### 4. SEC filing "direct links" are not direct links

**Context**
The tool advertises direct filing links, but URL generation happens in `src/providers/sec-edgar.ts:76-88`.

**Root cause**
- `accessionNoDash` is calculated and then ignored.
- The returned URL is always the generic EDGAR company browse page, not the filing document for the specific accession.

**Impact**
- Users have to manually search after clicking.
- The tool promise is stronger than what the implementation delivers.

**Likely fix direction**
- Construct accession-specific archive URLs.
- If only the company page is available, change the tool description and output text to say that clearly.

**How to verify**
- Add a test that confirms each returned URL contains the target accession number and resolves to the intended filing page pattern.

#### 5. Prediction scoring ignores time horizon and target price

**Context**
Predictions store `targetPrice`, `expiresAt`, and `timeframeDays`, but scoring is done in `src/tools/portfolio/predictions.ts:78-120`.

**Root cause**
`checkPredictions()` only compares entry price with the current spot price. It never asks:
- whether the prediction has expired
- whether the target was hit within the intended window
- whether unresolved predictions should be excluded

**Impact**
- The scorecard is closer to "mark current direction" than "evaluate historical forecast quality".
- Long-expired bullish calls can become "correct" months later and still count.

**Likely fix direction**
- Separate predictions into open, resolved, expired, and invalid.
- Score only resolved predictions by default.
- Use target and expiry rules in the resolution logic.

**How to verify**
- Add a test where an unexpired prediction remains unresolved.
- Add a test where an expired prediction never hit target.
- Add a test where a target-hit prediction still scores as correct even if price later reverses.

#### 6. Correlation is calculated by index, not by date

**Context**
The matrix logic lives in `src/tools/portfolio/correlation.ts:58-87`, and the pure math helper lives in `src/tools/portfolio/correlation.ts:6-28`.

**Root cause**
The code assumes return arrays are already aligned. They are not date-joined before correlation.

**Why this matters in practice**
- US and Canadian symbols can have different holidays.
- Newly listed names can have shorter history.
- Sparse or missing bars will silently shift the pairing.

**Impact**
The computed `r` can be mathematically valid for the wrong pairs of dates, which is worse than an outright failure.

**Likely fix direction**
- Join price histories on common dates first.
- Then compute returns from the aligned price series.
- Reject analyses where overlap is too small.

**How to verify**
- Add a regression fixture with intentionally misaligned dates.
- Assert that correlation changes when proper alignment is applied.

#### 7. Backtest max drawdown is understated

**Context**
Both strategy implementations track equity and drawdown in `src/tools/technical/backtest.ts`.

**Root cause**
Equity only changes when a sell occurs. While a trade is open, drawdown is measured against stale realized equity instead of the mark-to-market position value.

**Impact**
- Strategies can look much less risky than they were.
- A large intra-trade drawdown disappears from the stats if the trade later recovers before exit.

**Likely fix direction**
- Track portfolio equity every bar, not only at trade close.
- Compute peak and drawdown from that daily equity curve.
- Consider returning the equity curve for debugging and charting.

**How to verify**
- Add a scenario where a trade goes deeply underwater and later exits near breakeven.
- Expected result: non-trivial max drawdown even if realized PnL is small.

---

## 2. Bad Code

| Area | Status | Evidence | Problem |
|------|--------|----------|---------|
| Misleading "news sentiment" implementation | **FIXED** | Replaced by `get_web_sentiment`, `search_web`, and `get_sentiment_summary` over web/news search plus Reddit/Twitter/Finnhub sources. | Earlier versions exposed `get_news_sentiment` over filtered Reddit titles. Keep future copy precise about each source class. |
| Misleading Fear and Greed source and history | **FIXED** | `src/tools/macro/fear-greed.ts` and `src/providers/fear-greed.ts` now describe the alternative.me crypto index and return `null` for unavailable week/month history. | Earlier versions framed this as CNN Fear and Greed and filled missing history with `0`. Keep future UI and prose scoped to crypto sentiment unless a broader market source is added. |
| VWAP implementation is not session VWAP | **OPEN** | `src/tools/technical/indicators.ts` | This computes one cumulative price-volume average across the whole selected range of daily bars. That is not the VWAP traders normally mean. The name overstates analytical precision. |
| Timeout cleanup is incomplete | **FIXED** | `src/infra/http-client.ts` now clears timeout in `finally` block. | `clearTimeout(timeout)` only runs on the success path. Exceptions leave the timer behind until it fires, which is sloppy and unnecessary under load. |
| Hidden JSON files as application state | **PARTIALLY ADDRESSED** | Portfolio/watchlist/predictions still use hidden files, but SQLite database at `~/.opencandle/state.db` now exists for memory/workflow state. Full migration of portfolio state to SQLite is still pending. | Portfolio, watchlist, and prediction data are stored in hidden files in the current working directory, with no schema validation, locking, migration path, or corruption handling beyond "return empty". |

### Detailed Code Quality Notes

#### 1. News sentiment source wording is fixed

The old `get_news_sentiment` issue was resolved by removing that misleading tool surface and adding explicit web/news and cross-source sentiment tools. Current code exposes:

- `get_web_sentiment` for scored web/news search results
- `search_web` for raw web/news search
- `get_sentiment_summary` for Reddit, Twitter/X, web/news, and Finnhub aggregation

The remaining product boundary is source labeling: the assistant and UI should continue to say whether a sentiment result came from Reddit, Twitter/X, web search, Finnhub news, or historical local trend data.

#### 2. Fear and Greed source wording is fixed

`src/tools/macro/fear-greed.ts` now describes the source as the alternative.me Crypto Fear & Greed Index, and `src/providers/fear-greed.ts` returns `null` for unavailable week/month history instead of placeholder `0` values.

For another agent, the remaining product boundary is:

- the source is a crypto sentiment proxy
- future UI and assistant prose should not frame it as a broad equity-market sentiment gauge
- broader market fear/greed coverage would require a separate provider

#### 3. VWAP is being used as a label for a different statistic

`computeVWAP()` currently produces a cumulative volume-weighted average across the selected bar window. If the input is months of daily bars, that is closer to a range-weighted average price than to the session VWAP traders expect.

Another agent should decide one of two paths:

- implement a true session-based VWAP for intraday data, or
- rename this metric and stop using it as a trading signal in summaries

The current middle ground is misleading.

#### 4. Timeout lifecycle in `httpGet()` is not robust

The code is otherwise clean, but the timeout should be cleared in a `finally` block. A follow-up agent does not need to over-engineer this. The fix is small, but worth doing because:

- provider calls are central to the app
- retries amplify resource leaks
- this is the type of bug that only becomes visible under repeated failures

#### 5. Hidden JSON state is demo-friendly but production-hostile

The current persistence model makes sense for a prototype, but it has several shortcomings all at once:

- state is tied to working directory
- no file locking
- no validation
- no migration story
- no transaction history

Another agent should treat the three hidden JSON files as a single design smell, not as three isolated implementation details.

---

## 3. Implementation and Architecture Issues

| Priority | Issue | Evidence | Impact |
|----------|-------|----------|--------|
| P1 | Browser fallback is not safe for parallel tool execution | `src/infra/browser.ts:13-89` keeps a single shared `page` and reuses it for all work. At the same time, the project explicitly describes parallel tool execution in `README.md:57-69`. | Two concurrent Yahoo fallback requests can race on the same page state and contaminate each other. |
| P1 | Multi-analyst orchestration is not actually isolated | `src/analysts/orchestrator.ts:78-99` queues all analyst, synthesis, and validation prompts as follow-up user messages on one shared agent context. | There is no true role isolation, no dependency barrier before synthesis, and no durable analyst outputs. This is prompt choreography, not a robust multi-agent pipeline. |
| P2 | Comprehensive-analysis trigger path coverage | **FIXED:** `tests/e2e/cli.test.ts` now exercises `analyze NVDA`, which matches `isAnalysisRequest()` in `src/analysts/orchestrator.ts`. | Keep this path covered because it is a high-visibility workflow trigger. |
| P2 | Tool-level config access is inconsistent | Some tools use `getConfig()` while others read `process.env` directly, for example `src/tools/fundamentals/company-overview.ts:16-23`, `src/tools/fundamentals/financials.ts:16-23`, and `src/tools/macro/fred-data.ts:22-29`. | This makes dependency handling and testing less coherent, and it scatters environment coupling throughout the codebase. |

### Detailed Architecture Notes

#### 1. The shared browser page is a real concurrency risk

The README explicitly calls out parallel tool execution, but the stealth fallback browser is a singleton with one `Page` object. That means one tool call can navigate the page away while another call is still using it.

For another agent, the important context is:

- the launch path is serialized
- the usage path is not
- the problem will only show up under contention or retries

This is the kind of bug that is easy to miss in local testing and painful to diagnose later.

#### 2. The "multi-analyst" system is prompt sequencing, not isolated analysis workers

`runComprehensiveAnalysis()` pushes all analyst prompts, then synthesis, then validation into one shared conversation. There is no structural guarantee that:

- each analyst sees a clean role boundary
- synthesis happens after analyst work is complete
- validation is checking stable outputs instead of partially evolved context

This does not make the current feature useless, but it does mean another agent should not assume this is a genuine multi-agent architecture.

#### 3. The comprehensive-analysis path lacks real end-to-end coverage

The current test comment says it is validating the orchestrated path, but the prompt used in `tests/e2e/cli.test.ts:185-187` does not match the trigger patterns in `src/analysts/orchestrator.ts:103-106`.

That means:

- the main agent still answers something reasonable
- the test still passes
- the actual user-facing trigger path remains untested

This is a classic false-confidence testing problem.

#### 4. Config handling is distributed instead of centralized

The repo already has a config layer, but several tools bypass it and read environment variables directly. For another agent, the important implication is not style consistency alone. It affects:

- testability
- dependency injection
- future multi-runtime packaging
- observability of missing config

If this project grows, centralized config becomes more valuable quickly.

---

## 4. Bad User Experience

| Issue | Evidence | Why it is poor UX |
|-------|----------|-------------------|
| Users are told they are getting one thing while the product returns another | **PARTIALLY FIXED:** the old `get_news_sentiment` surface is gone and Fear & Greed now names the alternative.me crypto source. | Keep source labels precise; broader market sentiment or equity fear/greed would need separate providers. |
| Portfolio removal deletes the entire position | `src/tools/portfolio/tracker.ts:82-100` only supports removing the whole symbol. | Real users expect partial sells, realized PnL, and transaction history, not all-or-nothing deletion. |
| Hidden state depends on the current directory | `src/tools/portfolio/tracker.ts:7-20`, `src/tools/portfolio/watchlist.ts:6-27`, `src/tools/portfolio/predictions.ts:6-45` | A user can appear to "lose" their portfolio simply by launching the agent from a different folder. |
| Tool docs and README are stale | **FIXED IN PUBLIC DOCS:** README and public docs now describe tool coverage by domain instead of a brittle exact tool count, and testing docs point to current commands rather than stale test totals. | Avoid hardcoding test/tool counts in public docs unless a release process keeps them synchronized. |
| Missing-key handling is returned as normal text instead of a structured failure mode | Examples: `src/tools/fundamentals/company-overview.ts:17-23`, `src/tools/fundamentals/financials.ts:17-22`, `src/tools/macro/fred-data.ts:23-28`. | The agent may treat an error string as data instead of as a failed tool call, which produces awkward or misleading responses to the user. |

### Detailed UX Notes

#### 1. Naming drift damages trust

In finance, users judge trust not only by whether the app crashes, but by whether labels accurately describe the signal. Previously:

- "news sentiment" means filtered Reddit titles
- "Fear and Greed" implies CNN-style market sentiment but uses a crypto proxy

Current source labels are better, but agents should still preserve source boundaries in answers.

#### 2. Portfolio UX is closer to a scratchpad than a tracker

The current portfolio tool can add, remove, and view positions, but it lacks:

- partial sells
- realized PnL
- transaction ledger
- cash tracking
- portfolio-level history

That makes it usable for light experimentation, but weak as soon as a user expects brokerage-style mental models.

#### 3. Hidden cwd-based state will confuse real users

This is worth repeating because it is user-visible behavior, not just an implementation detail. If the user launches the app from a different directory:

- portfolio appears empty
- watchlist appears empty
- predictions appear empty

Nothing in the UX makes that behavior obvious.

#### 4. README drift has been reduced

The public README now avoids stale exact tool/test counts and points readers to focused docs for configuration, testing, and data sources. For another agent, the continuing lesson is that documentation work should not be separated from product-trust work: the product should not say more than the implementation reliably supports.

#### 5. Missing-provider-key handling should be machine-meaningful

Returning an `"Error: ..."` string as normal tool output is convenient, but it pushes responsibility to the LLM layer to interpret failure correctly. Another agent improving UX should strongly consider a structured failure contract so the assistant can say:

- this tool failed
- why it failed
- what the user can do next

instead of treating error text as if it were normal content.

---

## 5. General Improvements We Can Make

### Highest priority

1. Fix financial correctness first.
   - Repair options expiration handling.
   - Use a real net debt calculation for DCF.
   - Align correlation series by date.
   - Mark to market open positions in backtests.

2. Keep source labels precise.
   - Preserve the newer `get_web_sentiment` / `get_sentiment_summary` source boundaries.
   - Keep Fear & Greed framed as a crypto sentiment proxy unless a broader market source is added.
   - Correct provider-to-field mappings like `avgVolume`.

3. Replace ad hoc file persistence with a durable state layer.
   - Store portfolio, watchlist, and predictions in SQLite or a defined app data directory.
   - Add schema validation and transaction safety.
   - Preserve transaction history instead of only current snapshots.

### Next priority

4. Make the orchestration pipeline explicit.
   - Persist analyst outputs as structured objects.
   - Run synthesis only after all analysts complete.
   - Run validation against structured tool outputs, not only prompt text.

5. Improve testing for finance-specific failure modes.
   - Freeze time around option-expiry tests.
   - Add regression tests for date alignment in correlations.
   - Add tests for open-position drawdown.
   - Add a real E2E test for the `analyze TSLA` branch.
   - Add contract tests for provider field mappings.

6. Tighten tool contracts.
   - Return structured tool failures rather than plain `"Error: ..."` text.
   - Add freshness metadata consistently.
   - Distinguish "data unavailable", "provider blocked", and "bad user input".

### Longer-term improvements

7. Introduce a stronger domain model.
   - Separate raw provider payloads from normalized internal finance models.
   - Separate market data, analytics, and user-state concerns more cleanly.
   - Add source provenance to every derived metric.

8. Add auditability.
   - Show which tool and timestamp produced each key number.
   - Preserve analysis artifacts for later review.
   - Make validation results explicit instead of relying on prompt wording alone.

9. Revisit sentiment quality.
   - Move from keyword heuristics to a better scoring model.
   - Separate retail chatter, media/news, and company-specific event analysis.

### Expanded Improvement Workstreams

#### Workstream A: Financial correctness hardening

This should be the first engineering track because it directly affects the credibility of the product. Scope:

- options time-to-expiry handling
- DCF leverage treatment
- correlation date alignment
- mark-to-market backtest risk stats

Definition of done:

- targeted regression tests exist for each bug
- README and tool descriptions do not overstate precision
- outputs clearly distinguish approximations from hard facts

#### Workstream B: Product trust and signal labeling

This is the second track because several current outputs are more misleading than broken. Scope:

- rename or replace misleading sentiment tools
- fix Fear and Greed source framing
- fix provider-field mapping issues
- fix SEC filing link promises

Definition of done:

- every tool name matches its evidence source
- every metric shown to the user is either true, approximated, or unavailable, never silently fabricated

#### Workstream C: State and persistence redesign

A follow-up agent taking this on should think in terms of a small user-data subsystem rather than patching each tool separately. Scope:

- move JSON state into a durable store or app-data directory
- add schema validation
- support migrations
- record transaction/event history

Definition of done:

- user state no longer depends on current working directory
- state survives normal usage safely
- portfolio and prediction features have an audit trail

#### Workstream D: Orchestration and validation redesign

The current orchestration system is workable for demos, but brittle for a product that claims multi-analyst reasoning. Scope:

- structured analyst outputs
- explicit stage boundaries
- deterministic synthesis input set
- validation that compares outputs against tool details

Definition of done:

- analyst stages are inspectable
- synthesis runs on completed inputs
- validation is grounded in data objects, not only freeform text

#### Workstream E: Testing and observability

The test suite is already decent for a prototype, but it needs better finance-specific coverage. Scope:

- time-frozen option tests
- misaligned-history correlation fixtures
- equity-curve drawdown tests
- real comprehensive-trigger E2E
- provider contract tests

Definition of done:

- key financial calculations have scenario-based regression coverage
- feature tests cover real user entry points, not just adjacent behavior

---

## Recommended Order of Work

1. Correctness bugs: options, DCF, correlation, backtest
2. Naming and trust fixes: fear/greed, news sentiment, SEC links, README
3. State layer redesign: portfolio/watchlist/predictions
4. Orchestration redesign and validation hardening
5. Better finance-specific testing and observability

## Bottom Line

OpenCandle is a strong prototype, but not yet a trustworthy financial agent. The biggest gap is not feature breadth; it is analytical correctness and trustworthiness. If the next iteration fixes the current metric bugs, removes misleading labels, and hardens persistence/orchestration, the project will move from "impressive demo" to something materially more dependable.

---

## Status Update (2026-04-06)

**Resolved since original audit:**
- All P0 bugs fixed (options Greeks, DCF net debt)
- Most P1 bugs fixed (avgVolume, SEC links, prediction scoring, correlation alignment)
- Timeout cleanup fixed
- SQLite memory/state layer added at `~/.opencandle/state.db`
- Tool count has grown from 23 to ~28 registered tools

**Remaining open items:**
- Backtest drawdown (mark-to-market equity) — needs verification
- DCF fallback net-debt formula (`totalLiabilities - totalAssets`) is still not standard
- News sentiment and Fear & Greed naming/source issues still open
- VWAP misnaming still open
- Portfolio/watchlist/predictions still use hidden JSON files (not yet migrated to SQLite)
- Multi-analyst orchestration is still prompt sequencing, not isolated workers
- Browser singleton concurrency risk still present
- Config access inconsistency (some tools bypass `getConfig()`)

## Status Update (2026-07-02)

The 2026-04-06 open-items list above is retained as a snapshot; most of it has since been resolved:

- Backtest drawdown — fixed: `src/tools/technical/backtest.ts` tracks mark-to-market equity for drawdown.
- News sentiment and Fear & Greed naming — fixed. The Detailed Bug Notes in the body were updated after the 2026-04-06 snapshot and already mark these FIXED; the tool is labeled as the Crypto Fear & Greed Index from alternative.me.
- VWAP — output is now labeled "VWAP (cumulative)", so it is no longer misnamed, but it remains a cumulative-window calculation rather than session-anchored VWAP.
- Portfolio/watchlist/predictions — migrated to the SQLite state layer (`src/tools/portfolio/tracker.ts` uses `initDefaultDatabase`); no hidden JSON files remain.
- Multi-analyst orchestration — runs on the runtime-v2 `WorkflowRunner` via `buildComprehensiveAnalysisDefinition` in `src/analysts/orchestrator.ts`.
- Browser singleton — obsolete: `src/infra/browser.ts` no longer exists (Camoufox was removed in v0.7.0; Twitter/Reddit sentiment use external CLIs).
- Config access — the tools cited in the original finding now go through `getConfig()`.

**Still open:**
- DCF fallback net-debt formula (`totalLiabilities - totalAssets` in `src/tools/fundamentals/dcf.ts`) is still not the standard total-debt-minus-cash definition.
- VWAP is cumulative rather than session-anchored (labeled correctly, semantics unchanged).
