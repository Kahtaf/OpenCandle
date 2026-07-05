# Consolidate Eval Entry Points; Retire the Legacy Manual-Run Harness

## Why

The eval surface has grown to ~9 execution paths with inconsistent front doors: seven `test:evals*`/`eval:*` npm scripts, five runnable scripts with **no** npm script at all (`run-main-branch-product-replay.ts`, `run-main-branch-competitive-replay.ts`, `build-oc-superiority-scorecard.ts`, `run-prompt-policy-manifest.ts`, `run-prompt-policy-ref-parity.ts`), ~40 env flags across at least seven inconsistent prefixes (`EVAL_TIER`, `OPENCANDLE_EVAL_*`, `OPENCANDLE_COMPETITIVE_*`, bare `COMPETITIVE_*`, `PRODUCT_EVAL_*`/`PRODUCT_REPLAY_*`, `PROMPT_POLICY_*`, `OPENCANDLE_ROUTER_*`), eight-plus report filename suffixes landing in `tests/evals/runs/` with no index, and docs drift (`tests/AGENTS.md` omits evals entirely). Scope note: "every suite" means the `tests/evals/` + `tests/scripts/` suites; the opt-in GUI/TUI parity eval stays under `test:gui:browser` (it is a browser-suite case, not an eval-runner case). The release cadence ("run `eval:router-live`, `test:evals`, `test:evals:product`, and the frozen panel per release") exists only as prose in an internal plan.

Separately, `tests/harness/manual-run.ts` is a legacy single-prompt harness superseded by `opencandle-runner.ts` (in-process) and `cli.ts` (IPC). It is still load-bearing in exactly three places: `tests/e2e/harness-dcf.test.ts`, `tests/e2e/harness-custom-entries.test.ts`, and the `test-harness-observability` spec that pins it by name. Keeping a third parallel harness invites divergence in trace capture.

## What Changes

- Add one eval front door: `tests/scripts/run-evals.ts`, exposed as `npm run eval -- <suite> [options]`, dispatching to every existing suite with CLI options that set the existing env flags (no flag renames).
- Add `npm run eval -- release` (alias `eval:release`): the per-release cadence bundle — live router eval, always-tier cases, product evals, frozen competitive panel — run sequentially with an aggregate summary and non-zero exit on any suite failure.
- Rewire existing `test:evals*` / `eval:*` npm scripts as thin aliases of the front door; add front-door coverage for the five script-only runners.
- Append one JSONL line per run to `tests/evals/runs/index.jsonl` (suite, started/finished timestamps, report path(s), exit code) so runs are discoverable.
- Migrate the two e2e tests that spawn `manual-run.ts` to the IPC harness (`tests/harness/cli.ts`), update the `test-harness-observability` spec to be runner-neutral, then **delete `tests/harness/manual-run.ts`**.
- Update `docs/testing-and-evals.md` and add an evals section to `tests/AGENTS.md`.

## Non-Goals

- No renaming of existing env flags (including the legacy `OPENCANDLE_MANUAL_RUN_SETTLE_GRACE_MS`, which outlives the file it was named after — its only surviving reader is the competitive runner, which passes it into `runOpenCandleSession`).
- No changes to any scorer, threshold, tier semantics, case, fixture, or baseline format.
- No evals added to CI or `release:check` (live suites need credentials; the release cadence stays a documented manual gate).
- No changes to `opencandle-runner.ts` / `cli.ts` behavior beyond what the two migrated e2e tests need (expected: none).
- No record/replay layer for live evals (explicitly deferred by the maintainer).
