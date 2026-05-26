## 1. Spec Review

- [x] 1.1 Validate the OpenSpec change strictly.
- [x] 1.2 Review the spec against the parity goal and remove prompt-bloat or ticker-specific assumptions.

## 2. TDD Implementation

- [x] 2.1 Add a failing unit test for portfolio exposure-map evidence normalization.
- [x] 2.2 Add a failing unit test for harness telemetry on portfolio rebalance prompts.
- [x] 2.3 Implement deterministic exposure-map evidence.
- [x] 2.4 Attach exposure-map evidence to portfolio rebalance planning traces.
- [x] 2.5 Preserve exact-holdings overlap as a capability gap.

## 3. Validation

- [x] 3.1 Run focused planning evidence and harness unit tests.
- [x] 3.2 Run a smoke prompt-policy manifest case for portfolio rebalance when feasible.
- [x] 3.3 Run `npm run build`.
- [x] 3.4 Run `npm test`.
- [x] 3.5 Run `graphify update .`.
