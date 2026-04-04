## Context

OpenCandle is a financial agent that calls tools (Yahoo Finance, AlphaVantage, FRED, etc.) and synthesizes analysis. The test harness (PR #8) supports scripted multi-turn runs with IPC-based `ask_user` injection, producing structured traces (`trace.json`). There is currently no mechanism to detect quality regressions — broken routing, wrong tool calls, or hallucinated numbers can ship unnoticed.

The eval framework plan (`docs/eval-framework-plan.md`) captures detailed research on peer projects, frameworks, and scoring approaches. This design translates that plan into an implementable architecture.

## Goals / Non-Goals

**Goals:**
- Deterministic eval layers (1–5) that run in CI on every push, catching routing, tool selection, argument, faithfulness, and disclosure regressions
- LLM-judge eval layers (6–7) that run nightly/on-demand for analysis quality assessment
- Baseline-based regression detection with per-case scoring and delta reporting
- Integration with the existing test harness for multi-turn eval scenarios

**Non-Goals:**
- Production traffic evaluation (Braintrust-style) — out of scope for now
- Custom eval web UI — use Vitest reporter output
- Continuous baseline auto-update — baselines are updated manually and intentionally
- Replacing existing unit/e2e tests — evals complement, not replace

## Decisions

### 1. vitest-evals as the eval runner

**Choice**: Use `vitest-evals` (Sentry's Vitest extension) for all eval layers.

**Why**: OpenCandle already uses Vitest. `vitest-evals` adds `describeEval` and scorer primitives without new infrastructure. Eval cases are just Vitest tests with scoring semantics.

**Alternatives considered**:
- Promptfoo standalone: Better LLM-judge tooling, but requires YAML config and a separate runner. Will use for Layer 6–7 rubrics only, invoked from within vitest-evals.
- Evalite: Built on Vitest but v1 beta — too early.
- Custom from scratch: Unnecessary given vitest-evals exists.

### 2. Seven-layer scoring model

**Choice**: Layers 1–5 are deterministic code-based graders. Layers 6–7 use LLM-as-judge.

**Why**: Deterministic graders are reproducible and fast — they catch the most critical failures (wrong tools, hallucinated numbers). LLM judges handle subjective quality where code graders can't reach.

**Layer breakdown**:
| Layer | What | Grader type | Tier |
|-------|------|-------------|------|
| 1 | WorkflowType classification | Exact match | always |
| 2 | Tool selection | Set comparison | always |
| 3 | Tool arguments | Key-value match | always |
| 4 | Data faithfulness | Numeric grounding | always |
| 5 | Risk disclosure | Regex + keyword | always |
| 6 | Analysis quality | LLM rubric | usually |
| 7 | E2E workflow | LLM + trajectory | usually |

### 3. Two-tier eval model (always / usually)

**Choice**: Adopt Gemini CLI's tiering — `always` evals run in CI, `usually` evals run nightly with 3x averaging.

**Why**: LLM output is non-deterministic. Running LLM-judge evals in CI would produce flaky failures. The two-tier model acknowledges this: deterministic checks gate every PR, while quality evals track trends.

**Alternatives considered**:
- All evals in CI with retry: Too slow, still flaky.
- Only deterministic evals: Misses quality regressions in synthesis.

### 4. Test harness as the eval executor (with enriched trace)

**Choice**: Evals invoke the test harness (`tests/harness/manual-run.ts`) to run agent prompts and collect traces, then score the traces.

**Why**: The harness already handles tool execution, `ask_user` IPC, and structured trace output. Evals shouldn't re-implement agent execution.

**Prerequisite**: The harness currently writes `{ prompt, toolCalls: string[], text }`. It must be extended to emit a richer trace: `{ prompt, classification, toolCalls: { name, args, result }[], askUserTranscript: { question, answer }[], text }`. The Pi agent core already emits `tool_execution_start` (with `args`) and `tool_execution_end` (with `result`) events — the harness just needs to capture them. Classification must be intercepted from the router.

**Flow**: `eval case → harness run → rich trace.json → scorers → eval report`

### 5. Baseline stored in git

**Choice**: `tests/evals/baseline.json` checked into the repo. Updated explicitly via `npx oc-eval --update-baseline`.

**Why**: Simple, version-controlled, no external service. Baselines change intentionally, not automatically — you must opt in to a new baseline after reviewing the delta.

## Risks / Trade-offs

**[Harness execution speed]** → Each eval case runs a full agent loop. Mitigate by keeping `always`-tier cases focused (single-turn where possible) and parallelizing harness runs.

**[LLM-judge non-determinism]** → Even at temperature 0.1, LLM scores vary. Mitigate by 3x averaging, binary pass/fail per rubric item (normalized to 0–1 fraction), and tracking rolling pass rates rather than exact scores.

**[Data faithfulness false positives]** → Not all numbers in a response are financial claims. Mitigate by scoping the faithfulness scorer to financial numeric contexts (prices, ratios, percentages, returns) and excluding non-financial numbers (dates, ordinals, counts, time periods). Allow 1% relative tolerance for derived calculations.

**[vitest-evals maturity]** → Relatively new library. Mitigate by keeping a thin integration layer so we can swap if needed.

**[Baseline drift]** → If baselines aren't updated regularly, deltas accumulate and become meaningless. Mitigate by making baseline updates part of the PR workflow for changes that intentionally affect eval scores.
