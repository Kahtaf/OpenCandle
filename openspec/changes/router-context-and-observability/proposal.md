## Why

The LLM router (archived `llm-intent-router`) shipped with three known gaps that block its usefulness for real multi-turn conversation and its evaluability from the manual-run harness: (1) `handleLlmRouterTurn` passes `priorTurns: []`, so coreferring follow-ups like "what about at $500?" have no anchor; (2) router and disclaimer `pi.appendEntry` writes never land in `trace.json` because the harness subscribes only to agent events — we verified Pi emits no event for custom entries, so no amount of subscription wiring fixes it; (3) only 12 of the ~50 fixtures promised in the router-evals spec exist, and none exercise multi-turn. Together these mean the router runs blind (no history context), is verified blind (no entries in trace.json), and is exercised narrowly (no multi-turn fixtures).

## What Changes

- **Wire `priorTurns`** in `src/pi/opencandle-extension.ts::handleLlmRouterTurn` by reading the last 5 user/assistant turns from `ctx.sessionManager.getBranch()` at input-event time (confirmed in Pi source: `emitInput` fires before user-message append, so the branch holds pure prior context). Raw `{role, text}` shape — the existing `router-prompt.ts` renderer applies per-turn 400-char clipping and newline stripping, so no additional clipping is added at the extraction layer. No tool-call summarization in v1. Compaction summary entries and branch summary entries are skipped rather than padded; the window may be shorter than 5 after compaction.
- **Capture `opencandle-*` custom entries in trace.json** from the manual-run harness by walking `session.sessionManager.getEntries()` after settle, filtering `type === "custom" && customType.startsWith("opencandle-")`, and appending to the trace as a new `customEntries` field. Inline in `tests/harness/manual-run.ts` — no helper extraction for one harness.
- **Seed 10–15 new fixtures** under `tests/fixtures/router/`, majority multi-turn: coreference, carried slot, topic shift, correction, profile-vs-current conflict, dollar-phrase preservation. Update `BASELINE.json.fixtureCount` and `recordedAt`. Extend router `README.md` with the anonymization rule that tickers/buckets must be consistent across all turns of a single fixture.
- **Document `/forget` dependency** for priorTurns filtering as a known follow-up privacy gap. No implementation in this change.
- Add one unit test in `tests/unit/routing/` that asserts at least one fixture exercises a non-empty `priorTurns` window — a regression guard against the fixture set drifting back to single-turn-only.

## Capabilities

### New Capabilities
- `test-harness-observability`: manual-run harness captures every `opencandle-*` custom entry written to the session into `trace.json`, so fixture and live-run reviewers can inspect router/disclaimer/workflow decisions without inferring them from main-agent output.

### Modified Capabilities
- `intent-routing`: the router input SHALL include the last 5 prior user/assistant turns verbatim from the session branch at input-event time (not an empty window).
- `router-evals`: the deterministic fixture set SHALL include multi-turn fixtures exercising coreference, carried slots, topic shift, correction, and preference-conflict resolution; the anonymization rule SHALL require intra-fixture consistency (same anonymized ticker/bucket across all turns of one fixture).

## Impact

- **Code:**
  - `src/pi/opencandle-extension.ts` — `handleLlmRouterTurn` reads prior turns from `ctx.sessionManager.getBranch()`.
  - `src/runtime/session-coordinator.ts` — new `buildPriorTurns(sessionManager)` helper (or inline in the extension; decided in design.md).
  - `tests/harness/manual-run.ts` — drain `opencandle-*` custom entries to trace.
- **Tests:**
  - `tests/fixtures/router/` — 10–15 new fixtures, updated `BASELINE.json` and `README.md`.
  - `tests/unit/routing/router-fixtures.test.ts` — guard test for non-empty priorTurns fixture presence.
  - Harness unit coverage for the custom-entry drain.
- **Dependencies:** none added. Pi primitives used (`getBranch`, `getEntries`) are already exposed on `ReadonlySessionManager`.
- **Flags:** `OPENCANDLE_ROUTER_MODE` stays defaulted to `rules`. This change does NOT flip the flag.
- **Follow-ups opened:**
  - `/forget` command (scrubs priorTurns and matching memory).
  - Potential widening of turn-shape to include assistant tool-call summaries if multi-turn fixtures show coreference misses.
  - `remove-rule-router` (unchanged from the archived design's §12 plan).
