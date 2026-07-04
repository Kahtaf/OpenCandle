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

# E3 Provider-Outage Eval Notes

Branch: `feat/eval-provider-outage`

## Cases And Assertions

- `zero-filled Yahoo quote mid-comparison`
  - Test: `tests/unit/evals/provider-outage-deterministic.test.ts`
  - Fixtures: `tests/fixtures/yahoo/AAPL-quote.json`, `tests/fixtures/yahoo/MSFT-quote.json`, `tests/fixtures/yahoo/XXFAKEXX-quote.json`
  - Assertions: missing symbol is explicitly unavailable, `details` is null for the missing symbol, no `XXFAKEXX: $0.00` price is emitted, and survivor quote prices remain positive.

- `Yahoo 429 mid-correlation`
  - Test: `tests/unit/evals/provider-outage-deterministic.test.ts`
  - Fixtures: `tests/fixtures/yahoo/AAPL-history-e3.json`, `tests/fixtures/yahoo/MSFT-history-e3.json`
  - Assertions: `analyze_correlation` returns a matrix for surviving symbols, excludes `OUTAGE`, reports `OUTAGE: HTTP 429 Too Many Requests`, includes structured `details.dropped` metadata, and therefore proves the dropped-symbol note while the comparison proceeds on survivors.

- `stale weekend quote timestamp`
  - Test: skipped known-fail in `tests/unit/evals/provider-outage-deterministic.test.ts`
  - Fixture: `tests/fixtures/yahoo/weekend-stale-quote.json`
  - FINDING: current quote tooling does not expose Yahoo's provider quote timestamp in text or details, so deterministic stale-weekend disclosure cannot be asserted without a future production freshness-ledger/tool-output change.

- `opencandle-turn-gap trace entry`
  - Test: skipped known-fail in `tests/unit/evals/provider-outage-deterministic.test.ts`
  - FINDING: deterministic tool-level outage cases do not emit `opencandle-turn-gap`; that entry is produced by the live Pi/OpenCandle turn interceptor and needs a credentialed harness eval before promotion to a gating assertion.

## Evidence

- Named E3 test log: `docs/internal/pr-evidence/feat-eval-provider-outage/e3-provider-outage-vitest.log`

# PR Notes: GUI Session-Scoped Actions

- Legacy `/api/chat/run` route is unavailable with HTTP 410: `tests/unit/gui-server/server-route-guards.test.ts`.
- Browser chat sends require explicit `sessionId` and reuse `actionId` for transport retry: `tests/unit/gui-web/use-chat-run.test.ts`.
- Browser ask-user and tool actions require explicit session identity and mint action IDs at call time: `tests/unit/gui-web/use-gui-connection.test.ts`.
- Server coordinator routes require `sessionId` plus `actionId` before mutation: `tests/unit/gui-server/server-route-guards.test.ts`.
- Ask-user actions do not fall back to the focused/current session: `tests/unit/gui-server/session-actions.test.ts`.
- Tool invocation browser messages use explicit session/action IDs: `tests/unit/gui-server/invoke-tool.test.ts`.
- Different sessions can run concurrently while same-session action exclusion remains: `tests/unit/gui-server/local-session-coordinator.test.ts` and `tests/e2e/gui-browser.test.ts`.
- GUI-created sessions remain TUI-continuable without SQLite schema or Pi session format changes: `tests/unit/gui-server/session-resume.test.ts` and `docs/internal/pr-evidence/feat-gui-session-scoped-actions/tui-resume-transcript.md`.
- Browser runtime evidence for two concurrent sessions with a stop targeting the background session is in `docs/internal/pr-evidence/feat-gui-session-scoped-actions/browser-concurrent-stop-log.json` plus desktop/mobile screenshots.
