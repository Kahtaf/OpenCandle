## Context

This change closes three gaps that landed knowingly with `llm-intent-router` (archived at `openspec/changes/archive/2026-04-20-llm-intent-router/`). The relevant state was verified directly:

- `src/pi/opencandle-extension.ts:530` — `handleLlmRouterTurn` builds a `RouterInputContext` with `priorTurns: []` (commented "not wired in v1 — needs Pi session-manager integration"). `src/routing/router-prompt.ts:53-60` already renders `{role, text}` turns with 400-char clipping and newline stripping; the schema is ready.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:682` — `emitInput` runs before the user message is appended. Therefore `ctx.sessionManager.getBranch()` at input time contains strictly prior turns, not the current one.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js:177` and `runner.js:121` — `pi.appendEntry` bridges straight to `sessionManager.appendCustomEntry(customType, data)`. No agent event is emitted, verified by scanning the entire `ExtensionEvent` union in `extensions/types.d.ts`. `session.subscribe(...)` cannot observe custom entries.
- `ReadonlySessionManager` (exported by Pi and handed to extensions) includes both `getBranch()` and `getEntries()`. The `AgentSession` class exposes `sessionManager` as a `readonly` field, so the manual-run harness already has a direct handle.
- `tests/fixtures/router/` holds 12 fixtures; `BASELINE.json.fixtureCount = 12`. `tests/unit/routing/router-fixtures.test.ts:62` already forwards `data.priorTurns` to `route()`, so new multi-turn fixtures need no test-loader changes.
- `src/memory/types.ts:60` — `NEVER_TRUST_FROM_MEMORY` governs structured memory keys (`stock_price`, `target_price`, etc.), not free conversation text. It is not the right primitive for priorTurns scrubbing.

Stakeholders: live-run reviewers (who today infer router behavior from main-agent output), fixture authors (blocked on a workable multi-turn format), and future `/forget` implementers (whose scope now explicitly includes priorTurns).

## Goals / Non-Goals

**Goals:**
- `handleLlmRouterTurn` populates `priorTurns` with up to 5 user/assistant turns verbatim from the session branch.
- `tests/harness/manual-run.ts` captures every session custom entry whose `customType` begins with `opencandle-` into `trace.json` under a new `customEntries` field.
- Deterministic fixture count grows to 22–27, with multi-turn coverage spanning coreference, carried slot, topic shift, correction, and preference conflict.
- Router README spells out that anonymized tickers/buckets must be consistent across all turns of a single fixture.
- One unit test asserts at least one fixture exercises a non-empty `priorTurns` window.

**Non-Goals:**
- Flipping `OPENCANDLE_ROUTER_MODE` to `llm`. Flag stays `rules` by default.
- Implementing `/forget` or any priorTurns scrubbing. Documented as a known follow-up.
- Adding assistant tool-call summaries to priorTurns. Deferred until fixtures show coreference misses.
- Removing regex `classifyIntent` / `extractPreferences`. Separate `remove-rule-router` change.
- Changing the 5-turn window size. Held until fixtures argue for widening.
- Emitting a new agent event for custom entries (would require a Pi fork).

## Decisions

### 1. priorTurns retrieved via `ctx.sessionManager.getBranch()` at input time

- **Considered:** (a) getBranch() on each input event; (b) subscribe to `message_end` and maintain a rolling 5-turn buffer in the extension; (c) add a new Pi API.
- **Chosen:** (a).
- **Why:** Pi confirms the branch is up-to-date and *excludes* the current turn at input-event time. (b) duplicates state Pi already holds and gets wrong on session resume/fork. (c) is out of scope — Pi is a vendored dep and forking it for this is overkill.

### 2. Turn shape: raw text + role, no tool-call summaries

- **Considered:** (a) `{role, text}` verbatim; (b) add assistant tool-call names as a tail on assistant turns; (c) summarize older turns.
- **Chosen:** (a).
- **Why:** The router prompt renderer already handles (a) with 400-char clipping. Adding (b) widens the prompt surface for speculative value — fixtures decide whether it's warranted. (c) duplicates compaction work Pi already does at a different layer.

### 3. 5-turn fixed window, unchanged

- **Considered:** widen to 8 or 10 based on anticipated multi-turn depth.
- **Chosen:** 5, matching the archived design.md Decision 7.
- **Why:** No current fixture or live-run shows 5 is too narrow. Widen when evidence exists, not before.

### 4. Extraction helper lives in `session-coordinator.ts`

