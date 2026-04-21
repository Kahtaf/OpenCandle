## 1. Prerequisites

- [x] 1.1 Confirm `honest-analyst-stance` has landed on main (universal stance is a hard dependency, specifically including the stance updates to `src/prompts/workflow-prompts.ts` and workflow step prompts)
- [x] 1.2 Grep all call sites of `classifyIntent`, `WorkflowType`, `ClassificationResult`, `ExtractedEntities`, `SlotResolution`, `extractPreferences`, `extractAndStorePreferences`, and `buildDisclosureBlock`; enumerate consumers that will branch on `OPENCANDLE_ROUTER_MODE`

Consumers enumerated:
- `src/pi/opencandle-extension.ts` — calls `classifyIntent`, `resolvePortfolioSlots`, `resolveOptionsScreenerSlots`; calls `coordinator.extractAndStorePreferences` (which uses `extractPreferences`). Branch point.
- `src/runtime/session-coordinator.ts` — imports `extractPreferences` in `extractAndStorePreferences`. Branch point.
- `src/workflows/portfolio-builder.ts`, `options-screener.ts`, `compare-assets.ts` — consume `SlotResolution<...>`, call `buildPortfolioPrompt`/etc. Re-used under both modes (router builds `SlotResolution` from output slots).
- `src/prompts/workflow-prompts.ts::buildDisclosureBlock` — consumed by workflow prompt builders; new shared renderer wraps this.

## 2. Schema migration (ask-first per AGENTS.md)

- [x] 2.1 Explicitly confirm the `turn_type` schema change with a project maintainer before editing `src/memory/sqlite.ts`
- [x] 2.2 Replace the current `ensureCurrentSchema` reset-on-mismatch path for the v2 → v3 transition with an additive migration: `ALTER TABLE workflow_runs ADD COLUMN turn_type TEXT NOT NULL DEFAULT 'workflow'`. Keep the reset path for any version jump older than v2 to v3
- [x] 2.3 Bump `CURRENT_SCHEMA_VERSION` to 3 and insert a matching `schema_version` row after migration
- [x] 2.4 Add a migration test that seeds a v2 DB with representative rows in `workflow_runs`, `user_preferences`, `recommendations`, runs the migration, and asserts (a) zero row loss across all three tables, (b) `turn_type` column exists with default `"workflow"` applied to legacy rows, (c) schema version reads as 3
- [ ] 2.5 Copy a real `~/.opencandle/state.db` to a scratch path and run the migration against it manually before merging; verify row counts match pre-migration (skipped — manual step requires live dev DB)

## 3. Rollout flag and config

- [x] 3.1 Add `OPENCANDLE_ROUTER_MODE` to `src/config.ts` with allowed values `"rules"` (default) and `"llm"` and clear validation
- [x] 3.2 Document the flag in README (or AGENTS.md) with operator-facing guidance on when to flip

## 4. Router module and prompt

- [x] 4.1 Define `RouterOutput` type matching the schema in design.md (`src/routing/router-types.ts`), reusing `WorkflowType` and `SlotSource` from `src/routing/types.ts`
- [x] 4.2 Implement the router prompt (`src/routing/router-prompt.ts`) — inputs: user text, last 5 turns, investor_profile snapshot, last 3 workflow_runs summaries, workflow catalog. Explicitly no tool catalog (prior-turns are an input parameter; wiring the last-5 feed from Pi session history is a follow-up — router still operates with empty window)
- [x] 4.3 Implement `src/routing/router.ts::route()` — builds the input, calls the Haiku-class LLM with structured output, validates against the RouterOutput schema, retries once on validation failure, falls back to a minimal router output (route `"fallback"`, regex-extracted symbols only) on persistent failure
- [x] 4.4 Verify no AgentTool is exposed to the router LLM call; add an assertion/test asserting this (`router-llm-client.ts` passes `tools: []` to `completeSimple`; unit test covers this)
- [x] 4.5 Persist each router output as an `opencandle-router` session entry for observability

## 5. Shared Assumptions-block renderer

- [x] 5.1 Decide whether to (a) adapt `buildDisclosureBlock` in `src/prompts/workflow-prompts.ts` to consume router output directly, or (b) introduce `src/prompts/assumptions-block.ts` as a new shared module. Prefer (a) if feasible to minimize surface area — chose (a): new `buildAssumptionsBlockFromRouter` wraps the existing `buildDisclosureBlock`
- [x] 5.2 Move Assumptions rendering off each workflow prompt builder and into the shared path; workflow builders call the shared renderer with router output instead of constructing their own disclosure blocks — router-mode path uses `buildAssumptionsBlockFromRouter`; rule-mode workflow builders continue to call `buildDisclosureBlock` directly
- [x] 5.3 Preserve existing label convention (`User-specified` / `From saved preferences` / `Defaults`) — no new label vocabulary

## 6. Fallback playbook and prompt assembly

