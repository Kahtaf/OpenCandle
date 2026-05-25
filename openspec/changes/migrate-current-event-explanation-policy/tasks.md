## 1. Baseline and Gate

- [x] 1.1 Record the current-event baseline parity run for `market-closed-today-move` against the selected baseline ref.
- [x] 1.2 Update the parity ledger row `market-closed-today-move` with baseline report path, migration state, and rollback knob.

## 2. Policy Migration

- [x] 2.1 Add failing unit tests for current-event policy-card selection, observe-only non-injection, dual-run injection, and unrelated task-family isolation.
- [x] 2.2 Add failing unit tests for current-event evidence obligations: `market_status` remains the evidence plan ID, quote/news/event evidence is represented by existing `tool_result` records, and market-calendar/provider gaps are preserved.
- [x] 2.3 Add failing unit tests for current-event answer-contract obligations: freshness disclosure, source coverage, data-gap disclosure, market-calendar capability-gap disclosure, and observe-only structured-check failures.
- [x] 2.4 Implement the `current_event_explanation` policy card without changing unrelated task-family prompts.
- [x] 2.5 Implement the smallest task-family-scoped activation control needed for observe-only, dual-run, and replacement-active current-event behavior.
- [x] 2.6 Implement the current-event answer contract and structured-check expectations.
- [x] 2.7 Run the slice in dual-run mode while legacy prompt guidance remains authoritative.

## 3. Replacement Activation

- [x] 3.1 Run the current-event parity gate in dual-run mode and confirm no hard regressions.
- [x] 3.2 Remove only the fallback playbook clause beginning `For "today" or "why did it move today" prompts:` after the parity gate passes.
- [x] 3.3 Run the current-event parity gate again after removal and confirm no hard regressions.
- [x] 3.4 Mark the parity ledger row replacement-active or legacy-removed with rollback instructions.

## 4. Validation

- [x] 4.1 Run `npm test`.
- [x] 4.2 Run `PROMPT_POLICY_STRICT=1 npx tsx tests/scripts/run-prompt-policy-manifest.ts`.
  - Current-event strict manifest passed with `PROMPT_POLICY_IDS=market-closed-today-move`.
  - Full strict manifest passed 16/16 after `stabilize-prompt-policy-manifest`: `tests/evals/runs/2026-05-25T03-18-01-755Z_prompt-policy-manifest.json`.
- [x] 4.3 Run `graphify update .`.
- [x] 4.4 Update `CHANGELOG.md` and internal migration evidence docs.
