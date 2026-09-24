# Test coverage baseline review — Node 24 cancellation integration

Date: 2026-09-24
Status: **PROPOSED measured baseline generated in this worktree (uncommitted).** No production/test edits; no metric-only tests added. Parent integrates only after the browser lane is green.
Scope: changed-code coverage review plus the final measured Node 24 + relay baseline extraction from the canonical root coverage.
Audience: parent/release owner deciding the Node 24 baseline recalibration.

## 1. Inputs and provenance (all read-only)

| Input | Path / value |
| --- | --- |
| Base commit | `70475315` |
| Current committed baseline | `scripts/coverage-baseline.json` — generated 2026-09-24T18:11:39Z on **Node 22.23.0** (V8 12.4.254.21-node.56); unit-only; **457** expected files; `provider-relay` `measured:false` |
| Current root unit raw | `coverage/unit/coverage-final.json` (Node 24.21.0, V8 13.6.233.17-node.53) |
| Current root merged raw | `coverage/coverage-final.json` (Node+relay) |
| Current root merged summary | `coverage/coverage-summary.json` — **460/460** files instrumented (includes the 3 production files added after this draft) |
| Pre-cancellation Node24 raw (old-location proxy) | `coverage/node24-diagnostic/coverage-final.json` (node 24.21.0; strengthened `runtime-transport-parity.test.ts`; identical to Node22 prior except hosted branches 86→83) |
| Regression report | `/tmp/oc-node24-regression-review.log` |
| **Final measured baseline (this worktree)** | `scripts/coverage-baseline.json` — `generatedAt 2026-09-24T20:52:43.201Z`, `command "npm run test:coverage"`, schemaVersion 1, **460/460** files, all surfaces `measured:true` |
| Baseline generation log | `/tmp/oc-baseline-generate.log` |
| `--check` validation log | `/tmp/oc-baseline-check.log` (exit 0) |
| Old-vs-new per-file diff | `/tmp/oc-baseline-diff.log` |
| Handoff | `/tmp/oc-close-baseline.md` |

Method:
1. Per-file baseline counts vs current unit counts (covered/total per metric).
2. `git diff -U0 70475315 -- <file>` added/removed lines.
3. Current uncovered statements/branch sites/functions intersected with the added lines.
4. Source diff + actual tests read for every regression; no production changes made.
5. Evidence scripts kept under `coverage/calibration/simple-classify.mjs` and `location-review.mjs` (gitignored).

## 2. Outcome

**No unexplained old-covered-location loss was found.** Every regressed file except two had **covered counts increase** (or stay flat with a growing denominator); the ratio drops come from **new/changed code** that the unit lane does not execute. The two exceptions are explained and justified:

- `src/runtime/session-coordinator.ts` — one **actual statement/line deletion** (denominator legitimately shrank).
- `gui/web/src/runtime/hosted-runtime-transport.js` — source unchanged (`+0/-0`); a **test-induced** branch delta.

**Final denominator is 460 files (all measured), versus the old 457 (whose 2 relay files were listed but `measured:false`).** The relay lane is now measured and 3 production files were added after the draft; the baseline must not shrink back. See §5b for the final measured numbers.

## 3. Per-file classification

Counts are `covered/total`, baseline(unit) → current(unit). `dC` = covered delta; `dT` = total delta.

