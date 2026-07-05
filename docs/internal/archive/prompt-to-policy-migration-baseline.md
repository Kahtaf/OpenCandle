# Planning Baseline Evidence

This file is historical validation evidence for a specific implementation change. It is not current implementation guidance. Use it to understand preserved behavior and test evidence, not as a pattern for new product docs.

Date: 2026-05-24

Change: `prompt-to-policy-agent-planning`

## Unit Baseline

- Command: `npm test`
- Result: passed
- Test files: 134 passed
- Tests: 1454 passed
- Purpose: current unit/router/prompt baseline before enabling planning-layer behavior.

## Targeted Harness Baseline

Manifest path: `docs/internal/prompt-to-policy-migration-manifest.json`

Target prompt ID: `no-tool-valuation-education`

Prompt:

```text
Explain how to use P/E ratios without over relying on them.
```

Committed trace path:

- `docs/internal/baselines/prompt-to-policy/2026-05-24/no-tool-valuation-education-trace.json`

Runtime IPC trace source:

- `/tmp/opencandle-prompt-policy-baseline-no-tool/trace.json`

Observed baseline:

| Field | Value |
| --- | --- |
| Turns | 1 |
| Tool sequence | `[]` |
| Interactions | 0 |
| Final answer chars | 5706 |
| Custom route entries | none emitted |

Route baseline note:

- The committed manifest records the expected route baseline for this prompt as `routeKind: agent_task`, `workflow: general_finance_qa`, task family `concept_explainer`, and no active tool bundles.
- The current external harness trace did not emit an `opencandle-router` custom entry for this run, so the route baseline is represented by the manifest plus existing router/prompt unit tests. Trace-level route capture is deferred to the eval/trace migration tasks in this change.

Final-answer hard assertions to preserve:

- no live data tool calls
- no OpenCandle tool names in the answer
- educational structure: Bottom line, Core mental model, Practical workflow, Where it misleads, Cross-checks, Quick checklist
- no analyst commitment/confidence/invalidation boilerplate

## Baseline Scope

This first section is a targeted smoke baseline. The full manifest comparison is recorded below.

## V1 Scaffold Validation

Date: 2026-05-24

Commands:

- `npm run build` — passed
- `npm test` — passed, 141 files / 1491 tests
- `graphify update .` — passed, graph rebuilt with 8443 nodes and 13220 edges

Selected-slice live harness smoke:

| Prompt ID | IPC trace | Tool sequence | Interactions | Final answer chars | Result |
| --- | --- | --- | --- | --- | --- |
| `ticker-alias-armh` | `/tmp/oc-harness.Tmq19w` | `search_ticker`, `get_company_overview`, `search_web` | 1 | 757 | Passed selected-slice smoke: answer led with `ARM` as the current Nasdaq ticker and explained licensing/royalty business model. |
| `unknown-ticker-earnings-risk` | `/tmp/oc-harness.9DD6DV` | `get_stock_quote`, `get_earnings` | 1 | 5392 | Passed selected-slice smoke: provider gaps were disclosed, no current ZZZZ facts were invented, and the answer continued with an event-risk trim/hold framework. |

Eval limitations:

