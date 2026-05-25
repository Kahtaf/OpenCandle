## 1. Baseline and Review

- [x] 1.1 Add a fixed backtest manifest prompt with baseline expectations.
- [x] 1.2 Validate and review this spec before implementation.
- [x] 1.3 Run focused baseline ref parity for the backtest prompt against `3e3a039`.
- [ ] 1.4 Update the manifest expectation for replacement ownership and record accepted owner promotion.
- [ ] 1.5 Update the parity ledger row with baseline path, migration state, and rollback knob.

## 2. Policy Migration

- [ ] 2.1 Add failing unit tests for backtest policy-card selection, observe-only non-injection, dual-run injection, and unrelated task-family isolation.
- [ ] 2.2 Add failing unit tests for backtest answer-contract obligations: metric coverage, risk/downside, data-gap disclosure, source coverage, and no constructed-output requirement.
- [ ] 2.3 Add failing planning tests proving backtest prompts select `backtest_review`.
- [ ] 2.4 Add failing prompt-assembly tests proving backtest policy injection keeps agent-task context.
- [ ] 2.5 Implement the `backtest_review` policy card without changing unrelated task-family prompts.
- [ ] 2.6 Activate the `backtest_review` answer contract and planning manifest selection.
- [ ] 2.7 Run the slice in dual-run mode while legacy global backtest guidance remains present.

## 3. Activation

- [ ] 3.1 Run focused ref parity in dual-run mode and confirm no hard regressions.
- [ ] 3.2 Switch `backtest_review` to replacement-active without changing tool behavior.
- [ ] 3.3 Run focused ref parity again and confirm no hard regressions.
- [ ] 3.4 Mark the parity ledger row replacement-active with rollback instructions.

## 4. Validation

- [ ] 4.1 Run focused unit tests.
- [ ] 4.2 Run `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=backtest-strategy-review PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`.
- [ ] 4.3 Run `npm run build`.
- [ ] 4.4 Run `npm test`.
- [ ] 4.5 Run `graphify update .`.
- [ ] 4.6 Update `CHANGELOG.md` and internal migration evidence docs.
