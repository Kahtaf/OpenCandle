## 1. Harness Trace Enhancement

- [x] 1.1 Extend harness to capture tool args and results from `tool_execution_start`/`tool_execution_end` events (Pi agent core already emits these)
- [x] 1.2 Extend harness to capture `ClassificationResult` from the router into the trace
- [x] 1.3 Extend harness to record `askUserTranscript` as ordered `{ question, answer }[]` pairs
- [x] 1.4 Update harness `ask_user` handler to accept ordered `string[]` answers (consume in sequence)

## 2. Setup

- [x] 2.1 Install `vitest-evals` dependency
- [x] 2.2 Create `tests/evals/` directory structure with `cases/`, `scorers/`, and config
- [x] 2.3 Define `EvalCase` and `EvalReport` TypeScript interfaces in `tests/evals/types.ts` — `EvalCase.answers` is `string[]` (ordered), Layer 1 uses `expectedWorkflow: WorkflowType`

## 3. Deterministic Scorers (Layers 1–5)

- [x] 3.1 Implement workflow classification scorer — exact match against `expectedWorkflow` using `WorkflowType` values from `src/routing/types.ts`
- [x] 3.2 Implement tool selection scorer — set comparison for `requiredTools`/`forbiddenTools`
- [x] 3.3 Implement tool argument scorer — key-value match for `requiredArgs` against trace `toolCalls[].args`
- [x] 3.4 Implement data faithfulness scorer — extract financial numbers (prices, ratios, returns, market cap) from response, verify against trace `toolCalls[].result` union, exclude non-financial numbers (dates, ordinals, counts), allow 1% relative tolerance for derived values
- [x] 3.5 Implement risk disclosure scorer — regex for disclaimers, keyword check for prohibited terms
- [x] 3.6 Add unit tests for each deterministic scorer with fixture data

## 4. Eval Runner Integration

- [x] 4.1 Create eval runner that invokes test harness per eval case and collects rich traces
- [x] 4.2 Wire `describeEval` from vitest-evals to run always-tier cases
- [x] 4.3 Add eval cases to `npm test` pipeline for always-tier
- [x] 4.4 Add separate script for usually-tier runs (skipped in CI)

## 5. Starter Eval Cases (Always-tier)

- [x] 5.1 Add routing eval cases using `WorkflowType` values — stock quote, technicals, backtest, SEC filings, correlation, options, fear & greed, macro, sentiment, DCF (10 cases)
- [x] 5.2 Add data faithfulness eval cases — quote accuracy, ratio accuracy, backtest metrics (3 cases)
- [x] 5.3 Add risk disclosure eval cases — bullish recommendation, high-conviction signal, no guaranteed language (3 cases)

## 6. Multi-turn Eval Cases (Harness-dependent)

- [x] 6.1 Add portfolio builder eval cases with ordered `answers: string[]` for ask_user (conservative + aggressive)
- [x] 6.2 Add options screener and compare assets eval cases
- [x] 6.3 Add comprehensive analysis eval case

## 7. Baseline Management

- [x] 7.1 Implement baseline read/write — load from `tests/evals/baseline.json`, compare against current scores
- [x] 7.2 Implement regression detection — aggregate delta < -0.05 flags regression, PLUS per-case safety-critical blocking when any always-tier Layer 4 or Layer 5 score drops to 0
- [x] 7.3 Implement `--update-baseline` CLI command to overwrite baseline with current scores
- [x] 7.4 Generate initial baseline from first eval run

## 8. LLM-judge Scorers (Layers 6–7)

- [x] 8.1 Implement analysis quality scorer — atomized rubric with 5 binary pass/fail items, normalized to 0–1 fraction, temperature 0.1, 3x averaging
- [x] 8.2 Implement E2E workflow scorer — trajectory matching + LLM quality assessment
- [x] 8.3 Add usually-tier eval cases for analysis quality (3 cases) and E2E workflows
- [x] 8.4 Add few-shot examples (2–3 per rubric item) for LLM judge consistency
