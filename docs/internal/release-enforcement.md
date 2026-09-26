# Release gate and publication enforcement

Last updated: 2026-09-24

## Shared gate policy

`scripts/test-gate-policy.json` is the single source of truth for the proof
battery. `scripts/test-gate.mjs` runs the steps sequentially through
`npm run <script>` with `shell: false`, stops on the first non-zero status or
terminating signal, and never retries.

- `npm run gates` → `core`
- `npm run gates:full` → `full` (core + site, GUI integration, GUI journey, GUI
  release smoke, hosted PWA smoke, package contents, coverage)
- `npm run release:check` → `release` (full + packed-install smoke and public
  docs link checks)

`node scripts/test-gate.mjs --list [gate]` prints the resolved policy as JSON.
The CLI always uses the checked-in `scripts/test-gate-policy.json`; there is no
environment or argument override, so an ambient variable cannot point the gate
at a different policy.

Each CLI run also writes one bounded command-level report to
`validation-output/gates/<timestamp>-<pid>.json` (unique, never overwritten,
written before a failed run exits or re-raises). It records `schemaVersion`,
`gate`, `candidateCommit`, `headBefore`/`headAfter`/`headChanged`,
`insideWorkTree`, Node and platform, start/finish timestamps, a SHA-256
`policyDigest` of the policy file, per-step status/signal/duration, `failedStep`,
and overall passed/failed. If HEAD changes while the gate runs, the report is
marked failed and the CLI exits non-zero even when every step passed. A HEAD
that is missing inside a git work tree is also a clear failure. The report holds
no environment values and no raw logs. This is command-level evidence (which
commands ran and how they exited, not per-case counts); a root release summary
can join it by `candidateCommit`. CI and publish upload these reports alongside
`coverage/coverage-summary.json`.

CI runs the full gate once on Node 24, and additionally keeps the external
public-docs link check (`npm run docs:links:check`) as an explicit Node 24 step
because the shared `full` policy does not include it. The packed-install smoke
and packaged CLI-boot proof run on every supported runtime.

## Local release

`node scripts/release.mjs <major|minor|patch> [--dry-run]`
`node scripts/release.mjs --resume [--dry-run]`

The release script:

1. Refuses to run unless the tree is clean and `main` is current with
   `origin/main`, and the tag is unused.
2. Bumps the version, marks the changelog, and commits the candidate **without
   tagging or pushing**. Final version metadata is committed as-is; it is never
   normalized, because fresh behavioral evals must run against the exact final
   version commit that will be tagged.
3. Runs, against that unchanged committed candidate, in this order:
   `release:check`, `node scripts/release-package.mjs prepare --out validation-output/release-package`,
   then `npm run test:providers:release` (live provider smoke), then fresh
   `npm run eval -- release`, then `node scripts/release-summary.mjs --package-dir validation-output/release-package`.
   Fresh evals are the last executable proof; the summary only aggregates the
   evidence they produced. The live provider smoke is intentionally outside the
   deterministic gate policy and is enforced only by the trusted local release
   and publish paths.
4. Only if every proof returns zero, the tree is still clean, and HEAD has not
   moved: creates the tag, commits the changelog reset, and pushes main + tag.

A failed proof leaves the candidate commit in place and performs no automatic
rollback or force-push. The recovery output reports the accurate completed
state (candidate commit, version bump, local tag, changelog reset, main pushed,
tag pushed), gives inspect-only git commands, and only suggests a concrete
manual undo when that is safe (for example removing a local tag that was never
pushed). A thrown step is reported with its real stage and side effects.

`--resume` re-verifies the existing release commit (message, version, parent
version via semver, changelog, and that only `package.json`, `package-lock.json`,
and `CHANGELOG.md` changed) and then reruns every proof before tagging. It
cannot bypass the gate.

`--dry-run` validates arguments and prints the plan without mutating anything or
running any command that uses credentials.

There is **no** eval-confirmation prompt and no `--skip-eval-confirm` bypass.

## Compact release summary

`node scripts/release-summary.mjs [--package-dir validation-output/<dir>]`
(defaults to `validation-output/release`) reads the current clean candidate
fingerprint and joins the exact-candidate evidence already on disk: the latest
clean `release` gate report, the latest clean provider release summary, the
latest clean release-eval summary plus its evidence, and the exact package
proof. It never accepts a path outside `validation-output/`, and it verifies the
package proof with the existing release-package helper before aggregating. It
never accepts evidence for another candidate, and it is not a waiver path.

Validation is strict and fail-closed:

- **Gate.** Only reports with `gate: "release"` count, so a later `core`/`full`
  diagnostic pass for the same commit cannot substitute for release proof. The
  report must match the current checked-in `scripts/test-gate-policy.json`
  SHA-256 digest, list exactly the policy's ordered release steps, show every
  step at status 0 with no signal, and record `headBefore`/`headAfter` equal to
  the current candidate with `headChanged: false`. A `passed` overall with a
  non-zero step is rejected.
- **Provider smoke.** Only the strict core shape the smoke actually produces is
  accepted: `scope: "core"`, `symbol: "AAPL"`, `strict: true`,
  `timedOut: false`, `fatal: false`, totals of 2 passed / 0 failed / 0 skipped,
  and the two required cases `get_stock_quote:AAPL` and
  `get_stock_history:AAPL` each present once and passed.
