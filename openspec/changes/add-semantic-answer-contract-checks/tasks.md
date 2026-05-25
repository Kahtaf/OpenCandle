## 1. Spec Review

- [x] 1.1 Validate the OpenSpec change strictly.
- [x] 1.2 Review the spec against the parity goal and remove prompt-bloat or ticker-specific assumptions.

## 2. TDD Implementation

- [ ] 2.1 Add a failing unit test for semantic structured checks against answer text.
- [ ] 2.2 Add a failing unit test for planning selections including semantic check IDs.
- [ ] 2.3 Implement semantic check IDs and answer-text checks.
- [ ] 2.4 Attach semantic checks to relevant policy-card refinements.
- [ ] 2.5 Ensure harness telemetry records semantic check results/failures.

## 3. Validation

- [ ] 3.1 Run focused answer-contract and planning unit tests.
- [ ] 3.2 Run a smoke prompt-policy manifest case that includes semantic checks when feasible.
- [ ] 3.3 Run `npm run build`.
- [ ] 3.4 Run `npm test`.
- [ ] 3.5 Run `graphify update .`.
