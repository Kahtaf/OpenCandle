## 1. Spec Review

- [x] 1.1 Validate the OpenSpec change strictly.
- [x] 1.2 Review the spec against the parity goal and remove any prompt-bloat or ticker-specific assumptions.

## 2. TDD Implementation

- [ ] 2.1 Add a failing unit test for product comparison summarization from two report summaries.
- [ ] 2.2 Add a failing unit test for unsupported base-ref reporting.
- [ ] 2.3 Implement reusable comparison helpers.
- [ ] 2.4 Add the product replay CLI script.
- [ ] 2.5 Ensure generated comparison reports are written under `tests/evals/runs/`.

## 3. Validation

- [ ] 3.1 Run focused replay harness unit tests.
- [ ] 3.2 Run a smoke product comparison against `origin/main` or document a blocking unsupported reason.
- [ ] 3.3 Run `npm run build`.
- [ ] 3.4 Run `npm test`.
- [ ] 3.5 Run `graphify update .`.
