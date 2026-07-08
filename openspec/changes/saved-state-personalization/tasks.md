# Tasks

Follow AGENTS.md (TDD, CHANGELOG, `graphify update .`). HARD GATE: no router prompt instruction edits — `src/routing/router-prompt.ts` may gain only a data-rendering function for the saved-state block, structured like `renderPriorTurns`. Never modify eval assertions to pass; the evals are the acceptance criteria.

## 1. Route-context summary (E2) — TDD

- [ ] 1.1 Failing unit test: `buildResolvedTurnContext` output includes `savedMarketState.included/summary` per gating; summary byte-identical to the system-prompt injection for the same seeded state; pass-through turn yields `included: false`, no summary.
- [ ] 1.2 Implement per the proposal's four-step plumbing: public coordinator accessor computes the summary during `handleLlmRouterTurn`; entry-time gate on `output.routeKind !== "pass_through"`; pass via a new `buildResolvedTurnContext` options field (it has no DB access); `buildSystemPrompt` prefers `resolvedTurnContext.savedMarketState.summary` and keeps the direct call for non-router turns. Extend the type in `src/routing/turn-context.ts`.
- [ ] 1.3 Regression guard: existing gating tests (saved context excluded from pass-through prompts) pass unmodified.

## 2. Router saved-state data block (E1) — TDD

- [ ] 2.1 Locate the finance-context signal the conversational risk-preference recovery guard uses (the "finance context must come from the current text or prior turns" check) and reuse it as the pre-router gate; failing unit tests: block present with finance context in text, present with finance context only in prior turns, absent for the tennis-court turn, absent with empty saved state; `renderSavedState` (new, in `router-prompt.ts` beside `renderPriorTurns`, inside the `--- CONTEXT ---` data region) renders symbols + share counts as data with no instruction text.
- [ ] 2.2 Implement: populate from the same per-turn summary data as task 1.2 (structured form, not the prose summary); wire through `buildRouterContextBase`.
- [ ] 2.3 Prompt-integrity check: diff of `router-prompt.ts` shows only the added data-rendering function and its call site; no template-literal instruction changes (the diff review is the gate — `prompt-debt-guard.test.ts` does not cover `router-prompt.ts`; run it anyway for the manifest-literal rules).

## 3. Held-symbol backstop (E1 stability) — TDD

- [ ] 3.1 Failing unit tests for the truth table in the spec: single-holding backstop fires with diagnostic; multi-holding no-guess; explicit-ticker suppression; no fire when router already resolved the holding; phrase list covers "the one I hold" / "my position" / "my holding" / "my shares" case-insensitively.
- [ ] 3.2 Implement in `postProcessRouterOutput` as new sibling logic beside the existing options-screener held-symbol correction (~`router.ts:397-432`); widen the function's context parameter (currently `Pick<RouterInputContext, "priorTurns" | "profileSnapshot">`) to carry the saved-state block; add router fixture(s) for the backstop under `tests/fixtures/router/` following existing conventions (update `BASELINE.json`'s `fixtureCount`, currently 32).
- [ ] 3.3 Slot-provenance guard (TDD): failing tests mirroring the prior-turn downgrade truth table — saved-state symbol in a user-sourced slot, absent from text and prior turns → source `memory` + `symbols_slot_provenance_saved_state` diagnostic; symbol also in current text → untouched. Implement beside `symbolsSlotClaimsPriorTurnUserProvenance`.

## 4. Eval promotion + live verification

- [ ] 4.1 Remove the `OPENCANDLE_EVAL_KNOWN_FAIL_E2` gate from `saved-market-state.eval.ts` and the `OPENCANDLE_RUN_KNOWN_FAIL_EVALS` gate from `live-multi-turn-coreference.eval.ts`; E1 keeps usually-tier + its `OPENCANDLE_LIVE_MULTI_TURN_EVAL` opt-in; E2 then has no remaining opt-in flag and runs on every `EVAL_TIER=usually` invocation (which requires credentials) — this is intended. Update the FINDING/PROMOTE comments to record promotion and this change id.
- [ ] 4.2 Run both live (E1: `EVAL_TIER=usually OPENCANDLE_LIVE_MULTI_TURN_EVAL=1`; E2: `EVAL_TIER=usually`) with credentials; both pass; trace excerpts in the PR. If either still fails, that is a FINDING — stop and report, do not weaken assertions.
- [ ] 4.3 Run `npm run eval -- router-live` after the post-processor change (full fixture corpus — 32 today plus task 3.2's additions; zero route-kind flips) and archive the fresh baseline per `tests/fixtures/router/eval-baselines/` conventions.

## 5. Follow-through

- [ ] 5.1 Add a one-line note to `openspec/changes/forget-command/proposal.md` listing the router-visible saved-state block as a fifth suppression surface for when I4 is scheduled (note only; no implementation).
- [ ] 5.2 `npm test`, `npx tsc --noEmit`, `npx biome ci .` green; CHANGELOG `[Unreleased]` entries; `graphify update .`; `npx openspec validate saved-state-personalization --strict`.
