## 1. Spec Review

- [x] 1.1 Validate the OpenSpec change strictly.
- [x] 1.2 Review the spec for premature UI/storage scope and remove anything that implies rendered artifacts.

## 2. TDD Implementation

- [x] 2.1 Add a failing registry test for supported artifact contract IDs and trace-only status.
- [x] 2.2 Add a failing planning test for concept education artifact contracts.
- [x] 2.3 Add a failing planning test for portfolio rebalance artifact contracts.
- [x] 2.4 Add a failing report/trace test proving artifact contract IDs are exposed.
- [x] 2.5 Implement the artifact contract registry and planning metadata wiring.

## 3. Validation

- [x] 3.1 Run focused artifact contract tests.
- [x] 3.2 Run focused prompt-policy/product eval smoke for artifact metadata.
- [x] 3.3 Run `npm run build`.
- [x] 3.4 Run `npm test`.
- [x] 3.5 Run `graphify update .`.
