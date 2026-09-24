# Test trust implementation — 2026-09-24

Status: implementation record on the integrated tree, uncommitted. Recorded milestones, not live
state. This is not a release attestation and does not claim the final review or the live release
rehearsal has run.

## Recorded milestones

- Root full gate: **PASS**, passed three times (`/tmp/oc-final-gates-full.log`, 263.2 s; latest
  `/tmp/oc-final-autoreview2.log`, 272.8 s).
- Advisory reviews: first `/tmp/oc-final-autoreview.log` (270 s) with 5 findings; second raised 2
  findings, both fixed. Review is **not claimed clean**; the final review runs after `release:check`.
- ReactDoctor second review: **PASS**, 0 errors / 0 warnings, 6 changed files
  (`/tmp/oc-react-doctor-direct.json`).
- Gated Node+relay coverage baseline integrated; `coverage:check` **passed** with final branches
  **15175/22745** (clock fix) — `/tmp/oc-final-baseline-check.log`. Root candidate coverage is
  recorded at `/tmp/oc-candidate-coverage-node.log` (result not yet recorded).
- Browser lanes: **35 passed** — **27 GUI integration** cases (collected under
  `OPENCANDLE_GUI_INTEGRATION=1`) plus **8 deterministic real-server journeys**. Merge is
  informational and retains Node hit counts.
- Inventory recorded milestone: **4373 cases / 390 files / 27 integration / 8 journeys / unit 3913 /
  agent-tools 279** (`/tmp/oc-final-inventory2.log`), not asserted current.
- Authoritative final result path: `validation-output/release-summary`.

## What changed

### Inventory and coverage
- Runtime `npx vitest list … --staticParse=false` collection is the counting source of truth; static
  parsing undercounts dynamic/`for`-loop/`it.each` cases.
- `docs/internal/test-inventory.md` documents the route registry and machine-only fields.
  `scripts/test-gate-policy.json` is shared and checked in; the inventory reads it and records its
  digest.
- `npm run test:coverage` measures per-surface line/function/branch coverage and fails on a measured
  regression; `scripts/coverage-report.mjs` names unmeasured surfaces; `scripts/coverage-merge.mjs`
  folds lanes by raw hit counts. Built-browser coverage is a standalone, opt-in lane that never
  shrinks the Node/relay denominator.

### Deterministic journeys and cancellation
- `tests/unit/harness/deterministic-session-journey.test.ts` drives the real session stack offline.
- The deterministic GUI integration lane collects its real 27 cases; the 8-case real-server journey
  suite passes in normal and shuffled order and covers early-Stop durability, passive navigation,
  native-stream Stop, and held-tool Stop.
- The attachment cancel-replay leak is fixed: cancelling a run with a staged attachment no longer
  carries that attachment into the next turn (25 adapter tests + the 8 journeys).
- The second-review admission fix is in: the local session coordinator rejects distinct chat/tool
  admissions while a run is active, so a second chat cannot queue a prompt that would run after Stop,
  while same-action dedupe and the Stop/ask-user bypass are preserved (11 coordinator tests + 8 real
  journeys, 35 s — `/tmp/oc-review-admission.md`).

### Fault and eval-harness rejection proof
- 8/8 critical mutations killed, 0 survived (`docs/internal/test-fault-proof-2026-09-24.md`).
- The hold-counter race is fixed and the unit placeholder is isolated from ambient flags with an
  actual child-process proof; the CLI freshness fixture now uses a relative clock without adding
  helper tests.
- Scorer/eval-harness rejection contracts are proven by bounded tests:
  `tests/unit/evals/release-eval-evidence.test.ts`,
  `tests/unit/evals/competitive-metadata.test.ts`, `tests/agent-tools/live-canary-results.test.ts`,
  and `tests/agent-tools/release-summary.test.ts` (29 tests; release-evidence checks, not
  authorization).

### Release gate
- One checked-in policy drives `gates`/`gates:full`/`release:check` through `scripts/test-gate.mjs`
  (sequential, `shell:false`, no retry, one bounded report). Candidate identity
  `{commit, sourceDigest, lockDigest, policyDigest}` plus required-suite evidence is validated by
  `scripts/release-evidence.mjs`; stale, mismatched, skipped, or retry-after-failure evidence is
  rejected. `scripts/release-package.mjs` proves the published tarball.
- Release checks now run through a portable JavaScript entry point rather than a platform shell
  command; the Windows `npm.cmd` path is complete, including the native-dep repair and the local
  release runner, and the release-lib real-default npm runner goes through the safe helper (5
  focused tests, 50 with readiness).
- The compact release summary is a new fail-closed feature. The proposed evidence **waiver was NOT
  implemented**; strict blocking is the recorded deviation.
- Operational summary: `docs/internal/release-enforcement.md`.

### Policy and authoring guidance
- `docs/internal/test-trust-policy.md` is the implemented guidance; `tests/AGENTS.md`/`CONTRIBUTING.md`
  match.

## Accepted deletions (exact)

