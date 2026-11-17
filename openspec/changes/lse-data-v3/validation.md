# LSE integration audit — 2026-11-16

## Current handoff status

LSE Data 3.0 implementation is complete and live-verified with the replacement key. Final branch autoreview, including the charged-row correction, is clean in both batches (confidence 0.91). The complete fixed-HEAD full gate passed on `c77edbd3`: 5,124 unit tests, 88 relay tests, all other functional lanes, the Node/relay coverage ratchet, and 58 browser coverage tests.

The GUI quote-card journey now waits for completion and explicitly opens the result before inspecting it. Charged input rows are correctly distinguished from returned CSV records. Failed and superseded runs remain recorded below as historical evidence; the final successful run is recorded at the end. Hosted deployment was not performed, and a deployed LSE-specific hosted GUI journey remains pending that deployment.


## Sources

- [LSE Data 3.0 announcement](https://londonstrategicedge.com/lse-data-3/), dated 22 October 2026: added instruments/history, data-quality work, export service, and paid Level 3 exchange data.
- [Current API reference](https://londonstrategicedge.com/api-documentation), read in a real browser: v3 base is `https://download.londonstrategicedge.com`; structured errors and CSV/Parquet exports replace legacy reference rows. Its Retired endpoints section explicitly excludes financial reports from the surviving terminal routes.
- [Data licence](https://londonstrategicedge.com/licence/): personal-key usage, organizational/redistribution licensing, and derived-price provenance. This audit does not establish OC's legal entitlement for any particular deployment.

The announcement's prepared-job/resumable description differs from parts of the current API reference, which say exports return whole files and retired job routes return 404. Implement against the current contract and authenticated response evidence, rather than the announcement alone.

## Live evidence

Used OC's resolved local credential in request headers. No credential values or account identifiers are recorded here. Small read-only requests only; no bulk exports or account changes.

- Existing `getLseCandles("AAPL", "1d", { limit: 5 })`: fails with `ProviderCredentialError`, reason `stale`.
- Direct legacy `/vault/candles?symbol=AAPL&timeframe=1d&limit=2`: HTTP 403, `{"detail":"api key inactive"}`.
- Existing `getLseFinancials("AAPL")`: HTTP 410, message directing clients to the new documentation.
- Correct v3 host `/v3/usage`, `/v3/preview?market=us_stocks&symbol=AAPL&timeframe=1d`, and `/v3/reference/preview?dataset=financial_reports&symbol=AAPL`: each HTTP 401, `{"code":"key-unknown","message":"this key is not known"}`.
- Requests to `/v3` on the old API host return a generic Unauthorized response; changing only the path is insufficient.

These results establish a retired endpoint and a rejected configured key. They do not establish why the key was deactivated or whether a replacement key restores all datasets. Successful authenticated v3 data normalization remains unverified.

## Code impact

- `src/providers/lse.ts`: old host/routes; JSON-array assumption; three parallel statement calls; legacy error-detail parser and broad 403 credential classification.
- `src/onboarding/validation.ts`: readiness probes legacy candles only, so even a legacy candle success would not prove financial-report readiness.
- `src/infra/lse-byte-budget.ts`: monthly 50 GiB cap and 80% threshold; incompatible with v3 weekly bytes and daily rows.
- `src/infra/rate-limiter.ts`: 100 requests/minute, versus v3 free-tier 60.
- `workers/provider-relay/src/relay.ts`: only two legacy LSE URLs allowed; v3 calls would be blocked in hosted OC.
- `src/tools/fundamentals/financials.ts`, `dcf.ts`, and history paths: fallback chains exist; their mock-based tests cannot detect upstream retirement or key validity.
- `tests/e2e/providers.test.ts`: LSE live lane exercises candles only, leaving financial-report retirement undetected.

## Verification

- Focused Vitest run: 8 files, 112 tests passed (provider, budget, statements, DCF, history/failures, credential validation, GUI history parity). This confirms fixture-based behavior, not upstream availability.
- Live TUI harness invoked the real `get_financials` tool for AAPL. LSE returned 410 and Alpha Vantage returned a rate-limit response. OC's final answer correctly reported statements unavailable from both sources. Fallback was attempted; successful financial retrieval was not established. Trace: `/tmp/oc-lse-audit-session/trace.json` (local, untracked).
- Live TUI harness also invoked `get_stock_history` for AAPL, one month of daily candles: 22 bars returned successfully. The tool result did not expose a provider name, so this proves ordinary history availability, not LSE recovery. Trace: `/tmp/oc-lse-history-audit/trace.json` (local, untracked).
- `npm run gates` started: `npm run check` passed (typechecks and Biome; 66 warnings). The full unit-test step is still running at audit handoff; the gate is not reported as passed. Log: `/tmp/oc-lse-gates.log`. No full/release gate or autoreview was run for this proposal-only change.

The findings above describe the pre-migration audit. The maintainer approved implementation and replaced the key on 2026-11-16.


## Migration implementation and live proof

Implemented the v3 adapter using CSV exports, one shared financial-report export per symbol, serialized downloads, credential-scoped caches/meters, bounded requests/files/retries, split-adjustment confirmation, and checksum validation. Updated credential validation and CLI/GUI doctor checks to exercise reference access. Updated both the hosted runtime routing and relay allowlist/metadata handling. Hosted refusals retain only a closed set of known codes and numeric retry timing, not raw messages.

The replacement key succeeded against the v3 usage, preview, and export endpoints. Recorded public-company fixture schemas in `tests/fixtures/lse/v3-*.json`; no key or key name is included.

Live provider checks:

- Annual statements: four complete annual income/balance/cash-flow sets returned and normalized.
- Daily candles: a four-session window returned with valid split adjustment and a matching checksum.
- Intraday candles: one trading day's 5-minute export returned 192 bars, including the extended session.
- Deep history: the sampled November 2016 window returned 12 daily bars. A full-range request returned rows starting in September 2003; the sampled January 2003 window has no data. The docs now describe per-symbol/date availability instead of promising uniform coverage back to 2003.
- Real TUI `get_financials`: succeeded, named London Strategic Edge, and reported annual years 2022–2025. Trace: `/tmp/oc-lse-v3-statements/trace.json`.
- Real TUI `compute_dcf`: succeeded using London Strategic Edge financial statements. Trace: `/tmp/oc-lse-v3-dcf/trace.json`.
- The onboarding account-access validation accepted the replacement key.

Failing-first evidence: `/tmp/lse-v3-red.log` (10 failures), `/tmp/lse-budget-red.log` (8 failures), `/tmp/lse-relay-red.log` (4 failures), `/tmp/lse-readiness-red.log`, `/tmp/lse-doctor-readiness-red.log`, and `/tmp/lse-hosted-red.log`. These runs exercised retired shapes, missing serialization, access-code classification, quota reset semantics, doctor readiness, and hosted routing before their implementation.

Focused provider/tool/GUI parity tests passed (68 tests); the latest quota/v3/tool subset passed (39 tests). Relay suite passed all 82 tests, including metadata preservation and sanitized refusal codes. Full gates and closeout autoreview results are still pending. The full gate has reported a timeout in the existing hosted-chat completed-result-bound test; this is not counted as a passing gate.

## Follow-up opportunities

Restore and verify the existing capabilities before expanding source ownership. Useful next candidates from the v3 catalogue are company profiles/fundamentals, dividends/splits, earnings calendars, and options chains. Each needs its own normalization, provenance/currency contract, fallback choice, fixtures, live checks, and proposal. Paid exchange/Level 3 feeds and redistribution rights remain outside this change. No extra subscription, deployment, or prompt/orchestration change was made.


Additional runtime proof: Settings → Diagnostics in the real local GUI showed both “London Strategic Edge — Configured via env” and “London Strategic Edge data access — LSE Data 3.0 accepted the key for financial-report access” as Pass. Browser screenshot: `/tmp/oc-lse-v3-diagnostics.png`. The container browser required `--args '--no-sandbox'` after its default sandbox launch failed.

Live hosted-transport proof ran the actual hosted fetch adapter through the actual relay handler and then to LSE's real API: both annual statements and a four-session adjusted-candle export succeeded, with checksum/adjustment headers preserved. Log: `/tmp/lse-live-relay.log`. This verifies the changed transport locally; no hosted deployment was performed.


First full-gate attempt (`/tmp/oc-lse-full-gates.log`): typechecks/lint passed; unit step finished with 5,100 passing tests and two failures, so later full-gate steps were not reached. The LSE shared-rate-limiter test still expected the obsolete 100-request burst; its expectation was migrated to v3's 60/minute pacing and all eight rate-limiter tests passed (`/tmp/lse-rate-limit-migration.log`). The other failure was the existing hosted-chat “bounds completed chat results” test exceeding Vitest's five-second timeout; one isolated diagnostic run passed (`/tmp/lse-unrelated-timeout-diagnostic.log`). Neither failure is hidden or treated as a green gate. Gate report: `validation-output/gates/2026-11-16T21-22-24-519Z-1956837.json`.

Closeout invoked `npm run review:pr -- --mode local`, which selects the skill's dirty-worktree review mode and runs `npm run gates:full` in parallel. Log: `/tmp/oc-lse-autoreview.log`. Results pending. React Doctor does not apply: no React UI file was changed.


A final cancellation regression test failed before a small fix: aborting an LSE retry could return stale cached candles as success. Both LSE cache-fallback paths now propagate a user abort instead. Added retry cancellation, stalled-stream cancellation (including a rejected cancel operation), and stale-cache-on-stop checks. Failing proof: `/tmp/lse-cancel-red.log`; all 110 focused provider/DCF/quota/rate-limit tests passed afterward (`/tmp/lse-stop-green.log`). The subsequent full-gate coverage run will exercise the completed test set.


Autoreview round 1 reported two P2 defects. Both were reproduced with failing tests and fixed: export `x-export-rows` now must be a valid safe integer matching the parsed record count, and timed quota refusals no longer invent byte usage or survive an earlier server reset. An expired refusal now forces a fresh server usage snapshot before a new export. Red proofs: `/tmp/lse-reset-red.log`, `/tmp/lse-review-red.log`; all 156 focused tests and 88 relay tests passed after the fixes.

The prior full gate passed all functional lanes (unit, relay, agent tools, site, GUI integration/journey/release smoke, hosted PWA, package contents). The coverage unit lane passed 5,108 tests, then the coverage ratchet failed. New validator and relay failure/privacy branches now have tests and exceed their old coverage ratios. The remaining denominator change is intentional: HTTP/CSV transport moved from `lse.ts` to `lse-transport.ts`. The baseline migration changes only those two per-file entries and the matching core file count/totals; no unrelated threshold was relaxed. The new lse.ts ratios are 100% lines/functions, 91.91% branches, and 96.72% statements, all at least their previous values. The new transport has its own baseline. A fresh full-gate rerun is required; no gate measurement artifact was edited to manufacture a pass.

Live additional checks succeeded for UK (`VOD.L`) and Canadian (`RY.TO`) daily history. Live daily, weekly, and monthly equity exports each had `x-export-rows` equal to their actual CSV record counts (`/tmp/lse-row-header-proof.log`).


Autoreview round 2 accepted the two initial fixes and the baseline ownership migration, but found a further cancellation defect between concurrent callers. Failing-first proof: `/tmp/lse-caller-red.log`. The transport now shares exports only within a common abort lifetime, serializes independent runs, and rejects a stopped queued caller immediately; fresh cache hits also honor Stop. Both cancellation directions are covered. Quota diagnostics now distinguish server-reported exhaustion from low local byte counts. All 160 focused tests passed after the fixes (`/tmp/lse-caller-green.log`).

The round-2 parallel gate was stopped as superseded once the new regression tests had demonstrated the remaining bug. Its failed/interrupt result is preserved (`/tmp/oc-lse-autoreview-round2.log`, gate report `validation-output/gates/2026-11-16T22-18-36-531Z-2003675.json`); it is not counted as passed. Final coverage baseline entries were recomputed from the final focused source measurements, still confined to the transport ownership move. A third/final model review and a fresh full gate are pending. No extra review-patch cycle will be started for unrelated findings.


Autoreview round 3 is clean: no findings, “patch is correct” (0.86 confidence). It explicitly confirmed cancellation isolation, the earlier row-count/quota fixes, and the scoped coverage-baseline migration. Report: `/tmp/lse-autoreview-round3.json`; command: `.agents/skills/autoreview/scripts/autoreview --mode local --model codex=gpt-6.1-sol --prompt-file /tmp/lse-autoreview-round3.md --json-output /tmp/lse-autoreview-round3.json --parallel-tests 'npm run gates:full'`. The final full gate remains pending and is not claimed as passed yet. React Doctor is not applicable because no React UI source changed.


## Pre-PR verification result

- `npm run check`: passed after the final source fixes (typechecks and lint; existing warnings retained).
- Final `npm run gates:full` via autoreview: unit 5,123/5,123, relay 88/88, agent tools 358/358, site 31/31, and GUI integration 29/29 passed. GUI journeys had 28 passes and one failure, so later gate steps were not reached on this candidate.
- The failing case is `GUI session journey > delivers a real tool result to the model and persists the answer across reload`, at `tests/e2e/gui-session-journey.test.ts:114`: the `$187.00` quote-card value passed `waitFor(visible)` and then returned false from `isVisible()`. The test exercises the unchanged Yahoo quote-card path, not LSE. One isolated diagnostic run passed (`/tmp/lse-final-gui-diagnostic.log`). No UI source/test was changed, and the full failure is not waived. Gate report: `validation-output/gates/2026-11-16T22-27-14-044Z-2010777.json`.
- After that block, ran the independent `npm run coverage:node`: all 5,123 unit and 88 relay tests passed on the finished source. `npm run coverage:check` then passed with no regressions. Logs: `/tmp/lse-final-node-coverage.log`, `/tmp/lse-final-coverage-check.log`. Browser coverage was not reached in the failed full gate; no browser-coverage pass is claimed.
- Final live TUI, after the independent-cancellation fix: `get_financials` succeeded and reported London Strategic Edge for fiscal years 2025, 2024, 2023, and 2022 (`/tmp/oc-lse-final-tui/trace.json`).
- Final live provider checks passed for statements and daily, weekly, and monthly candles (`/tmp/lse-live-final.log`). Earlier live intraday, deep-range, UK/Canadian, DCF, GUI Diagnostics, and hosted-adapter/relay checks remain recorded above.
- Final review: no findings; all three prior findings accepted and fixed, none rejected. React Doctor is not applicable because no React UI source changed. Final report: `/tmp/lse-autoreview-round3.json`.
- `git diff --check`: passed. Changes remain local and uncommitted; no PR, release, or hosted deployment was created.

Follow-up before release: fix or deterministically diagnose the separate GUI quote-card visibility failure, then pass the complete full gate, including browser coverage. Do not treat this handoff as permission to bypass the release gate.

## PR preparation — 2026-11-17

The quote-card journey inspected the automatically opened live drawer while the run was still updating. It now waits for the run to finish, closes the transient drawer with Escape, and opens the completed steps explicitly before checking the same card-only prices. Model tool-message and persisted reload assertions are retained. The closed-drawer reproduction failed before adding the explicit open (`/tmp/lse-pr-gui-closed-red.log`); the final focused journey passed (`/tmp/lse-pr-gui-green.log`). No GUI production source changed.

Public documentation links passed (39 links, `/tmp/lse-pr-doc-links.log`). The changed-file credential scan found no copy of the configured LSE key. Packed-install smoke also passed (`/tmp/lse-pr-packed-install.log`).

The first PR-preparation full gate passed every test lane: 5,123 unit, 88 relay, 358 agent-tool, 31 site, 29 GUI integration, 29 GUI journey, nine release smoke, hosted PWA smoke, package contents, Node/relay coverage ratchet, and all 58 browser coverage tests. Its final integrity check rejected the run because commits were made during execution; exit 1 is preserved and is not treated as a successful gate. Log: `/tmp/lse-pr-full-gates.log`; report: `validation-output/gates/2026-11-17T00-52-38-124Z-5735.json`. Final branch autoreview will run the complete gate on a clean, fixed commit.

The branch review on `e16ee71e` was clean in both batches (no findings, confidence 0.94; `/tmp/lse-pr-branch-review.json`). Additional live testing then found that the strict export-row equality check rejected a valid daily CSV: the header charged 11 input rows while the checksum-valid file returned ten records. The current [API reference](https://londonstrategicedge.com/api-documentation/#rows) defines `x-export-rows` as rows charged and explains that candle aggregation measures input bars, not output records. Earlier review advice and the limited historical sample had incorrectly treated the header as an output-record count.

Captured the authenticated response schema in `v3-candles-AAPL-metered.json`. Its regression test failed before the correction (`/tmp/lse-pr-charged-rows-red.log`); 104 focused provider/tool tests passed afterward (`/tmp/lse-pr-final-provider-coverage.log`). The transport validates that charged-row metadata is a nonnegative safe integer, while checksum, content-length, CSV structure, and financial/OHLCV checks continue to validate the file. The new transport baseline's branch vector changes from 129/144 to 128/143 because the incorrect equality branch was removed, with the same one-branch delta applied to core totals; unrelated entries remain unchanged.

The corrected live smoke returned four annual statements and five adjusted daily candles (`/tmp/lse-pr-live-fixed.log`). An initial ad hoc smoke omitted `loadEnv`; its corrected harness loaded the configured key before the real candle failure was diagnosed. Earlier failing attempts remain in `/tmp/lse-pr-live-smoke.log`, `/tmp/lse-pr-live-loaded-smoke.log`, and `/tmp/lse-pr-live-diagnostic.log`. The superseded branch gate was explicitly interrupted at release smoke (exit 130), not counted as a pass: `/tmp/lse-pr-branch-review.log`, report `validation-output/gates/2026-11-17T01-12-18-717Z-31700.json`.

Final branch autoreview of the charged-row correction is clean: both batches reported no findings, confidence 0.91 (`/tmp/lse-pr-final-review.json`). Its parallel gate stopped at a formatting-only error in the changed condition; Biome formatted the condition, and the 104 focused tests passed again with unchanged measured transport coverage (`/tmp/lse-pr-final-formatted-coverage.log`). Failure retained: `/tmp/lse-pr-final-review.log`, report `validation-output/gates/2026-11-17T01-22-26-009Z-45529.json`. A standalone final full gate will verify the formatting correction on a clean, fixed commit; another model review is unnecessary for the formatter-only change.

## Merge preparation result — 2026-11-17

`npm run gates:full` passed with exit 0 on clean, fixed commit `c77edbd3` in 1,164.9 seconds. Every lane passed: check, 5,124 unit tests, 88 relay tests, 358 agent-tool tests, 31 site tests, 29 GUI integration tests, 29 GUI journeys, nine GUI release-smoke tests, hosted PWA smoke, 534-file package contents, Node/relay coverage ratchet, and 58 browser coverage tests. Log: `/tmp/lse-pr-clean-gates.log`; gate report: `validation-output/gates/2026-11-17T01-24-35-357Z-46174.json`. No source or commits changed during this run.

Final branch autoreview is clean in both batches (`/tmp/lse-pr-final-review.json`); the subsequent change was formatter-only. React Doctor is inapplicable because no React production source changed. Packed-install smoke and 39 public documentation links also passed. A fresh live smoke of the corrected provider returned four annual statements and five adjusted daily candles. All 37 changed branch files were scanned and contained no copy of the configured LSE key. This final evidence update changes documentation only; GitHub CI will run against the PR head.