- **Considered:** (a) inline the branch walk inside `handleLlmRouterTurn`; (b) add `buildPriorTurns(sessionManager): Array<{role,text}>` to `SessionCoordinator`; (c) add a standalone util under `src/runtime/`.
- **Chosen:** (b).
- **Why:** `SessionCoordinator.buildRouterContextBase()` already owns router context assembly and returns `{profileSnapshot, recentWorkflowRuns}`. Widening it to `{profileSnapshot, recentWorkflowRuns, priorTurns}` keeps one object assembled in one place. Accepts `ReadonlySessionManager` as an arg so unit tests can pass a fake.

### 5. Filter shape for branch walk

- `AgentMessage` in a `SessionMessageEntry` may be a provider `Message` or a `CustomAgentMessages[key]`. We filter for `message.role === "user" || message.role === "assistant"` and extract the first `TextContent` block's text, concatenated if multiple. Tool-result messages (`role: "toolResult"`) are skipped. Custom messages are skipped unless they have a `role` and textual content matching the same check — acceptable because custom messages are extension-authored and typically informational, not conversational.
- Empty-text turns are skipped entirely rather than emitting empty entries. Aborted assistant turns with no content are skipped.
- Order: oldest → newest, then sliced to the last 5. Matches the existing "most recent last" convention in the prompt renderer.

### 6. Harness custom-entry drain: inline, wildcard `opencandle-*`

- **Considered:** (a) inline in `manual-run.ts`; (b) extract a helper in `tests/harness/`.
- **Chosen:** (a).
- **Why:** Single harness today; a premature helper is noise. If a second harness ever needs the same logic, we extract then.
- **Scope:** all `type === "custom" && customType.startsWith("opencandle-")` entries. Known set: `opencandle-router`, `opencandle-router-error`, `opencandle-router-prefs-dropped`, `opencandle-disclaimer`, `opencandle-turn-gap`, `opencandle-workflow`. Wildcard avoids re-editing the harness each time a new entry type is added.
- **Shape in trace.json:** `customEntries: Array<{ customType: string, data?: unknown, timestamp: string }>` where `timestamp` is the entry's `timestamp` field from the SessionEntry. Preserve emission order (entries are appended root→leaf, so `getEntries()` already orders by append time).

### 7. Privacy: priorTurns scrubbing deferred to `/forget`

- **Considered:** (a) inline dollar-amount redaction; (b) NEVER_TRUST_FROM_MEMORY extension to cover text; (c) wait for `/forget`.
- **Chosen:** (c) with explicit documentation.
- **Why:** (a) is pattern-brittle and opaque. (b) conflates structured-key memory (current scope) with conversational text (new scope). The correct control surface is a user-initiated `/forget` that scrubs matching messages AND matching memory AND any future priorTurns derivation. This change notes the dependency in `specs/intent-routing/` and the proposed follow-up.

### 8. Fixture anonymization: intra-fixture consistency required

