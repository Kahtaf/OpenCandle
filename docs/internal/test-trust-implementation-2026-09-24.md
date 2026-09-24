# Test trust implementation — 2026-09-24

Status: implementation record on the integrated tree, uncommitted. This is not a release
attestation and does not claim the full gate has run.

## Final measured state

- Pre-effort baseline (root audit): **350 files / 3741 passed + 1 skipped**.
- Integrated Node run: **363 files / 3913 passed / 0 skipped** plus relay **76**.
- Gated Node+relay coverage baseline integrated; ROOT `coverage:check` **passed** with final
  branches **15175/22745** (clock fix) — `/tmp/oc-final-baseline-check.log`.
- Browser lanes: **35 passed** — **27 GUI integration** cases (collected under
  `OPENCANDLE_GUI_INTEGRATION=1`; a stale flag name had produced a false zero) plus **8
  deterministic real-server journeys**, over 170 mapped production files. The merge is
  **informational only**, retains Node hit counts, and is not gated.
- Child-process and WebContainer lanes remain unmeasured.
- Counts move as parallel workers land; the parent owns the final integrated counts.

## What changed

### Inventory and coverage
- Runtime `npx vitest list … --staticParse=false` collection is the counting source of truth; static
  parsing undercounts dynamic/`for`-loop/`it.each` cases.
- `docs/internal/test-inventory.md` documents the route registry and machine-only fields (not human
  approval). `scripts/test-gate-policy.json` is shared and checked in; the inventory reads it and
  records its digest.
- `npm run test:coverage` measures per-surface line/function/branch coverage and fails on a measured
  regression; `scripts/coverage-report.mjs` names unmeasured surfaces; `scripts/coverage-merge.mjs`
  folds lanes by raw hit counts (no percentage averaging). Built-browser coverage is a standalone,
  opt-in lane that never shrinks the Node/relay denominator.

### Deterministic journeys
- `tests/unit/harness/deterministic-session-journey.test.ts` drives the real session stack offline.
- The deterministic GUI integration lane now collects its real 27 cases. The 8-case real-server GUI
  journey suite passes in normal and shuffled order and covers early-Stop durability, passive
  navigation, native-stream Stop, and held-tool Stop. The deterministic TUI journey and the hosted
  keyless smoke pass with `livePi=SKIP`.

### Fault and eval-harness rejection proof
- 8/8 critical mutations killed, 0 survived (`docs/internal/test-fault-proof-2026-09-24.md`).
- Scorer/eval-harness rejection contracts are proven by bounded tests:
  - `tests/unit/evals/release-eval-evidence.test.ts` — canonical release env, child crash/signal,
    timeout, zero-exit with no completion report, first missing report blocked and preserved across a
    green rerun, stale-report window, candidate fingerprint change mid-run, partial case selection,
    malformed competitor metadata, and honest failure without credentials.
  - `tests/unit/evals/competitive-metadata.test.ts` — bounded id/reason round-trip, strict malformed
    rejection, bounded reasons, cache selection.
  - `tests/agent-tools/live-canary-results.test.ts` — nonzero core pass required, core skips block,
    no all-passed claim with skips, strict-mode parsing, unique summaries, credential redaction,
    provider payload/history validation, and injected-runner integration.
  - `tests/agent-tools/release-summary.test.ts` — 29 tests for exact candidate match, blocking any
    failed/incomplete same-candidate attempt, latest-success freshness with preserved history, and
    descriptive output. These are release-evidence checks, not authorization tests.

### Release gate
- One checked-in policy drives `gates`/`gates:full`/`release:check` through `scripts/test-gate.mjs`
  (sequential, `shell:false`, no retry, one bounded report). Candidate identity
  `{commit, sourceDigest, lockDigest, policyDigest}` plus required-suite evidence is validated by
  `scripts/release-evidence.mjs`; stale, mismatched, skipped, or retry-after-failure evidence is
  rejected. `scripts/release-package.mjs` proves the published tarball.
- The compact release summary is a new fail-closed feature (CHANGELOG **Added**), covered by the 29
  tests above. The proposed evidence **waiver was NOT implemented**; strict blocking is the recorded
  deviation.
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
| `tests/unit/routing/defaults.test.ts` (core cleanup) | 9 | The 9 constant-only `PORTFOLIO_DEFAULTS` / `OPTIONS_SCREENER_DEFAULTS` literals were consolidated onto the real `resolvePortfolioSlots` / `resolveOptionsScreenerSlots` path; all 9 literals are still asserted, with four independent mutants killed. |
| **Total intentional unit-case removals** | **18** | Original audit-ledger-sanctioned subset is 9; the routing-default consolidation adds 9. |

In addition, **1 synthetic skipped placeholder** (`it.skip("KNOWN-FAIL … opencandle-turn-gap")` in
`tests/unit/evals/provider-outage-deterministic.test.ts`) was removed, which is why the latest Node
run reports 0 skipped.

The net effect is bounded low-value cleanup plus new proof, not bulk removal: the removals are
constant restatements or source-text tautologies replaced by real-caller and behavior tests.

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
| Root audit baseline | root `docs/internal/test-coverage-audit-2026-09-24.md` |
| Integrated core gate | `/tmp/oc-integrated-gates4.log` |
| Latest Node + relay measurement | `/tmp/oc-final-coverage-node.log` |
| Integrated baseline `--check` | `/tmp/oc-final-baseline-check.log` |
| Browser lanes (integration + journeys) | `/tmp/oc-close-browser-coverage.log` |
| GUI journeys, normal + shuffled | `/tmp/oc-journey-final3-normal.log`, `/tmp/oc-journey-final3-shuffled.log` |
| Harness lifecycle | `/tmp/oc-close-harness-lifecycle-test.log` |
| Hosted deterministic smoke | `/tmp/oc-hosted-integrated-smoke.log` |
| Provider release smoke | `/tmp/oc-provider-live-smoke.log` |
| Agent-tool helpers | `/tmp/oc-agent-tools-integrated3.log` |
| Fault proof | `docs/internal/test-fault-proof-2026-09-24.md` |
| Audit ledgers | `docs/internal/test-audit-*-ledger.md` |
| Release enforcement | `docs/internal/release-enforcement.md` |

## Pending / limitations (not yet proven)

- **Integrated `gates:full`, autoreview, `release:check`, and a live `npm run eval -- release` are not
  complete.** The full gate was still running (`/tmp/oc-final-gates-full.log`) at closeout.
- **Cancellation is fixed.** Root real-browser journeys exercise the actual HTTP route, and
  `run-cancel-route.test.ts` provides the route-level integration test.
- **Release-environment protection is unverified.** GitHub returned 404 for the required-reviewer
  environment read, so it is **not proven absent**; check repository settings.
- **WebContainer and Node child-process lanes are unmeasured** by the in-process coverage run.
- **Hosted infrastructure has network dependence:** the hosted lane needs real access to
  `stackblitz.com`, `*.staticblitz.com`, and `*.webcontainer-api.io`; its deterministic smoke passes
  but the live model and relay stages were **SKIP** (no credentials).

## Review boundary

- The four case-family ledgers are worker evidence at their stated boundaries; the GUI ledger makes
  no deletion claims. Human review status for individual case dispositions must be confirmed by the
  parent before further cleanup.
- This document is documentation only. No production code, tests, CI, or package files were changed
  by this consolidation.