| File | Metric deltas | Classification | Evidence |
| --- | --- | --- | --- |
| `src/pi/session-core.ts` | lines 28/29→32/35 (+4/+6); funcs 5/5→5/6 (0/+1); branches 25/27→27/33 (+2/+6); stmts 31/32→36/40 (+5/+8) | **New path** (session coordinator lookup / cancellation state) | diff +23/−0; new `getSessionCoordinator` WeakMap helper (uncovered added lines 61–62, function@60) plus cancellation-state attach. The unit lane does not call the helper; the **child journey executes it unmeasured** |
| `src/routing/router.ts` | lines 400/430→408/441 (+8/+11); funcs 86/87→88/89 (+2/+2); branches 509/572→520/586 (+11/+14); stmts 441/478→453/495 (+12/+17) | **New path** (abort signal plumbing/guards) | diff +27/−3; new `signal` param, early `if (signal?.aborted)` at line 57 (**covered**, branch [1,140]), post-error re-check line 70, retry-catch line 78, `isAbortLikeError`/`abortErrorFor`. Covered rose; only the new edge paths below are uncovered |
| `src/runtime/session-coordinator.ts` | lines 391/429→390/428 (−1/−1); funcs 0/0; branches 0/0; stmts 416/476→415/475 (−1/−1) | **Actual line deletion** (justified) | diff: `activeRef.active = false` replaced by `this.markWorkflowInterrupted(activeRef, "stopped")`; `this.activeWorkflowRunRef = null` removed so the workflow promise's terminal path records the durable `workflow_interrupted` closure; runner cancel moved into `else`. One statement deleted → denominator and covered both −1. **Not an exclusion** |
| `gui/server/http-routes.ts` | lines 255/534→320/611 (+65/+77); funcs 44/70→46/74 (+2/+4); branches 218/540→273/606 (+55/+66); stmts 270/592→337/675 (+67/+83) | **New paths, mostly covered** | diff +216/−6; new run-cancel/trusted-mutation routes. Only 2 added inline functions uncovered (`@777` cancel handler body, `@980` `setApplyCancel` wiring); the large covered increase is the cancellation route work |
| `gui/web/src/App.jsx` | lines 86/235→87/239 (+1/+4); funcs 0/0; branches 64/178→64/184 (0/+6); stmts 95/273→96/277 (+1/+4) | **New path** (drawer focus opener) | diff +14/−1; new `openDrawer` history-opener capture (added uncovered 181/185/186). No covered branch/line lost |
| `gui/web/src/features/sessions/SessionHistory.jsx` | lines 29/40→29/44 (0/+4); funcs 14/17→14/18 (0/+1); branches 17/33→17/35 (0/+2); stmts 32/47→32/52 (0/+5) | **New path** (close-auto-focus restore) | diff +18/−2; new `onCloseAutoFocus` restore-opener handler (added uncovered 57–60, function@50). Covered flat → no old loss |
| `gui/web/src/hooks/useChatRun.jsx` | lines 87/108→98/128 (+11/+20); funcs 20/24→23/29 (+3/+5); branches 60/95→70/114 (+10/+19); stmts 92/121→107/146 (+15/+25) | **New path** (targeted server stop) | diff +59/−2; new `stopRun` server-side `cancelChatRun` path + unconfirmed toast (added uncovered 199–228, functions@220/@226). Covered rose |
| `gui/web/src/runtime/hosted-runtime-transport.js` | lines 133/172→140/172 (+7/0); funcs 30/45→32/45 (+2/0); branches 86/152→85/152 (**−1**/0); stmts 140/189→147/189 (+7/0) | **Test-induced branch delta** (no source change) | diff `+0/−0`. The strengthened `runtime-transport-parity.test.ts` stopped returning `undefined` from `host.request`, removing incidental defensive-default branch paths; a new real session-isolation test restored the meaningful session-match `if`. Remaining gap is in the defensive defaults (`payload?.role || "writer"` line 35, `sessions || []` line 76). No production change, no exclusion |
| `gui/web/src/runtime/runtime-transport.js` | lines 44/49→47/52 (+3/+3); funcs 24/30→25/31 (+1/+1); branches 30/44→32/48 (+2/+4); stmts 50/59→53/63 (+3/+4) | **New path** (`cancelChatRun`) | diff +6/−0; new `cancelChatRun` POST `/api/sessions/:id/run-cancel` (added uncovered 107/108). Covered rose |

## 4. Unexplained loss and genuine-hole assessment