- **Release evals.** Candidate-scoped evidence lives in
  `validation-output/release-evals/v2/<full-commit>/<run-id>/`. The producer
  persists an atomic startup manifest carrying the full candidate fingerprint
  before collecting expected cases or spawning any suite, journals every attempt
  with its run/candidate identity, and fails fast after the first required suite
  failure (later suites are recorded as not run, never passed). The collector
  reads only the current candidate's commit directory and requires every run
  there to have a matching startup identity and a complete final summary and
  evidence; a missing, malformed, interrupted, or identity-mismatched run blocks
  even when a later run passed, and other candidates' v2 interruptions are
  invisible. Evidence must carry the exact four-field candidate fingerprint, the
  exact four required suites, a non-empty list of unique all-passed required
  cases per suite, and a non-empty attempt list whose attempts all exited zero.
  Canonical case-set authority stays in the eval front door; the summary only
  checks the shape it can verify without inventing expected ids.
- **Metadata.** Suite settings are whitelisted to the keys the validated
  completion report actually emits (`provider`, `model`, `mode`, `seed`,
  `tier`) and competitor metadata is limited to `{ id, reason }`; unknown fields,
  oversized values, and over-long arrays are rejected rather than copied or
  truncated.

Failed, missing, mismatched, invalid, or future-dated items are rejected. The
24-hour age window applies only to the latest selected successful gate, provider,
and eval run (for evals, every attempt inside that run's evidence); an expired
success is refreshed by a newer successful run while the older attempts remain
in the preserved history. Past failures and incomplete runs always block.
For a candidate with several locally available attempts, **any failed attempt
blocks** a complete summary even when a later retry passed — there is no
retry-until-green, and every attempt count/outcome is still shown in the
Markdown for a passing candidate. A changed candidate requires fresh proof and
clears the prior evidence because the fingerprint changed; separate CI runs
whose artifacts are not on this machine remain an explicit limitation.
Pre-cutover unscoped `validation-output/release-evals/<run-id>/` directories are
retained untouched and reported as historical history ineligible for current
proof, so a legacy success never satisfies a release and fresh v2 proof is
always required. A legacy record provably attributed to the current candidate
that failed still blocks, so the format cutover is not an escape hatch;
malformed legacy records are reported as unavailable history rather than
blocking. Unreadable JSON under a required gate or provider evidence directory
is still a conservative reject, because it could have been a matching report
whose outcome would change the verdict.

On success it writes exactly one
`validation-output/release-summary/<timestamp>-<pid>/summary.json` plus a
human-readable `summary.md` (unique, never overwritten). The JSON is a bounded
whitelist: candidate fingerprint, package name/version/sha/tarball/path,
deterministic gate step names/statuses/durations, gate-derived coverage surface
counts when present, eval suite completion counts/model settings/optional skips/
competitor-known flag plus the bounded competitor `{ id, reason }` list, provider
pass/fail/skip totals, per-section attempt counts/outcomes, explicit
child-process/WebContainer “unmeasured” markers, and release-environment
protection marked externally unverified. It excludes raw logs, traces,
environment values, financial numbers, and credentials, and records no waiver.

The summary is **descriptive only, not release authorization**: the trusted
same-job executions remain the authority. The local release runs it after the
fresh evals and before the tag; the publish workflow runs it after the fresh
evals and before upload/publish, and uploads the bounded summary directory.

## Publish workflow

`.github/workflows/publish.yml` triggers only on `v*` tags, has read-only global
permissions, and grants `contents: write` + `id-token: write` only to the
`publish` job. It declares `environment: release`; repository settings must
create the required-reviewer protection (the workflow cannot create or verify
it).

The workflow checks out the tag with `fetch-depth: 0`, verifies the tag matches
the package version and that the tagged commit is reachable from `origin/main`,
runs `release:check` without secrets, prepares the exact release package once,
runs the live provider release smoke on that same candidate, then runs fresh
live release evals, then writes the compact release summary, so evals are the
last executable proof before publication. Provider data secrets are scoped to
the provider-smoke step; model/provider secrets are scoped to the eval step.

It always uploads bounded release evidence
(`validation-output/release-evals/**/release-eval-startup.json`,
`release-evidence.json`, `release-eval-summary.json`,
`release-eval-incomplete.json`, `attempts.jsonl`,
`release-package/package-proof.json`, the exact tested tarball,
`validation-output/provider-release/**/summary.json`, the gate reports,
`validation-output/release-summary/**/summary.json` + `summary.md`, and
`coverage/coverage-summary.json`); raw `.completion.json` and Vitest reporter
traces are never uploaded. The upload is `if: always()` with
`if-no-files-found: warn` so failure evidence is preserved without masking the
original failure.

The publish step then runs the release-package `verify --dir` and, in the same
shell step, reads the validated `package-proof.json`, rechecks the tarball
basename, hash, candidate commit, and version, and publishes that exact tarball
with `--ignore-scripts --access public --provenance`. The GitHub release is
created only after the npm publish succeeds.

## Emergency publication is blocked

No waiver or bypass input exists. This was originally recorded as a declared open plan item; the
maintainer's explicit decision (2026-09-25) closes it: every release failure blocks, no emergency
waiver support will be built, and no skip flag, policy override, or CI input exempts a required check.
Missing required credentials/evidence are diagnosed and escalated, never waived.