- Direct `npx tsx -e` harness import failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` from `@earendil-works/pi-coding-agent`; the same prompts were rerun through `tests/harness/cli.ts`, which completed.
- `npm run test:evals` currently fails before running eval cases with `TypeError: define is not a function` from `vitest-evals/src/index.ts`. This is outside the planning unit harness added here and blocks a full eval-suite manifest run in this session.

## Full Manifest Comparison

Date: 2026-05-24

Command:

- `npx tsx tests/scripts/run-prompt-policy-manifest.ts`

Report:

- `tests/evals/runs/2026-05-24T20-31-43-658Z_prompt-policy-manifest.json`
- Replacement-active rerun after removing selected legacy prompt clauses: `tests/evals/runs/2026-05-24T20-59-47-837Z_prompt-policy-manifest.json`
- Ref-parity follow-up rerun after adding the baseline-ref comparator: `tests/evals/runs/2026-05-24T22-22-20-298Z_prompt-policy-manifest.json`

Result:

- Passed 16/16 committed manifest prompts.
- Passed 16/16 committed manifest prompts after moving selected ticker-disambiguation prompt ownership from fallback playbook clauses to the replacement policy card.
- Passed 16/16 committed manifest prompts after adding the old-vs-current ref parity runner.
- Compared route kind, workflow, task family, commitment mode, tool bundles, tool calls, evidence records, capability-gap disclosure, structured-check failures, retry eligibility, and deterministic final-answer hard assertions.

Notes:

- The dedicated manifest runner is committed as `tests/scripts/run-prompt-policy-manifest.ts` because `npm run test:evals` is still blocked by the `vitest-evals` `define is not a function` loader failure above.
- Generated run reports under `tests/evals/runs/` are gitignored; the path above is recorded as local validation evidence.

## Ref Parity Comparison

Date: 2026-05-24

Command:

- `PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=ticker-alias-armh,unknown-ticker-earnings-risk,market-closed-today-move,sentiment-source-coverage,filing-thesis-review,no-tool-valuation-education PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts`

Report:

- `tests/evals/runs/2026-05-24T22-15-02-587Z_prompt-policy-ref-parity.json`
- `tests/evals/runs/2026-05-24T22-29-27-818Z_prompt-policy-ref-parity.json`
- `tests/evals/runs/2026-05-24T22-34-37-321Z_prompt-policy-ref-parity.json`

Result:

- Passed 16/16 old-vs-current manifest parity cases against baseline ref `3e3a039` across three focused batches.
- Both baseline and current implementations passed their manifest assertions before each parity comparison.
- The comparator checked stable route kind, workflow, task family, commitment mode, policy/evidence/contract IDs, tool bundles, evidence records, capability-gap disclosure, structured-check failures, retry eligibility, and deterministic final-answer hard assertions.
- Warnings were limited to additive evidence/tool-call differences and nondeterministic tool ordering. No baseline planning field, capability gap, structured check, or final-answer assertion regressed.

## Current-Event Replacement Activation

Date: 2026-05-24

Command:

- `PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=market-closed-today-move PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts`

Reports:

- Dual-run gate before legacy prompt-clause removal: `tests/evals/runs/2026-05-25T01-33-09-953Z_prompt-policy-ref-parity.json`
- Replacement-active gate after omitting the legacy today-move clause for current-event turns: `tests/evals/runs/2026-05-25T01-39-20-513Z_prompt-policy-ref-parity.json`

Result:

- Passed 1/1 old-vs-current manifest parity case against baseline ref `3e3a039`.
- Both baseline and current implementations passed the manifest assertions for `market-closed-today-move`.
- Final replacement-active parity completed with zero warnings; stable route, task-family, policy/evidence/contract, evidence, capability-gap, structured-check, tool-call, and deterministic final-answer assertions matched the legacy baseline.

Validation note:

- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts` was run after this change and passed the current-event case, but the full 16-case manifest stopped at 15/16 because unrelated `unknown-ticker-earnings-risk` nondeterministically ended without the expected unresolved-ticker disclosure. The current-event manifest case passed in the full run and in an isolated strict rerun: `tests/evals/runs/2026-05-25T01-50-22-902Z_prompt-policy-manifest.json`.
- Follow-up stabilization hardened the ticker-disambiguation policy for supplied-but-unverified symbols. The full strict manifest then passed 16/16: `tests/evals/runs/2026-05-25T03-18-01-755Z_prompt-policy-manifest.json`.

## Concept Explainer Replacement Activation

Date: 2026-05-24

Commands:

- `PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=no-tool-valuation-education PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts`
- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=no-tool-valuation-education PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`

Reports:

- Dual-run gate with the legacy conceptual-education clause still present: `tests/evals/runs/2026-05-25T03-29-21-961Z_prompt-policy-ref-parity.json`
- Replacement-active gate after omitting the legacy conceptual-education clause for concept turns: `tests/evals/runs/2026-05-25T03-28-08-142Z_prompt-policy-ref-parity.json`
- Focused strict replacement-active manifest: `tests/evals/runs/2026-05-25T03-28-26-918Z_prompt-policy-manifest.json`

Result:

- Passed 1/1 old-vs-current manifest parity case against baseline ref `3e3a039` in both dual-run and replacement-active states.
- Both baseline and current implementations passed the manifest assertions for `no-tool-valuation-education`.
- The concept slice now owns educational no-tool answer shape through the `concept_explainer` policy card and answer contract while preserving no active finance tools and suppressing analyst commitment/confidence/invalidation boilerplate.

## Sentiment Snapshot Replacement Activation

Date: 2026-05-24

Commands:

- `PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=sentiment-source-coverage PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts`
- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=sentiment-source-coverage PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`

