## 1. Baseline and Review

- [x] 1.1 Add a fixed stateful tracking manifest prompt.
- [x] 1.2 Validate and review this spec before implementation.
- [x] 1.3 Run focused baseline ref parity for the stateful prompt against `3e3a039`.
- [x] 1.4 Update the parity ledger row with baseline path, migration state, and rollback knob.

## 2. Policy Migration

- [x] 2.1 Add failing unit tests for stateful policy-card selection, observe-only non-injection, dual-run injection, and unrelated task-family isolation.
- [x] 2.2 Add failing unit tests for stateful answer-contract obligations: state update confirmation, data-gap disclosure, and no market decision requirement.
- [x] 2.3 Add failing planning tests proving watchlist/prediction prompts select `stateful_tracking_update`.
- [x] 2.4 Add failing prompt-assembly tests proving stateful policy injection keeps agent-task context.
- [x] 2.5 Implement the `stateful_tracking_update` policy card without changing unrelated task-family prompts.
- [x] 2.6 Activate the `stateful_tracking_update` answer contract and planning manifest ownership.
- [x] 2.7 Run the slice in dual-run mode while existing tool behavior remains present.

## 3. Activation

- [x] 3.1 Run focused ref parity in dual-run mode and confirm no hard regressions.
- [x] 3.2 Switch `stateful_tracking_update` to replacement-active without changing persistence behavior.
- [x] 3.3 Run focused ref parity again and confirm no hard regressions.
- [x] 3.4 Mark the parity ledger row replacement-active with rollback instructions.

## 4. Validation

- [x] 4.1 Run focused unit tests.
- [x] 4.2 Run `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=stateful-prediction-record PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`.
- [x] 4.3 Run `npm run build`.
- [x] 4.4 Run `npm test`.
- [x] 4.5 Run `graphify update .`.
- [x] 4.6 Update `CHANGELOG.md` and internal migration evidence docs.
