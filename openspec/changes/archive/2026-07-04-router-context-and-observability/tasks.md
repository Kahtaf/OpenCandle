## 1. priorTurns helper in SessionCoordinator

- [x] 1.1 Add `buildPriorTurns(sessionManager: ReadonlySessionManager, max = 5): Array<{role: "user" | "assistant", text: string}>` to `src/runtime/session-coordinator.ts`; walk `sessionManager.getBranch()`, filter `type === "message"` with `message.role` in {user, assistant}, extract concatenated text-block content, drop empty-text entries, skip compaction and branch-summary entries, order oldest→newest, slice to last `max`.
- [x] 1.2 Extend `SessionCoordinator.buildRouterContextBase` signature to accept `sessionManager: ReadonlySessionManager` and return `{ profileSnapshot, recentWorkflowRuns, priorTurns }`.
- [x] 1.3 Write unit tests in `tests/unit/runtime/session-coordinator.test.ts` (or colocated) covering: fewer-than-5 branches, empty branch, branch with tool-result messages excluded, branch with aborted/empty-text assistant turns excluded, branch with assistant turns containing only tool-call blocks (no text) excluded, branch with a compaction summary entry between root and leaf (skipped, window may be shorter), branch with >5 qualifying entries sliced correctly, ordering oldest→newest.

## 2. Wire priorTurns in the extension

- [x] 2.1 In `src/pi/opencandle-extension.ts::handleLlmRouterTurn`, call `coordinator.buildRouterContextBase(ctx.sessionManager)` and pass the returned `priorTurns` into the `RouterInputContext` instead of `[]`.
- [x] 2.2 Remove the "priorTurns is not wired" comment block; leave a one-line reference to the `/forget` privacy follow-up.
- [x] 2.3 Verify existing router unit tests (`tests/unit/routing/router*.test.ts`) still pass — they construct their own `RouterInputContext` and do not depend on extension wiring.

## 3. Harness captures opencandle-* custom entries

- [x] 3.1 In `tests/harness/manual-run.ts`, after the settle promise resolves and before `writeFileSync(trace.json)`, iterate `session.sessionManager.getEntries()` and collect entries where `type === "custom" && customType.startsWith("opencandle-")`.
- [x] 3.2 Extend the `trace` object with `customEntries: Array<{ customType: string, data: unknown, timestamp: string }>` preserving append order.
- [x] 3.3 Update `tests/harness/types.ts` and `tests/harness/README.md` to document the new `customEntries` field on the trace shape.
- [x] 3.4 Add an end-to-end check (tests/e2e or scripted harness run) driving any turn that produces at least an `opencandle-disclaimer` entry (rules-mode OK), and assert: `customEntries` contains it, and that when a workflow-dispatch turn runs the suite also captures the `opencandle-workflow` entry. Keep router-mode-specific assertions (`opencandle-router`) guarded behind live-LLM availability.

## 4. Multi-turn fixture seeding