Reports:

- Baseline parity before sentiment runtime changes: `tests/evals/runs/2026-05-25T03-33-47-202Z_prompt-policy-ref-parity.json`
- Dual-run gate with the legacy sentiment-source clause still present: `tests/evals/runs/2026-05-25T03-37-02-346Z_prompt-policy-ref-parity.json`
- Replacement-active gate after omitting the legacy sentiment-source clause for sentiment turns: `tests/evals/runs/2026-05-25T03-37-58-312Z_prompt-policy-ref-parity.json`
- Focused strict replacement-active manifest: `tests/evals/runs/2026-05-25T03-38-21-284Z_prompt-policy-manifest.json`

Result:

- Passed 1/1 old-vs-current manifest parity case against baseline ref `3e3a039` before migration, in dual-run mode, and in replacement-active mode.
- Both baseline and current implementations passed the manifest assertions for `sentiment-source-coverage`.
- The replacement-active ref parity kept hard assertions green with one additive warning: the current implementation records `capability_gap_disclosure` for the declared `sentiment_sample_depth` gap.
- The sentiment slice now owns direction/strength, score-scale, missing-source, source-coverage-risk, low-sample, confidence-downgrade, and price-action-divergence obligations through the `sentiment_snapshot` policy card and answer contract.

## Filing Thesis Review Replacement Activation

Date: 2026-05-24

Commands:

- `PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=filing-thesis-review PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts`
- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=filing-thesis-review PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`

Reports:

- Baseline parity before filing runtime changes: `tests/evals/runs/2026-05-25T03-46-04-628Z_prompt-policy-ref-parity.json`
- Dual-run gate with the legacy SEC filing clause still present: `tests/evals/runs/2026-05-25T03-51-30-571Z_prompt-policy-ref-parity.json`
- Replacement-active gate after omitting the legacy SEC filing clause for filing turns: `tests/evals/runs/2026-05-25T03-52-34-659Z_prompt-policy-ref-parity.json`
- Focused strict replacement-active manifest: `tests/evals/runs/2026-05-25T03-53-14-780Z_prompt-policy-manifest.json`

Result:

- Passed 1/1 old-vs-current manifest parity case against baseline ref `3e3a039` after tightening the filing policy card to preserve the legacy SEC-first-then-targeted-search behavior.
- Both baseline and current implementations passed the manifest assertions for `filing-thesis-review`.
- The final replacement-active ref parity completed with zero warnings.
- The filing slice now owns source separation between filing metadata, filing-body gaps, news/management commentary, and market data through the `filing_thesis_review` policy card and answer contract.

## Retail Finance Tradeoff Replacement Activation

Date: 2026-05-24

Commands:

- `PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=brokerage-choice-taxable,safe-cash-products,mortgage-vs-investing PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts`
- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=brokerage-choice-taxable,safe-cash-products,mortgage-vs-investing PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`

Reports:

- Baseline parity before retail runtime changes: `tests/evals/runs/2026-05-25T03-57-27-982Z_prompt-policy-ref-parity.json`
- Dual-run gate with the legacy retail clause still present: `tests/evals/runs/2026-05-25T04-08-10-156Z_prompt-policy-ref-parity.json`
- Replacement-active gate after omitting the legacy retail clause for retail turns: `tests/evals/runs/2026-05-25T04-10-05-829Z_prompt-policy-ref-parity.json`
- Focused strict replacement-active manifest: `tests/evals/runs/2026-05-25T04-12-26-181Z_prompt-policy-manifest.json`

Result:

