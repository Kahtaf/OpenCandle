# Tasks

Follow AGENTS.md (TDD, CHANGELOG, `graphify update .`). Eval author ground rule is absolute: never modify production code, prompts, or routing to make a new assertion pass — failures are findings. Benchmark literals live in `docs/internal/prompt-to-policy-migration-manifest.json` and tests only; run `npx vitest run tests/unit/prompts/prompt-debt-guard.test.ts` after manifest edits.

## 1. Cache age guard (TDD)

- [ ] 1.1 Failing unit tests in `tests/unit/evals/competitive-finance.test.ts` scope: cached answer with 9-day-old timestamp treated as absent; same-day reused; missing timestamp on a legacy cache record treated as expired; env override respected; failed-answer skip behavior unchanged.
- [ ] 1.2 Implement in `findCachedCompetitorAnswer` / the cache-record shape in `tests/evals/competitive-finance.ts`. Cached answers come from past report JSONs, which carry report-level `generatedAt` but no per-answer timestamp — use the source report's `generatedAt` as the answer age; a cache source with no readable timestamp is expired.

## 2. Judge-noise disclosure (TDD)

- [ ] 2.1 Failing unit tests for the genuinely new pieces only (the report already carries `judge: { provider, model }`): `judgeFamilyConflict` true/false cases under the explicit acpx→family map; summary text labels win counts noisy and names hard assertions as the gate.
- [ ] 2.2 Implement: the report literal, `summarize()`, and the printed summary live in `tests/scripts/run-competitive-finance-eval.ts` (~lines 288-343, 595-608) — NOT in `competitive-finance.ts`, which holds only post-hoc analysis. Extract the new conflict/summary logic into exported helpers in `tests/evals/competitive-finance.ts` so it is unit-testable, and call them from the run script.

## 3. New frozen prompts + assertions

- [ ] 3.1 Author the three prompts (ETF-overlap, options per-share/contract language, weekend "what moved today") in the frozen panel with naturally-worded retail phrasing per `docs/internal/competitive-benchmarking.md` rules.
- [ ] 3.2 Extend the manifest schema to the string-or-object union (`{ assertion, leadPatterns?, justification? }`) and update every consumer typed `finalAnswerHardAssertions?: string[]` (`run-competitive-finance-eval.ts` ~:145, `run-prompt-policy-manifest.ts`, and their tests) to handle both forms; then add ≥2 assertions per new prompt with registered checkers (extend `tests/evals/prompt-policy-assertions.ts` for genuinely new shapes); unit tests per checker (pass and fail fixtures).
- [ ] 3.3 Relax the bottom-line assertion via the object form: `leadPatterns` enumerated, `justification` recorded, checker gains the first-400-characters opening window (new positional behavior — the current checker at `prompt-policy-assertions.ts` ~:392-395 is substring-anywhere). Unit tests: equivalent lead passes, literal still passes, pattern-only-after-400-chars fails.
- [ ] 3.4 Assert in the frozen-run unit coverage that no panel prompt reports "No deterministic checker registered".

## 4. History ledger

- [ ] 4.1 Frozen run appends its row to a NEW "## Frozen panel runs" table in `docs/internal/competitive-benchmark-history.md` (columns per spec; create the section on first append; never touch the existing improvement-loop table); unit test the row formatter; the append is skipped outside frozen mode.

## 5. Live verification

- [ ] 5.1 One live frozen run end to end (credentials + acpx per `docs/internal/competitive-benchmarking.md`). Expected: existing 5 prompts behave as before; new prompts produce results; any new-assertion failure is recorded as a FINDING in the PR (not fixed here); ledger row appended; report shows judge disclosure fields.
- [ ] 5.2 `npm test`, `npx tsc --noEmit`, `npx biome ci .`, prompt-debt guard green; CHANGELOG `[Unreleased]` entry; `graphify update .`; `npx openspec validate competitive-panel-hard-assertions --strict`.