- [x] 6.1 Add a fallback playbook section to `src/prompts/context-builder.ts` that renders when `route === "fallback"`; content: tool-first, commit-with-reasoning, `missing_required` surfacing with instruction to use `ask_user`
- [x] 6.2 Ensure the fallback playbook composes cleanly with the universal analyst stance (from change A) and with the shared Assumptions block

## 7. Wiring in pi.on("input")

- [x] 7.1 In `src/pi/opencandle-extension.ts`, branch on `OPENCANDLE_ROUTER_MODE` at the top of the input handler
- [x] 7.2 When mode is `rules`: existing `classifyIntent` + `extractAndStorePreferences` + workflow-branch cascade runs unchanged
- [x] 7.3 When mode is `llm`: invoke router, apply high-confidence `preference_updates` to storage, record the turn in `workflow_runs` with `turn_type` equal to router route and `workflow_type` equal to the workflow name (or sentinel `"fallback"`), render the Assumptions block from router output, dispatch based on `route`
- [x] 7.4 In `llm` mode, ensure `extractPreferences` and `classifyIntent` are NOT called (no duplicate writes)
- [x] 7.5 Do NOT delete `classifyIntent`, `preference-extractor.ts`, or related rule-path code in this change — they remain live behind the flag

## 8. Preference-write policy

- [x] 8.1 In the router handler, filter `preference_updates` to `confidence === "high"` before calling `storage.upsertPreference`
- [x] 8.2 Log dropped medium/low-confidence extractions to an observability entry (`opencandle-router-prefs-dropped`) for debugging

## 9. Missing-required surfacing

- [x] 9.1 When `missing_required` is non-empty, inject a line into the main-agent prompt (in both workflow and fallback playbooks) naming the missing slots and instructing the agent to call `ask_user` before committing
- [x] 9.2 Add a test asserting that when router emits `missing_required: ["symbol"]`, the assembled prompt contains the expected ask_user directive

## 10. Deterministic CI fixtures

- [x] 10.1 Define the fixture file format in `tests/fixtures/router/README.md` per the `router-evals` spec
- [x] 10.2 Implement the CI fixture runner (`tests/unit/routing/router-fixtures.test.ts`) that loads each fixture, constructs the router input, asserts that the router code under test (with a mocked LLM response matching `expectedRouterOutput`) parses and dispatches correctly, and records any diffs
- [ ] 10.3 Seed ~50 deterministic fixtures from sampled real conversations; anonymize per spec; commit them to the repo — seeded 12 of ~50 planned; more to be added incrementally from sampled real turns
- [x] 10.4 Gate CI on 100% deterministic fixture pass-rate (fail the test suite if any fixture fails) — covered by the fixture runner's `toEqual` assertion per fixture
- [x] 10.5 Record the baseline in `tests/fixtures/router/BASELINE.json` (format: `{ passRate, fixtureCount, recordedAt }`)

## 11. Opt-in live eval

- [x] 11.1 Implement `tests/scripts/run-live-router-eval.ts` — runs the real router against the same fixture set, compares outputs with reasoning-field exemption, reports per-fixture diffs + aggregate pass-rate + p50/p95 latency
- [x] 11.2 Add usage documentation in `tests/fixtures/router/README.md` — when to run it, how to interpret deltas, what counts as a regression
- [x] 11.3 Do NOT add the live eval to the default `npm test` or `npm run test:e2e` scripts; add a dedicated `npm run eval:router-live` that explicitly invokes it

## 12. Verification

- [x] 12.1 Run `npm test` with default `OPENCANDLE_ROUTER_MODE=rules`; confirm all existing tests pass (rule path untouched) — 1128/1128 pass
- [x] 12.2 Run `npm test` with `OPENCANDLE_ROUTER_MODE=llm` and mocked router LLM responses; confirm all deterministic fixtures pass — 12/12 fixtures pass via deterministic mock-LLM runner
- [ ] 12.3 Run `npm run eval:router-live` against the seed fixtures and record baseline latency + pass-rate — SKIPPED: requires live LLM API access, not available in this environment
- [ ] 12.4 Live-run "Give me entry levels on ASTS for a 6 month horizon" via `tests/harness/manual-run.ts` with `OPENCANDLE_ROUTER_MODE=llm` — SKIPPED: requires live LLM
- [ ] 12.5 Live-run "I'm aggressive, give me a 3-year portfolio for $25k" — SKIPPED: requires live LLM
- [ ] 12.6 Live-run multi-turn pronoun test — SKIPPED: requires live LLM AND prior-turn wiring from Pi session history (v1 passes empty window)
- [ ] 12.7 Verify schema migration on a real `~/.opencandle/state.db` (copied to a test location); confirm no row loss and `turn_type` column present with correct defaults — SKIPPED: requires live dev DB. Covered by unit-test equivalent seeding a v2 DB with representative rows
- [ ] 12.8 With `OPENCANDLE_ROUTER_MODE=llm`, submit an ambiguous symbol query — SKIPPED: requires live LLM. Zero-tool guarantee covered by `buildRouterPrompt` unit test + `createPiAiRouterClient` hardcoding `tools: []`