- Passed 3/3 old-vs-current manifest parity cases against baseline ref `3e3a039` in dual-run and replacement-active states.
- Both baseline and current implementations passed the manifest assertions for `brokerage-choice-taxable`, `safe-cash-products`, and `mortgage-vs-investing`.
- The replacement-active ref parity kept hard assertions green with expected additive warnings: `capability_gap_disclosure` is now recorded for declared brokerage, cash-yield, and fund-tax-efficiency gaps; the active mortgage-vs-investing run may fetch broad-market history when available.
- The retail slice now owns durable brokerage/account/product, cash-parking, and mortgage-vs-investing tradeoff obligations through the `retail_finance_tradeoff` policy card and `retail_tradeoff_framework` answer contract.

## Asset Compare Replacement Activation

Date: 2026-05-25

Commands:

- `PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=etf-overlap-check,dividend-growth-etf-tradeoff PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts`
- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=etf-overlap-check,dividend-growth-etf-tradeoff PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`

Reports:

- Baseline parity before asset-compare runtime changes: `tests/evals/runs/2026-05-25T04-24-59-878Z_prompt-policy-ref-parity.json`
- Dual-run gate with compare workflow guidance still authoritative: `tests/evals/runs/2026-05-25T04-29-39-130Z_prompt-policy-ref-parity.json`
- Replacement-active gate after asset policy activation: `tests/evals/runs/2026-05-25T04-31-54-174Z_prompt-policy-ref-parity.json`
- Focused strict replacement-active manifest: `tests/evals/runs/2026-05-25T04-33-08-342Z_prompt-policy-manifest.json`

Result:

- Passed 2/2 old-vs-current manifest parity cases against baseline ref `3e3a039` in dual-run and replacement-active states.
- Both baseline and current implementations passed the manifest assertions for `etf-overlap-check` and `dividend-growth-etf-tradeoff`.
- The replacement-active ref parity kept hard assertions green with expected additive warnings for structured checks and nondeterministic tool-call ordering.
- The asset slice now owns ETF overlap, diversification, dividend/income versus growth, tax/asset-location, horizon-fit, and exact-holdings-overlap capability-gap obligations through the `asset_compare` policy card and `asset_compare_tradeoff` answer contract.

## Single Asset Decision Replacement Activation

Date: 2026-05-25

Commands:

- `PROMPT_POLICY_MANIFEST=/Users/kahtaf/Documents/workspace_kahtaf/opencandle/docs/internal/prompt-to-policy-migration-manifest.json PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=single-asset-buy-wait-avoid PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts`
- `PROMPT_POLICY_MANIFEST=/Users/kahtaf/Documents/workspace_kahtaf/opencandle/docs/internal/prompt-to-policy-migration-manifest.json PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=single-asset-buy-wait-avoid PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`

Reports:

- Baseline parity before single-asset runtime changes: `tests/evals/runs/2026-05-25T04-36-52-942Z_prompt-policy-ref-parity.json`
- Dual-run gate with the legacy single-asset clause still present: `tests/evals/runs/2026-05-25T04-43-07-151Z_prompt-policy-ref-parity.json`
- Replacement-active gate after omitting the legacy single-asset clause for single-asset turns: `tests/evals/runs/2026-05-25T04-44-28-302Z_prompt-policy-ref-parity.json`
- Focused strict replacement-active manifest: `tests/evals/runs/2026-05-25T04-45-12-842Z_prompt-policy-manifest.json`

Result:

- Passed 1/1 old-vs-current manifest parity case against baseline ref `3e3a039` before migration, in dual-run mode, and in replacement-active mode.
- Both baseline and current implementations passed the manifest assertions for `single-asset-buy-wait-avoid`.
- The replacement-active ref parity kept hard assertions green with expected additive structured-check warnings for freshness and data-gap obligations plus nondeterministic tool-call ordering.
- The single-asset slice now owns clear buy/wait/avoid calls, quote/tool-output dates, market-closed or delayed quote caveats, fallback valuation lenses when DCF or fundamentals are unavailable, key risks, position sizing or entry strategy, confidence, and invalidation through the `single_asset_decision` policy card and answer contract.

## Macro Allocation Review Replacement Activation

Date: 2026-05-25

Commands:

- `PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=macro-portfolio-review,provider-degradation-disclosure PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts`
- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=macro-portfolio-review,provider-degradation-disclosure PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`

