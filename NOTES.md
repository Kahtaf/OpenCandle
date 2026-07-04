# feat/eval-router-fixtures

## Behavior-to-test mapping

- Added archived task 4.7 coverage for multi-symbol compare with prior context:
  `tests/fixtures/router/027-compare-prior-context.json`, proven by
  `npx vitest run tests/unit/routing/router-fixtures.test.ts`.
- Added fallback-from-general-QA shift coverage:
  `tests/fixtures/router/028-general-qa-to-analysis-shift.json`, proven by
  `npx vitest run tests/unit/routing/router-fixtures.test.ts`.
- Added preference ECHO coverage that must not write a `preference_update`:
  `tests/fixtures/router/029-preference-echo-not-update.json`, proven by
  `npx vitest run tests/unit/routing/router-fixtures.test.ts`.
- Added router misclassification recovery coverage:
  `tests/fixtures/router/030-misclassification-recovery-current-portfolio.json`,
  `tests/fixtures/router/031-misclassification-recovery-options-position.json`,
  and `tests/fixtures/router/032-compare-recovery-from-company-names.json`, proven
  by `npx vitest run tests/unit/routing/router-fixtures.test.ts`.

## Evidence

- Deterministic fixture log:
  `docs/internal/pr-evidence/feat-eval-router-fixtures/router-fixtures-vitest.log`
- Live router eval baseline:
  `docs/internal/pr-evidence/feat-eval-router-fixtures/router-live-2026-07-04-claude-haiku-4-5.txt`
- Archived baseline copy:
  `tests/fixtures/router/eval-baselines/2026-07-04-claude-haiku-4-5-32-fixtures.txt`

## Live Finding

`npm run eval:router-live` ran with credentials from `.env` and completed
against 32 fixtures. It exited nonzero because the live model matched 4/32
fixtures exactly; the full failure list is preserved in the evidence files
above. The deterministic fixture suite remains green.
