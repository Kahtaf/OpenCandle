## 1. Spec Review

- [x] 1.1 Validate the OpenSpec change strictly.
- [x] 1.2 Review the spec against the parity goal and remove prompt-bloat or ticker-specific assumptions.

## 2. TDD Implementation

- [ ] 2.1 Add a failing unit test for a passing superiority scorecard.
- [ ] 2.2 Add a failing unit test for scorecard blockers.
- [ ] 2.3 Implement reusable scorecard classification helpers.
- [ ] 2.4 Add a scorecard CLI script.
- [ ] 2.5 Ensure generated scorecards are written under `tests/evals/runs/`.

## 3. Validation

- [ ] 3.1 Run focused scorecard unit tests.
- [ ] 3.2 Build a smoke scorecard from existing replay/manifest reports when available.
- [ ] 3.3 Run `npm run build`.
- [ ] 3.4 Run `npm test`.
- [ ] 3.5 Run `graphify update .`.
