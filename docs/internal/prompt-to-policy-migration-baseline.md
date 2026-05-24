# Prompt-To-Policy Migration Baseline

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

This is a targeted before-migration smoke baseline, not the full before/after migration comparison. Full manifest rerun and parity comparison remain gated by tasks 8.2 and 8.8.
