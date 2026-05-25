## 1. Baseline and Gate

- [x] 1.1 Run focused ref parity for `filing-thesis-review` against `3e3a039`.
- [x] 1.2 Update the parity ledger row `filing-thesis-review` with baseline path, migration state, and rollback knob.

## 2. Policy Migration

- [x] 2.1 Add failing unit tests for filing policy-card selection, observe-only non-injection, dual-run injection, and unrelated task-family isolation.
- [x] 2.2 Add failing unit tests for filing answer-contract obligations: source coverage, data-gap disclosure, no concrete commitment.
- [x] 2.3 Add failing prompt-assembly tests for dual-run and replacement-active filing prompts.
- [x] 2.4 Implement the `filing_thesis_review` policy card without changing unrelated task-family prompts.
- [x] 2.5 Activate the `filing_thesis_review` answer contract.
- [x] 2.6 Run the slice in dual-run mode while legacy fallback guidance remains present.

## 3. Replacement Activation

- [x] 3.1 Run focused ref parity in dual-run mode and confirm no hard regressions.
- [x] 3.2 Remove only the fallback playbook SEC filing clause for replacement-active filing turns.
- [x] 3.3 Run focused ref parity again after removal and confirm no hard regressions.
- [x] 3.4 Mark the parity ledger row replacement-active or legacy-removed with rollback instructions.

## 4. Validation

- [x] 4.1 Run focused unit tests.
- [x] 4.2 Run `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=filing-thesis-review PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`.
- [x] 4.3 Run `npm test`.
- [x] 4.4 Run `graphify update .`.
- [x] 4.5 Update `CHANGELOG.md` and internal migration evidence docs.
