# Tasks

Follow AGENTS.md (TDD, `.js` imports, CHANGELOG, `graphify update .`). No scorer/threshold/case/fixture changes anywhere in this change — the eval author ground rule applies doubly: this change must not alter what any suite measures.

## 1. Front door (TDD)

- [x] 1.1 Failing unit tests for the dispatch table module (extract the table into `tests/scripts/run-evals-table.ts` so it is unit-testable without spawning): suite id → expected command + env mapping for every row in design.md §1; unknown suite → error with the suite listing; `--tier`/`--known-fail`/`--case`/`--include-opt-in`/`--provider`/`--model`/`--base-ref` option-to-env mappings.
- [x] 1.2 Implement `tests/scripts/run-evals.ts` (arg parse, print resolved command+env, spawn `stdio: "inherit"`, exit-code propagation).
- [x] 1.3 Implement the runs index append (directory diff before/after; JSONL line per design.md). Unit test with a temp dir.
- [x] 1.4 Implement the `release` sequence (continue-past-failure, aggregate table, non-zero exit on any failure). Unit test the aggregation with stubbed suite results.
- [x] 1.5 Add `eval` and `eval:release` npm scripts; rewire `test:evals`, `test:evals:usually`, `test:evals:product`, `test:evals:competitive`, `test:evals:competitive:frozen`, `eval:router-live`, `eval:competitive:analyze` as front-door aliases. Confirm `tests/evals/runs/index.jsonl` is covered by the existing runs-dir gitignore (add if not).

## 2. Manual-run retirement

- [x] 2.1 Migrate `tests/e2e/harness-dcf.test.ts` to `tests/harness/cli.ts` (run → wait → trace); rewrite assertions to the `AgentTrace` field names with identical semantics (`toolCalls.map(c => c.name)` → `toolSequence`; `text` → `finalText`) per design §3. Run `npm run test:e2e:harness-dcf` live to prove it.
- [x] 2.2 Migrate `tests/e2e/harness-custom-entries.test.ts` the same way; its `customEntries` assertions must pass against the IPC trace. If the IPC trace lacks anything the test asserts, STOP and report (do not weaken the test or resurrect a runner).
- [x] 2.3 Update the manual-run reference comment in `tests/e2e/credential-prompt.test.ts` (comment-only edit).
- [x] 2.4 `grep -rn OPENCANDLE_MANUAL_RUN_SETTLE_GRACE_MS` — confirm all readers live outside `manual-run.ts`; document the flag as legacy-named in `docs/testing-and-evals.md`.
- [x] 2.5 Update `tests/harness/README.md` (remove manual-run sections; one-shot usage points at `cli.ts`).
- [x] 2.6 Delete `tests/harness/manual-run.ts`. `grep -rn "manual-run" src tests gui scripts .github package.json` returns only historical references (CHANGELOG, archived openspec changes, internal docs).

## 3. Docs

- [x] 3.1 Rewrite the entry-point sections of `docs/testing-and-evals.md` around the front-door table; note legacy script names still work; document `eval -- release` as the release cadence gate. Do not restate the `deterministic-evals` spec's stale claim that always-tier cases run in the standard `npm test` pipeline (they don't today; this change deliberately keeps evals out of CI).
- [x] 3.2 Add the evals/scripts section to `tests/AGENTS.md` (structure, tiers, known-fail flags, `// PROMOTE:` convention, runs index).

## 4. Verification

- [x] 4.1 `npm test`, `npx tsc --noEmit`, `npx biome ci .` green.
- [x] 4.2 Behavior-identity spot check: run one cheap suite both ways (`npm run eval -- cases` vs direct `vitest run --config vitest.config.evals.ts`) and confirm identical pass/fail and report shape.
- [x] 4.3 Live evidence: `npm run test:e2e:harness-dcf` (migrated) output excerpt in the PR; one `npm run eval` listing screenshot/excerpt.
- [x] 4.4 CHANGELOG `[Unreleased]` entries (front door + release cadence; manual-run removal).
- [x] 4.5 `graphify update .`; `npx openspec validate eval-entrypoint-consolidation --strict`.
