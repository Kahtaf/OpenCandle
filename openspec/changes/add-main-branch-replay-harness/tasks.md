## 1. Spec Review

- [x] 1.1 Validate the OpenSpec change strictly.
- [x] 1.2 Review the spec against the parity goal and remove any prompt-bloat or ticker-specific assumptions.

## 2. TDD Implementation

- [x] 2.1 Add a failing unit test for product comparison summarization from two report summaries.
- [x] 2.2 Add a failing unit test for unsupported base-ref reporting.
- [x] 2.3 Implement reusable comparison helpers.
- [x] 2.4 Add the product replay CLI script.
- [x] 2.5 Ensure generated comparison reports are written under `tests/evals/runs/`.

## 3. Validation

- [x] 3.1 Run focused replay harness unit tests.
- [x] 3.2 Run a smoke product comparison against `origin/main` or document a blocking unsupported reason.
- [x] 3.3 Run `npm run build`.
- [x] 3.4 Run `npm test`.
- [x] 3.5 Run `graphify update .`.
