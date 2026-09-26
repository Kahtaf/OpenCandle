# OpenCandle Test Trust Policy

- **Status:** implemented guidance. **Date:** 2026-09-24.
- **Owner:** repo maintainers (`CODEOWNERS`). **Related:** `tests/AGENTS.md`, `CONTRIBUTING.md`,
  `docs/internal/release-enforcement.md`, `docs/internal/test-inventory.md`,
  `docs/internal/test-trust-implementation-2026-09-24.md`.

## 1. Gate source of truth

The proof battery is `scripts/test-gate-policy.json`, run by `scripts/test-gate.mjs`:

- `npm run gates` → `core`
- `npm run gates:full` → `full`
- `npm run release:check` → `release`

Steps run sequentially through `npm run <script>` with `shell: false`; there is no retry, no policy
override, and the first non-zero status or signal stops the gate. Run
`node scripts/test-gate.mjs --list [gate]` for the resolved list; do not copy step lists into prose.
Each run writes one bounded report to `validation-output/gates/` (gate, candidateCommit,
headBefore/After/Changed, policyDigest, per-step status/signal/duration, failedStep); a HEAD move fails it.

**Local browser prerequisite.** The `tests/agent-tools/coverage-browser` fixture launches real
Chromium and the GUI integration/journey/release-smoke lanes drive one. Install it once before gate
commands with `npx playwright-core install chromium` (Linux adds `--with-deps`).
`npm run bootstrap:agent` does **not** install a browser; CI's canonical Node 24 job does.

## 2. Test contract

Every test that is added, retained, or used as evidence has: a **named user contract**, a
**credible defect** it detects today, the **correct boundary**, and an **independent expectation**
not produced by the code or mock under test.

## 3. Boundary selection and authoring

- Prefer **real boundaries**: deterministic e2e/integration journeys for application wiring across
  process, HTTP/SSE/WS, storage, or UI, with external model/provider traffic stubbed at the transport
  unless the check is explicitly credentialed.
- Keep **useful unit tests** where they are the right tool: financial/mathematical contracts,
  security and authorization decisions, parser/grammar edges, and failure combinatorics.
- **Do not add unit tests only to move a coverage metric.** Coverage is a diagnostic, not a target;
  a new assertion must still name a contract and a credible defect.
- Live-model quality belongs behind `npm run eval -- <suite>`, never in the unit suite.

## 4. Coverage: per-lane ratchet, no cross-map ratio

- **Hard ratchet (Node + relay):** `npm run test:coverage` measures the in-process unit lane and the
  relay workspace lane, merges their raw Istanbul maps (`scripts/coverage-merge.mjs`), and checks
  `scripts/coverage-report.mjs --check` against `scripts/coverage-baseline.json`. The ratchet is
  **per-file and per-surface across all metrics** (lines, functions, branches, statements); it fails
  on a shrinking denominator, any ratio loss, or a surface becoming unmeasured. Baseline updates are
  explicit and reviewed (`npm run coverage:baseline`).
- Surfaces: `core`, `gui-server`, `gui-shared`, `gui-web`, `gui-hosted`, `ui-package`,
  `provider-relay`. Measurable files are enumerated from disk; generated declarations/source, build
  output, `node_modules`, test files, and tooling configs are excluded with reasons.
  Difficult-but-real code is never excluded.
- **Browser lane (mandatory in `test:coverage`):** `npm run coverage:browser` builds the GUI once
  with source maps and runs both `gui-integration` and `gui-journey` against those same built assets
  with `OPENCANDLE_BROWSER_COVERAGE=1`, then remaps with `scripts/coverage-browser.mjs`; it is
  actually measured under `coverage/browser/`. Relay is also actually measured.
- **Browser and combined coverage are reported separately.** The combined raw map (under
  `coverage/merged/`) sums hits by source location; browser ratios are **informational only** and are
  not ratio-compared with the Node+relay baseline, because V8→Istanbul maps differ across lanes
  (the browser lane adds a small, variable set: about **5 lines / 7 branches**).
- **Measured vs unavailable:** Node in-process, relay, and browser are measured; **Node
  child-process and hosted-WebContainer execution are unavailable** to the in-process run and are
  named as limits, never reported as zero.
- There is **no arbitrary overall coverage percentage target**.

## 5. Failures, reruns, diagnostics

- Gate steps fail closed; infrastructure failures stay red.
- **One diagnostic rerun, by a human, only to separate infrastructure failure from functional
  failure.** Preserve every attempt. Never retry until green; a rerun that passes is not a fix.
