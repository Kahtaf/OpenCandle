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

## Live Finding — CORRECTED (2026-07-04 overnight review)

The originally archived "claude-haiku-4-5 4/32" baseline was NOT a live
model run: every call failed at the credential layer (p50 latency 1ms, all
fields `undefined` — the router's `minimalFallback` substitute output) and
the artifact misrepresented a dead credential as model behavior. Both
copies (`router-live-2026-07-04-claude-haiku-4-5.txt` here and
`2026-07-04-claude-haiku-4-5-32-fixtures.txt` in the canonical baseline
dir) were deleted per the E2E-first evidence policy ("STOP and request the
credential; do not substitute"). A Claude-family comparison baseline
remains an open optional item (I5) pending Pi-auth model resolution in the
eval script — this environment has no raw ANTHROPIC_API_KEY by design.
Current live Gemini baselines for the 32-fixture set live in
`tests/fixtures/router/eval-baselines/2026-07-04-gemini-2.5-flash-32-run{1,2}.txt`.
