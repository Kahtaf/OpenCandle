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

This first section is a targeted before-migration smoke baseline. The full before/after manifest comparison is recorded below.

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
- `npm run test:evals` currently fails before running eval cases with `TypeError: define is not a function` from `vitest-evals/src/index.ts`. This is outside the prompt-to-policy unit harness added here and blocks a full eval-suite manifest run in this session.

## Full Manifest Comparison

Date: 2026-05-24

Command:

- `npx tsx tests/scripts/run-prompt-policy-manifest.ts`

Report:

- `tests/evals/runs/2026-05-24T20-31-43-658Z_prompt-policy-manifest.json`

Result:

- Passed 16/16 committed manifest prompts.
- Compared route kind, workflow, task family, commitment mode, tool bundles, tool calls, evidence records, capability-gap disclosure, structured-check failures, retry eligibility, and deterministic final-answer hard assertions.

Notes:

- The dedicated manifest runner is committed as `tests/scripts/run-prompt-policy-manifest.ts` because `npm run test:evals` is still blocked by the `vitest-evals` `define is not a function` loader failure above.
- Generated run reports under `tests/evals/runs/` are gitignored; the path above is recorded as local validation evidence.
