## 1. Baseline and Review

- [x] 1.1 Add a fixed non-macro portfolio-review manifest prompt.
- [x] 1.2 Validate and review this spec against the `portfolio-evaluation-not-construction` parity ledger row before implementation.
- [x] 1.3 Run focused ref parity for the new portfolio-review prompt against `3e3a039`.
- [ ] 1.4 Update the parity ledger row with baseline path, migration state, and rollback knob.

## 2. Policy Migration

- [ ] 2.1 Add failing unit tests for portfolio-review policy-card selection, observe-only non-injection, dual-run injection, and unrelated portfolio-build isolation.
- [ ] 2.2 Add failing unit tests for portfolio-review answer-contract obligations: clear allocation read, risk/downside, data-gap disclosure, source coverage, and no construction requirement.
- [ ] 2.3 Add failing prompt-assembly tests proving portfolio-review policy injection keeps agent-task context and does not remove unrelated workflow dispatch behavior.
- [ ] 2.4 Implement the `portfolio_review` policy card without changing portfolio-builder or macro-allocation prompts.
- [ ] 2.5 Activate the `portfolio_review` answer contract.
- [ ] 2.6 Run the slice in dual-run mode while legacy fallback portfolio guidance remains present.

## 3. Activation

- [ ] 3.1 Run focused ref parity in dual-run mode and confirm no hard regressions.
- [ ] 3.2 Switch `portfolio_review` to replacement-active without changing portfolio-builder workflow dispatch.
- [ ] 3.3 Run focused ref parity again and confirm no hard regressions.
- [ ] 3.4 Mark the parity ledger row replacement-active with rollback instructions.

## 4. Validation

- [ ] 4.1 Run focused unit tests.
- [ ] 4.2 Run `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=existing-allocation-review PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`.
- [ ] 4.3 Run `npm run build`.
- [ ] 4.4 Run `npm test`.
- [ ] 4.5 Run `graphify update .`.
- [ ] 4.6 Update `CHANGELOG.md` and internal migration evidence docs.
