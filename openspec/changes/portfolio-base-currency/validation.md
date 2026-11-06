# Validation — 2026-11-06

Implementation is left uncommitted in the shared checkout. No branch changes, commits, pushes, GitHub posts, schema changes, provider additions, FX conversion, or system-prompt edits were performed. The parallel `portfolio-fx-conversion` proposal was not edited.

## Completed evidence

- Preserved initial red: `validation-output/portfolio-base-currency/red.log` (3 failed, 90 passed).
- Initial implementation: `focused.log` had one stale GUI label assertion (Rename portfolio became Portfolio settings); updated the assertion to the new accessible label. `focused-green.log`: 93 passed.
- A returned stale edit timestamp was reproduced in `timestamp-red.log` (1 failed, 14 passed), fixed at the service return boundary, then verified in `timestamp-green.log`.
- Final focused service/tool/GUI/hosted SQLite checks: `polish-focused.log`, 99 passed across four files. Hosted proof uses real browser-compatible SQLite with injected market-data fixtures, not a live hosted deployment.
- Live TUI harness: `tui-trace.json` shows actual create EUR, set_base_currency GBP, and view calls; completed successfully without holdings or provider requests.
- Live local GUI at port 14589 with isolated `/tmp/oc-currency-gui` state: desktop creation in EUR, edit to GBP; reload verified GBP; mobile edit to CAD and creation in JPY; default portfolio edited to EUR and reloaded. After switching to shared Select chrome, default edited to GBP and reloaded (`final-mobile-reload.txt`).
- Viewed desktop/mobile create/edit captures and final settings captures. Mobile document width equals viewport width (390px). Browser page-error log was empty. Full before/after screenshot harness runs completed under `tests/screenshots/out/portfolio-currency-before` and `portfolio-currency-after`; those use fixture data, separately from live GUI proof.
- Applied Impeccable polish and Vercel React best practices: preserved existing panel layout/tokens, used shared Select for touch sizing/focus/arrow, explicit field labels and no-FX copy, pending/unchanged save states, keyed state reset, no added effects or fetching. This was a polish pass, not the skill's separate dual-agent critique workflow.

## Harness failures and limitations

- First agent-browser launch failed: `No usable sandbox!`; relaunched with the documented container `--no-sandbox` option successfully.
- One browser command used unsupported `find ... select` syntax and failed; corrected to snapshot-reference `select`, then verified save/reload. An extra conflicting-create snapshot was taken too early to capture a toast; no GUI error-toast proof is claimed. Service/tool conflict regression tests pass.
- First full-gate command ended with execution-harness status 143 during unit tests, with no gate report (`gates-full.log`). A detached launch produced an empty log and did not survive process cleanup. A retained PTY runs the replacement (`gates-full-detached.log`); despite its filename, the replacement is not detached. These are harness interruptions, not passing gates or test assertion failures.

## Closeout command

The retained closeout script runs `npm run gates:full`, then the authorized review equivalent:

```sh
node scripts/check-codex-version.mjs && .agents/skills/autoreview/scripts/autoreview --mode local --model codex=gpt-6.1-sol --prompt-file .agents/skills/autoreview/references/opencandle-review.md --parallel-tests "npm run gates:full"
```

Only `--mode branch` is substituted with `--mode local`; all checks, reviewer/model flags, and parallel full gates are preserved. The helper's local mode reads all tracked diffs and untracked file contents, including the proposal. No untracked implementation files exist. Its bundle may also contain the parallel FX proposal because it is present in the shared checkout; no changes to that proposal are authorized by this task.

Final outcomes are recorded below.

## Coverage regression and final review restart

The retained first full gate completed with exit 1 at coverage (`gates-full.exit`, report `validation-output/gates/2026-11-06T16-49-30-453Z-457033.json`). Prior steps passed: 4,990 unit tests, 76 relay tests, 358 agent-tool tests, 30 site tests, 29 GUI integration tests, 29 GUI journey tests, 9 release smoke tests, hosted GUI, and package contents.

The coverage regression was caused by the tracker bypassing the existing implicit-creation helper: `getOrCreatePortfolio` became unexecuted. A new service regression test (`implicit-red.log`) demonstrated that the helper itself discarded the requested base currency. It now accepts the reporting currency and delegates to the same validated create path; the tracker uses it again. `implicit-green.log`: 47 focused service/tool/hosted tests passed. No baseline or gate was changed. Additional default/missing/misplaced/invalid-currency checks passed in `currency-validation.log` (26 tool tests).

The first autoreview bundle predated this fix, so that attempt was explicitly interrupted, preserving `autoreview-before-implicit-fix.log` including its KeyboardInterrupt. The final review command is identical (local mode, gpt-6.1-sol, same prompt, parallel full gate), captured in `autoreview-final.log` with exit status recorded in `autoreview-final.exit`. This final run establishes final review/full-gate success.


## Final outcome

- `autoreview-final.exit`: **0**. Full gate passed in 1857.6 seconds; report: `validation-output/gates/2026-11-06T17-15-24-950Z-477745.json`.
- Final unit suite: **4,991 tests / 406 files passed** (both ordinary and instrumented runs). Relay: 76; agent tools: 358; site: 30; GUI integration: 29; GUI journeys: 29; release smoke: 9; browser coverage: 58. Hosted GUI, package contents, coverage baseline check, and browser coverage processing all passed.
- Autoreview: **clean, no accepted/actionable findings**, overall patch correct (0.87), Codex `gpt-6.1-sol`, local target, 80,148-character bundle. React Doctor: **passed, 0 errors, 0 warnings, 2 changed files**. No review findings required acceptance/rejection or further patches.
- The only review-command substitution was the authorized `--mode local` in place of `--mode branch`; model, prompt, version prerequisite, and `--parallel-tests "npm run gates:full"` were preserved. Full gates include the entire core gate battery; no separate redundant core-only run was needed.
- No fresh worktree was created, so bootstrap was not repeated on this resumed checkout. The manual GUI server was stopped after proof. No GitHub operations were performed.
- Final evidence notes added after review were manually checked; no implementation file changed after the final review began. There are no untracked implementation files or known remaining blockers. Hosted evidence is local harness/SQLite proof, not a deployed-site verification.

## Files changed

- `src/market-state/service.ts`: normalized/validated creation and explicit reporting-currency edits; currency-aware implicit creation.
- `src/tools/portfolio/tracker.ts`: separate `base_currency`, explicit `set_base_currency`, rejection of misplaced/conflicting requests.
- `gui/web/src/features/market-state/MarketStatePage.jsx`: create selector and existing/default reporting-currency form.
- `gui/web/src/features/market-state/PortfolioPage.jsx`: accessible Portfolio settings entry point.
- `tests/unit/market-state/service.test.ts`
- `tests/unit/tools/portfolio-tracker.test.ts`
- `tests/unit/gui-web/market-state-page-render.test.ts`
- `tests/unit/gui-hosted/hosted-stateful-tool-composition.test.ts`
- `CHANGELOG.md`: one user-visible Unreleased entry.
- `openspec/changes/portfolio-base-currency/proposal.md`
- `openspec/changes/portfolio-base-currency/validation.md`