**No unexplained loss.** Covered counts rose for 7/9 files; `SessionHistory`/`App` branches are flat while only new uncovered code was added; `coordinator` is a real deletion; `hosted` is test-induced.

Candidate genuine holes (new cancellation contracts not exercised by the **unit** lane) — flagged for a decision, **not** fixed here:

1. **`src/routing/router.ts` abort edge paths (new code).** The new tests cover the signal forwarded to the client, the already-aborted early throw (line 57), and abort during the first call (line 66). Still unit-uncovered:
   - line 70 `if (signal?.aborted) throw abortErrorFor(signal)` after a first validation error — no test aborts between the validation failure and the retry;
   - line 78 `if (isAbortLikeError(err, signal)) throw err` — no test aborts during the retry call;
   - `abortErrorFor` fallback lines 92–94 (`signal.reason` not an `Error`) — never constructed.
   These are meaningful cancellation contracts ("a stopped run must not open the retry request"). If unit-level protection is wanted, one focused test per path is justified (abort between validation failure and retry; abort during retry). Otherwise the cancellation journey lane is the owner. **No test added now** per instruction.
2. **`src/pi/session-core.ts` `getSessionCoordinator` (new code).** No unit test calls it; the **child journey** does, and child-process coverage is not merged into the Node lane. This is a lane measurement gap, not a product hole. A small unit test of the guard/lookup would be meaningful only if the WeakMap contract is considered unit-level; otherwise record it as child-lane coverage.
3. **GUI new cancellation/focus paths** (`useChatRun.stopRun`, `runtime-transport.cancelChatRun`, `http-routes` cancel routes, `App`/`SessionHistory` focus restore) are exercised by the real GUI journey/browser lane, not the unit lane. Not holes; the parent is waiting for the real journey green.

Nothing else warrants a test; the remaining uncovered lines in these files are pre-existing unit-uncovered paths unrelated to this change.

## 5. Proposed Node 24 baseline recalibration (draft snapshot — superseded by §5b)

1. **Regenerate on the canonical runtime** (`node@24`, currently 24.21.0 / V8 13.6.233.17-node.53) and record runtime provenance (node, v8, OS/arch, browser build) in the baseline/report. Keep the 1e-6 float tolerance; do not loosen.
2. **Lock the Node+relay denominator at 459 measured files** (457 unit + 2 relay), with `provider-relay` `measured:true`, replacing the old 457-file unit-only snapshot.
3. **Preserve improvements**: all covered increases are real; do not restore the old lower totals.
4. **Proposed per-file recalibrated entries** (current Node24 values; `lines`, `functions`, `branches`, `statements` as covered/total):

| File | lines | functions | branches | statements |
| --- | --- | --- | --- | --- |
| `src/pi/session-core.ts` | 32/35 | 5/6 | 27/33 | 36/40 |
| `src/routing/router.ts` | 408/441 | 88/89 | 520/586 | 453/495 |
| `src/runtime/session-coordinator.ts` | 390/428 | 78/83 | 329/406 | 415/475 |
| `gui/server/http-routes.ts` | 320/611 | 46/74 | 273/606 | 337/675 |
| `gui/web/src/App.jsx` | 87/239 | 16/70 | 64/184 | 96/277 |
| `gui/web/src/features/sessions/SessionHistory.jsx` | 29/44 | 14/18 | 17/35 | 32/52 |
| `gui/web/src/hooks/useChatRun.jsx` | 98/128 | 23/29 | 70/114 | 107/146 |
| `gui/web/src/runtime/hosted-runtime-transport.js` | 140/172 | 32/45 | 85/152 | 147/189 |
| `gui/web/src/runtime/runtime-transport.js` | 47/52 | 25/31 | 32/48 | 53/63 |

These values are from the current root snapshot (Node 24.21.0). Regenerate them from the final source after the real journey is green; they are the expected shape and the direction of each change, not a frozen artifact.