- **A failure is a work item, not a report.** Diagnose the cause, reproduce it as a credible
  regression red at the declared boundary, fix the actual cause at the narrowest durable layer, and
  verify with a focused run before handoff. Classify first: product defect, inaccurate assertion, or
  harness/environment issue. Never weaken, delete, or bypass a required check, overfit prompts to a
  benchmark, or suppress failed evidence.
- `scripts/release-evidence.mjs` rejects any recorded attempt with a non-zero exit, so a release
  cannot be attested from a retry.
- **Every release failure blocks; there is no emergency waiver.** The approved plan originally
  proposed an explicit emergency waiver, but the maintainer's explicit decision (2026-09-25)
  supersedes it: no skip flag, policy override, CI input, or waiver turns a required failure green,
  and none should be built. Missing required credentials/cases/checkers or a scope contradiction is
  diagnosed and escalated to the orchestrator with preserved progress, never waived or replaced with
  mocks.

## 6. Quarantine (editorial rule, not a registry)

A required check must never be silently skipped, short-circuited, or weakened. Any quarantine needs
a written record with **owner, issue, expiry, lost contract, alternative proof**. This is an
editorial rule only: there is no automated quarantine registry, marker, or bypass, and none should
be implied.

## 7. Release evidence

**Deterministic `release:check`** is the `release` gate (steps in `scripts/test-gate-policy.json`);
no secrets and no live eval.

**Local release (`node scripts/release.mjs <major|minor|patch>`)** runs this exact order:

1. Preflight: clean tree, branch `main`, fetch `origin/main`, HEAD equals `origin/main`, tag unused.
2. Prepare: bump the version, mark the changelog released, and commit the candidate (`Release vX`)
   with **no tag or push**. Final metadata is committed unnormalized so proof runs on the exact
   commit that will be tagged.
3. `release:check` on that candidate.
4. `node scripts/release-package.mjs prepare --out validation-output/release-package` once (exact
   tarball plus `package-proof.json`).
5. `npm run test:providers:release`: the live provider release smoke, on the same candidate, strict.
6. `npm run eval -- release`: fresh live release evals, the last meaningful proof (no expensive
   build runs after them). Required suites: `router-live`, `cases`, `product`,
   `competitive:frozen`.
7. Finalize only if every proof returned zero, the tree is clean, and HEAD is unchanged: create the
   tag, commit the changelog reset, push `main`, then push the tag.

`--resume` re-verifies the candidate (message, version, parent version, changelog, changed files) and
reruns every proof; it cannot bypass the gate. `--dry-run` prints the plan without mutating anything
or running credentialed commands. `--skip-eval-confirm` is **rejected**; there is no eval-confirmation
prompt.

**Trusted publish (`.github/workflows/publish.yml`).** Tag-only (`v*`), global `contents: read`,
with `contents: write` + `id-token: write` scoped to `publish`. It declares `environment: release`;
**required-reviewer protection is a repository setting verified externally**, not by the workflow. It
checks out the tag (`fetch-depth: 0`), verifies tag/version and that the commit is reachable from
`origin/main`, runs `release:check` without secrets, prepares the package once, runs the provider
smoke with provider-data secrets, then fresh `npm run eval -- release` with model/provider secrets
scoped to that step. Evidence is uploaded `if: always()`; the proof is re-verified and the exact
tarball published with `npm publish <tarball> --ignore-scripts --access public --provenance`. The
GitHub release follows a successful publish.

**Candidate identity.** `scripts/release-evidence.mjs` validates content against
`{commit, sourceDigest, lockDigest, policyDigest}` on a clean tree; required suites must pass, evidence
must be inside the freshness window (default 24h), and any failed attempt invalidates the record. No
artifact or external-run-id is accepted as provenance.

## 8. Eval tiers

Only the four required release suites are release proof. `known-fail` E1/E2 and other opt-in or
usually-tier cases are **optional and are not release proof**; never present them as live evidence.
Missing credentials are reported, never replaced with mocks.

## 9. Test-audit usage

Use the `test-audit` skill for value/coverage/duplication audits and bounded cleanup: evidence
first, case-family granularity, full reads not samples, replacements proven before deletion, and
never weaken a required check. The written ledger is the deliverable; the parent owns dispositions.
See `docs/internal/test-audit-core-ledger.md`.

## 10. Truthful limits

- Browser and combined raw coverage are reported separately (browser ratios informational), not
  ratio-compared with the Node+relay baseline; branch semantics differ across V8 instrumentation.
- Chromium is a local prerequisite for the agent-tools coverage-browser fixture and GUI lanes;
  `bootstrap:agent` does not install it. CI's canonical Node 24 job installs Chromium.
- Node child-process and WebContainer coverage are unavailable to the in-process run.
- Required-reviewer protection is external and must be confirmed in repository settings.
- Nothing here claims the integrated `gates:full` or a live `npm run eval -- release` has passed.