Reports:

- Baseline parity before macro runtime changes: `tests/evals/runs/2026-05-25T04-49-59-546Z_prompt-policy-ref-parity.json`
- Dual-run gate with legacy macro clauses still present: `tests/evals/runs/2026-05-25T04-59-03-459Z_prompt-policy-ref-parity.json`
- Replacement-active gate after omitting legacy macro clauses for macro allocation turns: `tests/evals/runs/2026-05-25T05-00-51-618Z_prompt-policy-ref-parity.json`
- Focused strict replacement-active manifest: `tests/evals/runs/2026-05-25T05-02-14-282Z_prompt-policy-manifest.json`

Result:

- Passed 2/2 old-vs-current manifest parity cases against baseline ref `3e3a039` before migration, in dual-run mode, and in replacement-active mode.
- Both baseline and current implementations passed the manifest assertions for `macro-portfolio-review` and `provider-degradation-disclosure`.
- The macro owner promotion from `portfolio_review` to `macro_allocation_review` is recorded as an explicit accepted observed change in the manifest; unlisted scalar planning drift remains a comparator failure.
- The replacement-active ref parity kept hard assertions green with expected additive structured-check warnings for data-gap, freshness, and source-coverage obligations plus nondeterministic tool-call ordering.
- The macro slice now owns current macro evidence conversion, provider-gap continuation, policy mechanism maps, direct regional-source fallback, structural portfolio reads, sleeve-by-sleeve implications, actionable adjustments, what the adjustment does not fix, and watchlist/invalidation through the `macro_allocation_review` policy card and answer contract.

## Options Strategy Replacement Activation

Date: 2026-05-25

Commands:

- `PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=covered-call-routing,protective-put-routing PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts`
- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=covered-call-routing,protective-put-routing PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`

Reports:

- Baseline parity before options runtime changes: `tests/evals/runs/2026-05-25T07-22-14-716Z_prompt-policy-ref-parity.json`
- Dual-run gate with options workflow guidance still authoritative: `tests/evals/runs/2026-05-25T07-31-14-975Z_prompt-policy-ref-parity.json`
- Replacement-active gate after options policy activation: `tests/evals/runs/2026-05-25T07-34-46-720Z_prompt-policy-ref-parity.json`
- Focused strict replacement-active manifest: `tests/evals/runs/2026-05-25T07-36-19-820Z_prompt-policy-manifest.json`

Result:

- Passed 2/2 old-vs-current manifest parity cases against baseline ref `3e3a039` before migration, in dual-run mode, and in replacement-active mode.
- Both baseline and current implementations passed the manifest assertions for `covered-call-routing` and `protective-put-routing`.
- The replacement-active ref parity kept hard assertions green with expected additive structured-check warnings for data-gap, freshness, and source-coverage obligations plus nondeterministic tool-call ordering.
- The options slice now owns owned-underlying context, catalyst ticker separation, cost basis/share/DTE context, option-chain underlying grounding, covered-call premium/assignment/capped-upside/downside framing, protective-put floor/cost/decay framing, stale quote and liquidity gaps, and source coverage through the `options_strategy` policy card and answer contract. Options workflow prompts remain authoritative for dispatch and step orchestration.

## Portfolio Review Replacement Activation

Date: 2026-05-25

Commands:

- `PROMPT_POLICY_MANIFEST=/Users/kahtaf/Documents/workspace_kahtaf/opencandle/docs/internal/prompt-to-policy-migration-manifest.json PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=existing-allocation-review PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts`
- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=existing-allocation-review PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`

Reports:

- Baseline parity after adding the fixed non-macro prompt: `tests/evals/runs/2026-05-25T07-45-45-654Z_prompt-policy-ref-parity.json`
- Dual-run gate with legacy fallback portfolio guidance still present: `tests/evals/runs/2026-05-25T07-49-40-789Z_prompt-policy-ref-parity.json`
- Replacement-active gate after portfolio policy activation: `tests/evals/runs/2026-05-25T07-50-45-376Z_prompt-policy-ref-parity.json`
- Focused strict replacement-active manifest: `tests/evals/runs/2026-05-25T07-51-20-640Z_prompt-policy-manifest.json`

