## Why

OpenCandle has no way to detect quality regressions when features change. A financial agent that hallucinates numbers or picks wrong tools is dangerous — we need automated eval coverage. The test harness (PR #8) now supports scripted multi-turn runs, making deterministic evals feasible.

## What Changes

- Add deterministic eval layers (intent classification, tool selection, tool arguments, data faithfulness, risk disclosure) that run on every CI push
- Add LLM-judge eval layers (analysis quality, E2E workflows) that run nightly/on-demand
- Introduce baseline management so regressions are flagged automatically against a checked-in baseline
- Adopt Gemini CLI's two-tier model: `always` (deterministic, every CI) vs `usually` (LLM-dependent, nightly)

## Capabilities

### New Capabilities
- `deterministic-evals`: Layers 1–5 — intent classification, tool selection correctness, tool argument correctness, data faithfulness (numeric grounding), and risk disclosure checks. Code-based graders, no LLM needed, runs every CI.
- `llm-judge-evals`: Layers 6–7 — analysis quality rubric scoring and E2E workflow assessment using LLM-as-judge. Runs nightly/on-demand with 3x averaging.
- `eval-baseline`: Baseline storage, comparison, regression detection, and update workflow. Per-case scores in git-tracked `baseline.json`.

### Modified Capabilities

_None — this is a new subsystem with no changes to existing specs._

## Impact

- **New dependencies**: `vitest-evals` (Vitest extension), optionally `promptfoo` for LLM-judge layer
- **Test infrastructure**: New `tests/evals/` directory with eval cases, scorers, and baseline
- **CI**: `always`-tier evals added to test pipeline; `usually`-tier runs separately (nightly or manual)
- **Test harness**: Evals consume traces from the existing test harness (PR #8) for multi-turn scenarios
