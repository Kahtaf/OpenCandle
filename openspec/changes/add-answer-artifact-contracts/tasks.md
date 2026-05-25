## 1. Spec Review

- [x] 1.1 Validate the OpenSpec change strictly.
- [x] 1.2 Review the spec for premature UI/storage scope and remove anything that implies rendered artifacts.

## 2. TDD Implementation

- [ ] 2.1 Add a failing registry test for supported artifact contract IDs and trace-only status.
- [ ] 2.2 Add a failing planning test for concept education artifact contracts.
- [ ] 2.3 Add a failing planning test for portfolio rebalance artifact contracts.
- [ ] 2.4 Add a failing report/trace test proving artifact contract IDs are exposed.
- [ ] 2.5 Implement the artifact contract registry and planning metadata wiring.

## 3. Validation

- [ ] 3.1 Run focused artifact contract tests.
- [ ] 3.2 Run focused prompt-policy/product eval smoke for artifact metadata.
- [ ] 3.3 Run `npm run build`.
- [ ] 3.4 Run `npm test`.
- [ ] 3.5 Run `graphify update .`.
