## 1. Spec Review

- [x] 1.1 Validate the OpenSpec change strictly.
- [x] 1.2 Review the spec against the parity goal and remove prompt-bloat or ticker-specific assumptions.

## 2. TDD Implementation

- [x] 2.1 Add a failing unit test for current-vs-base competitive report comparison.
- [x] 2.2 Add a failing unit test for unsupported competitive replay reporting.
- [x] 2.3 Implement reusable competitive replay comparison helpers.
- [x] 2.4 Add a competitive replay comparison CLI script.
- [x] 2.5 Ensure generated reports are written under `tests/evals/runs/`.

## 3. Validation

- [x] 3.1 Run focused competitive replay unit tests.
- [x] 3.2 Run a smoke comparison using existing fixed-prompt competitive reports when available.
- [x] 3.3 Run `npm run build`.
- [x] 3.4 Run `npm test`.
- [x] 3.5 Run `graphify update .`.