5. **Record the coordinator deletion** in the review note: `this.activeWorkflowRunRef = null` was actually removed; `activeRef.active = false` became `markWorkflowInterrupted(activeRef, "stopped")`. The denominator shrink is a code deletion, **not** an exclusion and not a coverage hole.
6. **Record the hosted branch delta** as test-realism: source unchanged; the strengthened parity test removed incidental defensive-default paths; a new session-isolation test restored the meaningful path.
7. **Do not add metric-only tests.** The router abort edge paths (4.1) are the only candidates for a *meaningful* new test; decide before or alongside the recalibration. `getSessionCoordinator` is child-lane coverage unless the parent wants a unit guard test.

## 5b. Final measured baseline (canonical Node 24 + relay) — generated, uncommitted

Generated in this worktree with the ROOT reporter CLI, which reads the ROOT tree/summary and writes only the worktree baseline:

```bash
npm exec --yes --package=node@24 -- node /Users/kahtaf/Documents/workspace/opencandle/scripts/coverage-report.mjs \
  --repo-root /Users/kahtaf/Documents/workspace/opencandle \
  --input /Users/kahtaf/Documents/workspace/opencandle/coverage/coverage-summary.json \
  --baseline /private/tmp/oc-test-trust-measurement/scripts/coverage-baseline.json \
  --update-baseline
```

- CLI runtime: **Node 24.21.0** via `npm exec --yes --package=node@24 --` — same major/version reported for the canonical root raw. The extraction step is a JSON + on-disk-inventory pass.
- Artifact: `scripts/coverage-baseline.json` in this worktree, `generatedAt 2026-09-24T20:52:43.201Z`, `command "npm run test:coverage"`, schemaVersion 1.
- **460/460 files instrumented, 0 missing, every surface `measured:true`** (old baseline: 457 expected files, `provider-relay` `measured:false`). The +3 expected files vs the old baseline are production added since the draft: `src/pi/session-cancellation.ts`, `gui/server/durable-session-persist.ts`, `gui/server/run-cancellation.ts`. Full production denominator preserved; no exclusions added; `--tolerance` left at the default `1e-6`.

Surface totals (covered/total):

| surface | lines | functions | branches | statements | files |
| --- | --- | --- | --- | --- | --- |
| core | 88.69% (8921/10059) | 92.28% (1877/2034) | 76.28% (7266/9526) | 86.17% (9717/11276) | 204/204 |
| gui-server | 71.04% (1585/2231) | 74.54% (325/436) | 63.42% (1203/1897) | 68.95% (1730/2509) | 31/31 |
| gui-shared | 92.40% (474/513) | 96.26% (103/107) | 78.93% (397/503) | 90.37% (516/571) | 12/12 |
| gui-web | 66.92% (4313/6445) | 64.99% (1305/2008) | 56.67% (4539/8010) | 64.25% (4781/7441) | 174/174 |
| gui-hosted | 69.34% (1972/2844) | 71.27% (387/543) | 59.02% (1417/2401) | 66.63% (2087/3132) | 25/25 |
| ui-package | 100.00% (28/28) | 100.00% (13/13) | 95.00% (38/40) | 96.67% (29/30) | 12/12 |
| provider-relay | 92.63% (314/339) | 92.86% (65/70) | 85.60% (315/368) | 86.96% (340/391) | 2/2 |

Overall: lines **78.40% (17607/22459)**, functions **78.20% (4075/5211)**, branches **66.73% (15175/22745)**, statements **75.74% (19200/25350)**.

Validation: the same `npm exec --yes --package=node@24 --` invocation with `--check` in place of `--update-baseline` → **exit 0**, no regressions, no missing files.

### Per-file deltas vs the old 457-file Node 22 unit-only baseline

`covered/total`; an omitted metric is unchanged.

**core**