| Source | Cases | Detail |
| --- | ---: | --- |
| `tests/unit/types/web-search.test.ts` (tools ledger) | 4 | File deleted: object-literal assertions that only restated just-assigned fields; tests are not typechecked, so they could not fail. |
| `tests/unit/runtime/workflow-types.test.ts` (core ledger) | 1 | `createWorkflowRun > assigns unique run IDs` tautology removed; real `generateRunId` coverage retained in `workflow-runner.test.ts`. |
| `tests/unit/pi/opencandle-extension-router.test.ts` (rest ledger) | 1 | Stub-`RouterLlmClient` case removed; retained cases 1–2 own the production prompt-context paths. |
| `tests/unit/gui-web/session-drawer-focus.test.ts` (browser lane) | 1 | Source-substring-only file removed; replaced by a real focus-in/focus-return browser assertion. |
| `tests/unit/gui-web/transcript-scroller.test.ts` (browser lane) | 1 | Third source/CSS case removed; replaced by a real floating-hit-target browser assertion; two anchor cases kept. |
| `tests/unit/scripts/release-readiness.test.ts` (enforcement lane) | 1 | Weak source-text case removed; the mocked integration suite owns that detection. |
| `tests/unit/routing/defaults.test.ts` (core cleanup) | 9 | The 9 constant-only `PORTFOLIO_DEFAULTS` / `OPTIONS_SCREENER_DEFAULTS` literals were consolidated onto the real resolver path; all 9 literals are still asserted, with four independent mutants killed. |
| **Total intentional unit-case removals** | **18** | Original audit-ledger-sanctioned subset is 9; the routing-default consolidation adds 9. |

In addition, **1 synthetic skipped placeholder** (`it.skip("KNOWN-FAIL … opencandle-turn-gap")` in
`tests/unit/evals/provider-outage-deterministic.test.ts`) was removed. The net effect is bounded
low-value cleanup plus new proof, not bulk removal.

`tests/unit/tools/dcf.test.ts` was a **like-for-like replacement, not a deletion** (34 → 34 cases;
16 tool-behavior cases moved from mocked internals to the real providers/`wrapProvider`/`cache`/
`rateLimiter` over fixture HTTP).

## Retained value

- **Financial mathematics:** DCF (mid-year convention, terminal spread, signed net cash), option
  per-share vs standard-contract units, freshness windows.
- **Security/authorization:** GUI loopback authorization, coordinator/session-target rejection,
  provider-relay allowlist and credential non-reflection, model-key probe SSRF guard, duplicate
  action-fingerprint rejection, leading-only soft-degradation tag parsing.
- **Storage/persistence:** SQLite preference upsert semantics, all-or-nothing migrations, writer
  locks, action-sidecar fail-closed behavior, durable cancelled-run persistence.

## Proof index

| Proof | Link |
| --- | --- |
| Root full gate | `/tmp/oc-final-gates-full.log` |
| Advisory reviews | `/tmp/oc-final-autoreview.log`, `/tmp/oc-final-autoreview2.log` |
| Admission-fix worker | `/tmp/oc-review-admission.md` |
| Candidate Node coverage | `/tmp/oc-candidate-coverage-node.log` |
| Integrated baseline `--check` | `/tmp/oc-final-baseline-check.log` |
| Browser lanes (integration + journeys) | `/tmp/oc-close-browser-coverage.log` |
| GUI journeys, normal + shuffled | `/tmp/oc-journey-final3-normal.log`, `/tmp/oc-journey-final3-shuffled.log` |
| Harness lifecycle | `/tmp/oc-close-harness-lifecycle-test.log` |
| Hosted deterministic smoke | `/tmp/oc-hosted-integrated-smoke.log` |
| Provider release smoke | `/tmp/oc-provider-live-smoke.log` |
| ReactDoctor | `/tmp/oc-react-doctor-direct.json` |
| Inventory milestone | `/tmp/oc-final-inventory2.log` |
| Fault proof | `docs/internal/test-fault-proof-2026-09-24.md` |
| Audit ledgers | `docs/internal/test-audit-*-ledger.md` |
| Release enforcement | `docs/internal/release-enforcement.md` |

## Review findings and pending

- First advisory review: **11 batches / 5 confirmed findings** — attachment cancel-replay leak,
  hold-counter race, unit placeholder ambient-flag isolation, CLI freshness relative clock, and the
  Windows `shell:false`/`npm.cmd` helper plus same-gate consumers. All fixed; the Windows path is
  complete including native-dep repair and the local release runner.
- Second advisory review: **2 confirmed findings**, both fixed — the release-lib real-default npm
  runner now goes through the safe helper (5 focused tests, 50 with readiness), and the local session
  coordinator rejects distinct chat/tool admissions while active while preserving same-action dedupe
  and the Stop/ask-user bypass (11 coordinator tests + 8 journeys, 35 s).
- The **Stop-line critical release blocker** required this second review patch cycle and is resolved;
  no further broad search is planned.
- Candidate `release:check` and live `eval -- release` rehearsal are pending; the final review runs
  after `release:check` without a redundant full gate. The authoritative final result is
  `validation-output/release-summary`. **Live and review-clean are not claimed prematurely.**
- Release-environment required-reviewer protection remains unverified (GitHub 404).
- WebContainer and Node child-process lanes are unmeasured; the hosted lane has network dependence
  and its live stages were SKIP (no credentials).

## Review boundary

- The four case-family ledgers are **agent case-family review, not human approval**; the GUI ledger
  makes no deletion claims. Human disposition still requires the parent.
- This document is documentation only. No production code, tests, CI, or package files were changed
  by this consolidation.