Result:

- Passed 1/1 old-vs-current manifest parity case against baseline ref `3e3a039` before migration, in dual-run mode, and in replacement-active mode.
- Both baseline and current implementations passed the manifest assertions for `existing-allocation-review`.
- The initial reviewed prompt variants with ETF tickers and broad allocation language failed the gate by routing to single-asset/clarification paths; the accepted fixed manifest prompt is the narrow 60/40 existing-allocation class already covered by router correction tests.
- The replacement-active ref parity kept hard assertions green with expected additive structured-check warnings for data-gap and source-coverage obligations plus nondeterministic tool-call ordering.
- The portfolio slice now owns existing-allocation critique, no budget clarification, structural allocation read, sleeve implications, concentration/diversification/geography/duration/credit/liquidity/tax/horizon/rebalance critique, actionable adjustment, and watchlist/invalidation through the `portfolio_review` policy card and answer contract.

## Backtest Review Replacement Activation

Date: 2026-05-25

Commands:

- `PROMPT_POLICY_MANIFEST=/Users/kahtaf/Documents/workspace_kahtaf/opencandle/docs/internal/prompt-to-policy-migration-manifest.json PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=backtest-strategy-review PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts`
- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=backtest-strategy-review PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`

Reports:

- Baseline parity with old single-asset owner: `tests/evals/runs/2026-05-25T12-02-04-550Z_prompt-policy-ref-parity.json`
- Dual-run gate with legacy global backtest guidance still present: `tests/evals/runs/2026-05-25T12-08-59-724Z_prompt-policy-ref-parity.json`
- Replacement-active gate after backtest policy activation: `tests/evals/runs/2026-05-25T12-09-50-329Z_prompt-policy-ref-parity.json`
- Focused strict replacement-active manifest: `tests/evals/runs/2026-05-25T12-10-17-854Z_prompt-policy-manifest.json`

Result:

- Passed 1/1 old-vs-current manifest parity case against baseline ref `3e3a039` before migration, in dual-run mode, and in replacement-active mode.
- Both baseline and current implementations called `backtest_strategy` for `backtest-strategy-review`.
- The replacement-active ref parity kept hard assertions green with accepted planning-owner changes from `single_asset_decision` to `backtest_review`, plus expected additive structured-check warnings for data-gap and source-coverage obligations.
- The backtest slice now owns strategy return, buy-and-hold return, outperformance, trade count, win rate, max drawdown, Sharpe/Sortino availability, regime explanation, cost/slippage practicality, and main downside risk through the `backtest_review` policy card and answer contract.

## Stateful Tracking Update Replacement Activation

Date: 2026-05-25

Commands:

- `PROMPT_POLICY_MANIFEST=/Users/kahtaf/Documents/workspace_kahtaf/opencandle/docs/internal/prompt-to-policy-migration-manifest.json PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=stateful-prediction-record PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts`
- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=stateful-prediction-record PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`

Reports:

- Baseline parity with old generic fallback owner: `tests/evals/runs/2026-05-25T12-18-42-895Z_prompt-policy-ref-parity.json`
- Dual-run gate with state tools unchanged: `tests/evals/runs/2026-05-25T12-24-26-265Z_prompt-policy-ref-parity.json`
- Replacement-active gate after stateful policy activation: `tests/evals/runs/2026-05-25T12-25-28-068Z_prompt-policy-ref-parity.json`
- Focused strict replacement-active manifest: `tests/evals/runs/2026-05-25T12-26-55-449Z_prompt-policy-manifest.json`

Result:

- Passed 1/1 old-vs-current manifest parity case against baseline ref `3e3a039` before migration, in dual-run mode, and in replacement-active mode.
- Both baseline and current implementations called `track_prediction` for `stateful-prediction-record`.
- The replacement-active ref parity kept hard assertions green with accepted planning-owner changes from `general_fallback` to `stateful_tracking_update`; nondeterministic state-tool retries remained warning-only.
- The stateful slice now owns watchlist, prediction, and portfolio tracking state-confirmation obligations through the `stateful_tracking_update` policy card and answer contract while preserving `watchlist_or_tracking` route/tool behavior.
