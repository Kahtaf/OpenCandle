## 1. Baseline and Review

- [x] 1.1 Run focused ref parity for `covered-call-routing,protective-put-routing` against `3e3a039`.
- [x] 1.2 Review this spec against the `options-existing-position` parity ledger row and update gaps before implementation.
- [x] 1.3 Update the parity ledger row with baseline path, migration state, and rollback knob.

## 2. Policy Migration

- [x] 2.1 Add failing unit tests for options policy-card selection, observe-only non-injection, dual-run injection, and unrelated task-family isolation.
- [x] 2.2 Add failing unit tests for options answer-contract obligations: clear strategy framing, risk/downside, freshness, data-gap disclosure, and source coverage.
- [x] 2.3 Add failing prompt-assembly tests proving options policy injection keeps workflow dispatch context and does not remove workflow prompt ownership.
- [x] 2.4 Implement the `options_strategy` policy card without changing unrelated task-family prompts.
- [x] 2.5 Activate the `options_strategy` answer contract.
- [x] 2.6 Run the slice in dual-run mode while workflow prompt guidance remains present.

## 3. Replacement Activation

- [x] 3.1 Run focused ref parity in dual-run mode and confirm no hard regressions.
- [x] 3.2 Switch `options_strategy` to replacement-active without removing options workflow prompt guidance.
- [x] 3.3 Run focused ref parity again and confirm no hard regressions.
- [x] 3.4 Mark the parity ledger row replacement-active with rollback instructions.

## 4. Validation

- [x] 4.1 Run focused unit tests.
- [x] 4.2 Run `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=covered-call-routing,protective-put-routing PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`.
- [x] 4.3 Run `npm run build`.
- [x] 4.4 Run `npm test`.
- [x] 4.5 Run `graphify update .`.
- [x] 4.6 Update `CHANGELOG.md` and internal migration evidence docs.
