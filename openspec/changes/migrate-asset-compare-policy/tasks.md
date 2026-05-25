## 1. Baseline and Gate

- [ ] 1.1 Run focused ref parity for `etf-overlap-check,dividend-growth-etf-tradeoff` against `3e3a039`.
- [ ] 1.2 Update the parity ledger row `dividend-growth-etf-tradeoff` with baseline path, migration state, and rollback knob.

## 2. Policy Migration

- [ ] 2.1 Add failing unit tests for asset-compare policy-card selection, observe-only non-injection, dual-run injection, and unrelated task-family isolation.
- [ ] 2.2 Add failing unit tests for asset-compare answer-contract obligations: comparison tradeoffs, data-gap disclosure, source coverage, no construction commitment.
- [ ] 2.3 Add failing prompt-assembly tests for dual-run and replacement-active asset-compare prompts.
- [ ] 2.4 Implement the `asset_compare` policy card without changing unrelated task-family prompts.
- [ ] 2.5 Activate the `asset_compare_tradeoff` answer contract.
- [ ] 2.6 Run the slice in dual-run mode while existing compare workflow guidance remains present.

## 3. Replacement Activation

- [ ] 3.1 Run focused ref parity in dual-run mode and confirm no hard regressions.
- [ ] 3.2 Mark `asset_compare` replacement-active without deleting compare workflow instructions.
- [ ] 3.3 Run focused ref parity again after activation and confirm no hard regressions.
- [ ] 3.4 Mark the parity ledger row replacement-active with rollback instructions.

## 4. Validation

- [ ] 4.1 Run focused unit tests.
- [ ] 4.2 Run `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=etf-overlap-check,dividend-growth-etf-tradeoff PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`.
- [ ] 4.3 Run `npm test`.
- [ ] 4.4 Run `graphify update .`.
- [ ] 4.5 Update `CHANGELOG.md` and internal migration evidence docs.