- **Considered:** (a) no rule (author's choice); (b) suite-wide anonymization mapping; (c) intra-fixture consistency only.
- **Chosen:** (c).
- **Why:** (a) risks "NVDA" in turn 1, "CORPA" in turn 2 — breaks coreference assertions. (b) requires a stable suite-level mapping and rewrites to existing fixtures that aren't wrong today. (c) is the minimum sufficient rule: each fixture is internally consistent; different fixtures may pick different tickers independently. README gets one added bullet under PII hygiene.

### 9. Unit-test guard: at least one fixture has non-empty priorTurns

- The `tests/unit/routing/router-fixtures.test.ts` file gets a new `it("suite contains at least one multi-turn fixture", ...)` assertion that counts fixtures where `priorTurns.length > 0`. Without it, the multi-turn fixtures could silently be deleted in a later cleanup and the capability would regress with no signal.

### 10. BASELINE.json update

- `fixtureCount` updates to the exact final count. `passRate` stays at 1.0 for the deterministic tier (fixtures mock the LLM by construction; a drop below 1.0 means the mock client or route() invariants broke). `recordedAt` updates to the merge date. `notes` appended to mention that multi-turn fixtures are now present.

## Risks / Trade-offs

- **[Risk]** `getBranch()` walking on every input event is O(n) in session length. **Mitigation:** sessions are append-only with typical length in the hundreds of entries for long sessions; filtering + slicing 5 entries is cheap. Measure if it ever shows up in profiling; no preemptive optimization.
- **[Risk]** Custom-message-entry text pollutes `priorTurns` (e.g., onboarding welcome). **Mitigation:** the filter is narrow — `role === "user" || role === "assistant"` on true Message entries. Custom messages with injected roles would pass through, which is desirable when they legitimately represent user intent and acceptable otherwise (the worst case is a stray onboarding line at the top of the window, which the router prompt renders with a 400-char clip).
- **[Risk]** Aborted-streaming assistant turns with partial text appear in priorTurns. **Mitigation:** empty-text filter drops truly empty turns. Partial text is included, which is correct — it represents what the session actually contains. If a fixture ever needs to simulate this, it can include it in `priorTurns`.
- **[Risk]** Live-run pronoun queries fail because the model can't resolve coreference at Haiku tier. **Mitigation:** out of scope here (this change enables the capability; live-run fidelity measurement is the follow-up's job). The failure mode is bounded by the universal fallback stance.
- **[Risk]** `customEntries` in trace.json bloats the file for long runs. **Mitigation:** the known per-turn entries are small (router output JSON is typically <2KB; disclaimer is a constant). No cap in v1. If it becomes a problem, cap after measurement.
- **[Risk]** Fixture-authoring for multi-turn is subjective — different authors may anonymize inconsistently despite the rule. **Mitigation:** the README example shows a multi-turn fixture end to end, and the guard test catches regressions. Stronger tooling (linter/validator) is a separate investment if fixture quality ever drifts.
- **[Trade-off]** Wildcard `opencandle-*` entry capture means adding a new entry type automatically flows into trace.json. Intentional — matches the "zero harness edits per new entry" goal — at the cost of trace.json shape changing implicitly with unrelated extension work.

## Migration Plan

1. Land proposal, design, specs, tasks.
2. Implement `buildPriorTurns(sessionManager)` in `SessionCoordinator` and extend `buildRouterContextBase()`. Unit-test with a fake ReadonlySessionManager returning synthetic branches.
3. Wire the new field in `handleLlmRouterTurn`. Existing router tests continue to pass (they supply `priorTurns` directly to `route()`).
4. Update `tests/harness/manual-run.ts` to drain `opencandle-*` custom entries after settle. Add a harness unit/e2e test (or a smoke check within `tests/e2e/`) that verifies `customEntries` surfaces a synthetic router entry.
5. Author 10–15 new fixtures. Update `BASELINE.json.fixtureCount` and `recordedAt`. Update router README with the anonymization rule and add a worked multi-turn example.
6. Add the guard test asserting ≥1 fixture has non-empty `priorTurns`.
7. Run `npm test` locally; confirm the deterministic fixture suite stays at 100% and the harness drain works against a real tmp session.
8. (Optional, not gating) Run `npm run eval:router-live` to measure real-model behavior on the new fixtures. Record results informally in the PR description.

**Rollback:** revert the extension/coordinator wiring; the router prompt tolerates empty `priorTurns`. Harness change is additive (new `customEntries` field), so removal leaves the rest of trace.json valid. Fixtures can be deleted. No data migration.

## Open Questions

- Should `customEntries` preserve the `id`/`parentId` from SessionEntry for tree reconstruction, or is `{customType, data, timestamp}` sufficient? Lean sufficient — harness consumers want audit, not graph reconstruction — but revisit if a reviewer needs the edge.
- Turn-shape v2: if fixtures show coreference misses, the promotion path for "include assistant tool-call names" should live in this change's design as a documented follow-up hook, or spin up a fresh change? Lean fresh change — adding prompt surface is a router-prompt decision, not a context-plumbing decision.
- Does `buildPriorTurns` belong on `SessionCoordinator` or should it live as a standalone util under `src/runtime/prior-turns.ts`? Current pick is `SessionCoordinator` for locality with `buildRouterContextBase`; revisit if the helper grows.

## Resolution of open questions

- `customEntries` resolved as implemented in `tests/harness/manual-run.ts`: each captured entry preserves `{customType, data, timestamp}` only; `id` and `parentId` are not included.
- Turn-shape v2 resolved as deferred: v1 keeps `{role, text}` and prompt clipping in `src/routing/router-prompt.ts`; assistant tool-call summaries require a fresh follow-up change if evidence justifies widening the prompt surface.
- `buildPriorTurns` resolved as implemented in `src/runtime/session-coordinator.ts`, where `SessionCoordinator.buildRouterContextBase()` assembles `priorTurns` with the rest of the router context.
