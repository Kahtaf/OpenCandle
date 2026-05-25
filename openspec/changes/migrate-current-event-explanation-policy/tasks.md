## 1. Baseline and Gate

- [x] 1.1 Record the current-event baseline parity run for `market-closed-today-move` against the selected baseline ref.
- [x] 1.2 Update the parity ledger row `market-closed-today-move` with baseline report path, migration state, and rollback knob.

## 2. Policy Migration

- [ ] 2.1 Implement the `current_event_explanation` policy card without changing unrelated task-family prompts.
- [ ] 2.2 Implement the current-event evidence plan using market-status evidence plus quote/news/event evidence already available through current tools.
- [ ] 2.3 Implement the current-event answer contract and structured-check expectations.
- [ ] 2.4 Run the slice in dual-run mode while legacy prompt guidance remains authoritative.

## 3. Replacement Activation

- [ ] 3.1 Run the current-event parity gate and confirm no hard regressions.
- [ ] 3.2 Remove only the matching legacy fallback prompt clause after the parity gate passes.
- [ ] 3.3 Mark the parity ledger row replacement-active or legacy-removed with rollback instructions.

## 4. Validation

- [ ] 4.1 Add or update unit tests for policy-card selection, evidence-plan obligations, answer-contract obligations, and structured checks.
- [ ] 4.2 Run `npm test`.
- [ ] 4.3 Run the full prompt-to-policy manifest.
- [ ] 4.4 Run `graphify update .`.
- [ ] 4.5 Update `CHANGELOG.md` and internal migration evidence docs.