- [x] 4.1 Author a coreference fixture (`013-coreference-price.json`): prior NVDA turn → "what about at $500?". `entities.symbols: ["NVDA"]`, no `symbol` slot.
- [x] 4.2 Author a carried-context fixture (`014-carried-budget.json`): prior "$20k portfolio" → "make it aggressive". `entities.budget: 20000`, `slots.risk_profile` from current turn only, no `budget` slot, `missing_required: []`.
- [x] 4.3 Author a topic-shift fixture (`015-topic-shift.json`): prior BTC turn → "tell me about NVDA". `entities.symbols: ["NVDA"]` only; no BTC leak.
- [x] 4.4 Author a correction fixture (`016-ticker-correction.json`): prior TSLA → "I meant TSLAQ". `entities.symbols: ["TSLAQ"]`.
- [x] 4.5 Author a preference-conflict fixture (`017-pref-conflict.json`): profile.risk=aggressive + current-turn cautious phrasing → `preference_updates` emits high-confidence `risk_profile`.
- [x] 4.6 Author a dollar-phrase-preservation fixture (`018-dollar-phrase.json`): prior "$500k in SPY" → "same for QQQ" with no dollar-derived slot leak from the prior turn.
- [ ] 4.7 Moved to `docs/internal/high-leverage-improvements-plan.md` (I5 — eval expansion); candidate list preserved there. Original scope: author 4–9 additional fixtures filling coverage gaps identified while reviewing the existing 12 (candidates: multi-symbol compare with prior context, fallback-from-general-qa shift, preference ECHO that MUST NOT become a preference_update, router misclassification recovery).
- [x] 4.8 Ensure each multi-turn fixture uses intra-fixture-consistent anonymization for tickers and bucketed dollar placeholders.
- [x] 4.9 Tag every synthesized multi-turn fixture (013–018 and any further synthetic additions) with `synthetic-multi-turn` in the fixture `tags` array, per the router-evals spec.
- [x] 4.10 Run `npm test` and confirm `router-fixtures.test.ts` passes at 100% against all new fixtures.

## 5. BASELINE.json and README updates

- [x] 5.1 Update `tests/fixtures/router/BASELINE.json`: set `fixtureCount` to the final total, `recordedAt` to the merge date (today), append a note that multi-turn fixtures are now present.
- [x] 5.2 Update `tests/fixtures/router/README.md`: add the intra-fixture consistent-anonymization rule under PII hygiene, include a worked multi-turn fixture example showing `priorTurns` populated correctly, and document the prior-turn-values-go-into-entities-not-slots rule.
- [x] 5.3 Document the `/forget` privacy follow-up explicitly in the router README AND add a one-paragraph note to `src/routing/router-prompt.ts` (or a sibling doc comment) stating that priorTurns conversational text is not filtered by `NEVER_TRUST_FROM_MEMORY` and that `/forget` is the designated scrubbing primitive.

## 6. Multi-turn guard test

- [x] 6.1 In `tests/unit/routing/router-fixtures.test.ts`, add `it("suite contains at least one multi-turn fixture (priorTurns.length > 0)", ...)` that counts multi-turn fixtures and asserts `count > 0`.
- [x] 6.2 Temporarily delete all multi-turn fixtures locally, rerun the test, confirm the new assertion fails; restore the fixtures.

## 7. Integration verification

- [x] 7.1 Run `npm test` end-to-end; all suites green.
- [x] 7.2 Add a unit/integration test that wires the extension handler end-to-end against a fake `ReadonlySessionManager` returning a synthetic branch (e.g., one prior user turn "tell me about NVDA" and one assistant text turn), invokes `handleLlmRouterTurn("what about at $500?")` with a stub `RouterLlmClient` that echoes its input prompt, and asserts the prompt rendered by `buildRouterPrompt` contains the NVDA prior-turn text in the "Prior conversation turns" section. This replaces the previously-scoped live-multi-turn harness verification, which is infeasible because `manual-run.ts` accepts only one top-level prompt per invocation.
- [ ] 7.3 Superseded by the mandatory baseline run in WP2 of `docs/internal/openspec-backlog-cleanup-plan.md`. Original optional scope: run `npm run eval:router-live` on the full fixture set; record latency + pass-rate in the PR description.
- [x] 7.4 (Optional, not gating) Run `OPENCANDLE_ROUTER_MODE=llm` with a single-turn prompt via `manual-run.ts` and confirm `trace.json.customEntries` contains an `opencandle-router` entry whose `data.output` matches the router output schema. Skip if live LLM unavailable; document skip in the PR.

## 8. Proposal housekeeping

- [x] 8.1 Update `CHANGELOG.md` (Unreleased section) with a one-line entry crediting both the priorTurns wire-up and the harness observability capture.
- [x] 8.2 Confirm neither `src/pi/opencandle-extension.ts` nor `src/runtime/session-coordinator.ts` still contains the "priorTurns is not wired in v1" commentary; grep for the string before merging.