| file | lines | funcs | branches | stmts |
| --- | --- | --- | --- | --- |
| `src/infra/freshness.ts` | 56/61 → 57/61 | 10/10 | 72/85 → 73/85 | 60/67 → 61/67 |
| `src/pi/opencandle-extension-core.ts` | 305/400 → 335/424 | 33/46 → 40/49 | 223/362 → 257/390 | 322/440 → 362/471 |
| `src/pi/session-cancellation.ts` | 13/13 | 8/8 | 6/6 | 15/15 *(new file)* |
| `src/pi/session-core.ts` | 28/29 → 32/35 | 5/5 → 5/6 | 25/27 → 27/33 | 31/32 → 36/40 |
| `src/pi/session.ts` | 3/4 → 4/4 | 1/2 → 2/2 | 12/15 → 14/15 | 3/4 → 4/4 |
| `src/providers/alpha-vantage.ts` | 133/139 → 135/139 | 20/21 | 78/129 → 84/129 | 140/157 → 143/157 |
| `src/providers/lse.ts` | 124/133 → 128/133 | 20/20 | 124/155 → 127/155 | 147/165 → 153/165 |
| `src/providers/yahoo-finance.ts` | 282/335 → 285/335 | 55/61 → 56/61 | 281/432 → 282/432 | 312/381 → 314/381 |
| `src/routing/router-llm-client.ts` | 22/24 → 25/27 | 6/6 | 16/21 → 18/23 | 22/25 → 25/28 |
| `src/routing/router.ts` | 400/430 → 408/441 | 86/87 → 88/89 | 509/572 → 520/586 | 441/478 → 453/495 |
| `src/runtime/session-coordinator.ts` | 391/429 → 390/428 | 78/83 | 329/406 | 416/476 → 415/475 |
| `src/tools/fundamentals/dcf.ts` | 123/136 → 125/136 | 23/23 | 102/125 → 103/125 | 139/154 → 141/154 |
| `src/tools/market/stock-quote.ts` | 17/17 | 3/3 | 12/16 → 13/16 | 17/17 |

**gui-server**

| file | lines | funcs | branches | stmts |
| --- | --- | --- | --- | --- |
| `gui/server/chat-event-adapter.ts` | 182/192 → 192/202 | 24/25 | 142/191 → 146/195 | 193/212 → 203/222 |
| `gui/server/durable-session-persist.ts` | 12/18 | 2/2 | 7/8 | 16/22 *(new file)* |
| `gui/server/http-routes.ts` | 255/534 → 336/621 | 44/70 → 46/74 | 218/540 → 280/608 | 270/592 → 354/685 |
| `gui/server/run-cancellation.ts` | 24/24 | 8/9 | 12/12 | 28/28 *(new file)* |
| `gui/server/session-actions.ts` | 68/101 → 88/111 | 22/31 → 27/33 | 42/75 → 51/82 | 80/130 → 101/141 |

**gui-web**

| file | lines | funcs | branches | stmts |
| --- | --- | --- | --- | --- |
| `gui/web/src/App.jsx` | 86/235 → 87/239 | 16/70 | 64/178 → 64/184 | 95/273 → 96/277 |
| `gui/web/src/components/chat/custom-message.jsx` | 4/5 → 6/7 | 1/1 | 3/4 → 5/6 | 4/5 → 6/7 |
| `gui/web/src/features/sessions/SessionHistory.jsx` | 29/40 → 29/44 | 14/17 → 14/18 | 17/33 → 17/35 | 32/47 → 32/52 |
| `gui/web/src/hooks/useChatRun.jsx` | 87/108 → 98/128 | 20/24 → 23/29 | 60/95 → 70/114 | 92/121 → 107/146 |
| `gui/web/src/runtime/hosted-runtime-transport.js` | 133/172 → 140/172 | 30/45 → 32/45 | 86/152 → 85/152 | 140/189 → 147/189 |
| `gui/web/src/runtime/runtime-transport.js` | 44/49 → 47/52 | 24/30 → 25/31 | 30/44 → 32/48 | 50/59 → 53/63 |

**provider-relay**

| file | lines | funcs | branches | stmts |
| --- | --- | --- | --- | --- |
| `workers/provider-relay/src/relay.ts` | 0/339 → 314/339 | 0/70 → 65/70 | 0/368 → 315/368 | 0/391 → 340/391 |

### Covered-count losses (exactly two, all explained)

1. **`src/runtime/session-coordinator.ts` lines/stmts −1 (denominator −1 too).** Real deletion: `activeRef.active = false` became `this.markWorkflowInterrupted(activeRef, "stopped")`, `this.activeWorkflowRunRef = null` was removed, and `this.runner?.cancel()` moved into the `else`. One statement removed → covered and total both −1. Not an exclusion, not a hole.
2. **`gui/web/src/runtime/hosted-runtime-transport.js` branches −1 (total unchanged).** Source unchanged (`git diff +0/-0`). The strengthened `runtime-transport-parity.test.ts` stopped returning `undefined` from `host.request`, removing incidental defensive-default branch hits; a new session-isolation test restored the meaningful session-match branch. Test-realism, no production change.

**Option-chain wall-clock nondeterminism is fixed upstream, so it is no longer a delta.** The unit tests now pin the market clock (fake timers), restoring `src/tools/options/option-chain.ts` to 25/30 and removing the earlier conservative after-hours lowering from this baseline; its row was removed from the delta table. The final stable ROOT run is 3913 passed / 0 skipped (relay 76), and the root summary rose from 15173 to **15175/22745 branches** (option-chain +1 and `src/providers/yahoo-finance.ts` +1); all other metrics unchanged. The baseline is no longer time-of-day dependent.

Genuine holes already flagged in section 4 (router abort edge paths, `getSessionCoordinator`, GUI cancellation/focus paths) are unchanged by this extraction.

### Unmeasured child/browser lane policy

- The gated Node baseline covers in-process Node execution only: `vitest run --project unit --coverage` merged with the `provider-relay` workspace lane. Every listed production surface is now measured by one of those two lanes (460/460); no surface is silently zeroed.
- **Browser lane is informational and non-gating.** `scripts/coverage-browser.mjs` / `coverage:browser` reports browser coverage with provenance and must not feed `scripts/coverage-baseline.json` nor fail `coverage:check`. Browser-only paths stay a named `limitation` on `gui-web`, `gui-hosted`, and `ui-package`.
- **Child-process lane is not merged.** V8 coverage does not follow spawned processes, so code executed only in a deterministic child journey (e.g. `getSessionCoordinator`, spawned `gui/server` routes) is recorded as unit-uncovered. Recorded as a lane measurement gap, never as an exclusion and never as covered.
- No exclusion or tolerance loosening: `EXCLUSIONS` still lists only generated/build/test/config/vendored paths; default `1e-6` tolerance retained.

## 6. Status / next steps

- Proposed measured baseline **generated and locally validated (`--check` exit 0)** in this worktree: `scripts/coverage-baseline.json`, 460/460 files, all surfaces measured.
- Baseline is **uncommitted** on `test-trust/measurement` (`leave-uncommitted`, no PR). Parent integrates only after the browser lane is green and the final source is frozen.
- No production edits, no test additions, no root writes; only the worktree baseline and this review note were written.
- Handoff: `/tmp/oc-close-baseline.md`.

## 7. Post-review re-measurement against the final canonical ROOT coverage (Node 24 direct binary)

Date: 2026-09-24. Input: canonical ROOT `coverage/coverage-summary.json` from the completed Node lane (`/tmp/oc-candidate-coverage-node.log`: `vitest run --project unit --coverage` + relay workspace, merged by `coverage-merge.mjs`; raw log totals lines 17627/22469). Runtime: **node v24.21.0 invoked directly** (`PATH=/Users/kahtaf/.npm/_npx/387698761821791d/node_modules/node/bin:$PATH node …`), **not** a nested `npm exec`. No full test rerun, no production/test edit, no ROOT write.

Regenerated with `scripts/coverage-report.mjs --repo-root <ROOT> --input <ROOT>/coverage/coverage-summary.json --baseline <worktree>/scripts/coverage-baseline.json --update-baseline`, then the same invocation with `--check` → **exit 0**, 460/460 files, all surfaces measured, no unmeasured surface.

| surface | lines | functions | branches | files |
| --- | --- | --- | --- | --- |
| core | 88.80% (8941/10069) | 92.43% (1881/2035) | 76.33% (7274/9530) | 204/204 |
| gui-server | 71.04% (1585/2231) | 74.54% (325/436) | 63.34% (1201/1896) | 31/31 |
| gui-shared | 92.40% (474/513) | 96.26% (103/107) | 78.93% (397/503) | 12/12 |
| gui-web | 66.92% (4313/6445) | 64.99% (1305/2008) | 56.67% (4539/8010) | 174/174 |
| gui-hosted | 69.34% (1972/2844) | 71.27% (387/543) | 59.02% (1417/2401) | 25/25 |
| ui-package | 100.00% (28/28) | 100.00% (13/13) | 95.00% (38/40) | 12/12 |
| provider-relay | 92.63% (314/339) | 92.86% (65/70) | 85.60% (315/368) | 2/2 |

Overall: lines **78.45% (17627/22469)**, functions **78.26% (4079/5212)**, branches **66.73% (15181/22748)**, statements **75.78% (19219/25359)**. Delta vs the §5b baseline (17607/22459 lines, 4075/5211 funcs, 15175/22745 branches): **+20/+10 lines, +4/+1 functions, +6/+3 branches**.

Three per-file deltas, all in files changed after the prior measurement:

| file | change (covered/total) | direction |
| --- | --- | --- |
| `src/infra/native-dependencies.ts` | lines 11/30→31/40; funcs 2/7→6/8; branches 6/16→14/20; stmts 11/32→31/42 | **gain** — Windows JS runner now covered by 6 real public-function tests |
| `gui/server/chat-event-adapter.ts` | lines 192/202→195/205; branches 146/195→150/199; stmts 203/222→206/225 | **gain** — adapter now consumes the original attachment cancel state |
| `gui/server/local-session-coordinator.ts` | lines 41/41→38/38; branches 26/26→20/21; stmts 45/45→41/41 | **loss, confirmed deletion** |

The sole covered-count loss is `gui/server/local-session-coordinator.ts`. ROOT `git diff` confirms the queue branch was deleted: `queueChatPrompt` / `previousRun` / `await previousRun` removed, and the guard changed from `runAdmissionAction && !queueChatPrompt && sessionRunTails.has(...)` to `runAdmissionAction && sessionRunTails.has(...)`, so a second chat is now rejected while a run is in flight. Line and statement denominators shrink with the code (41→38, 45→41) — a real removal, not an exclusion and not a coverage hole. **No unexplained loss in any untouched file.** The one residual uncovered branch is exact and understood: `gui/server/local-session-coordinator.ts` branch 8 at line 86, `hits [16,0]` — the **false** side of `sessionRunTails.get(action.sessionId) === runTail`. That path was reachable only when a queued `chat.prompt` overwrote the session run tail; under the new no-concurrent-admission invariant the tail cannot be replaced while a run is active, so the false side is now unreachable through the public admission contract. The guard is retained as defensive code; this is **not** missing busy/cancel behaviour and **not** a coverage hole.

Limitations preserved unchanged: the browser lane stays informational/non-gating and does not feed `scripts/coverage-baseline.json` or `coverage:check`; `gui-web`, `gui-hosted`, and `ui-package` keep their named browser-runtime limitation; the child-process lane remains unmerged. `EXCLUSIONS` and the default `1e-6` tolerance are unchanged (no exclusions or tolerance loosening).

Handoff for this re-measurement: `/tmp/oc-candidate-baseline.md`.
