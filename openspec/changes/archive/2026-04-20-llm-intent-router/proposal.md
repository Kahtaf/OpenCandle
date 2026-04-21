## Why

`classifyIntent` is ~15 hand-written regex rules covering 6 workflows. Common queries like "Give me entry levels on ASTS for a 6 month horizon" fall through to `unclassified`, bypassing slot resolution and the Assumptions block. Separately, `extractPreferences` is 10 regexes that capture only a narrow set of phrasings — "6 month horizon" isn't matched, neither is "aggressive investor" — so most conversational preference signals are lost. An LLM-based router replaces both with a single structured-output call that classifies the workflow, extracts entities + slots with source provenance, and captures preferences. Unclassified queries get a real fallback playbook instead of a silent drop.

## What Changes

- Replace `src/routing/classify-intent.ts` rule system with an LLM router (Haiku-class model) invoked from `pi.on("input")` before prompt assembly.
- Replace `src/memory/preference-extractor.ts` regex pipeline with preference updates emitted by the router.
- **Router has zero tool access in v1.** Pure-text classification only. If evals show ticker disambiguation or similar lookups would materially improve accuracy, a follow-up change can wire a router-safe tool set. (The existing `search_ticker` AgentTool is available to the main agent; the router doesn't call it.)
- Router emits validated JSON with the shape:
  ```
  { route: "workflow" | "fallback",
    workflow?: string,
    entities: { symbols, direction, ... },
    slots: { [name]: { value, source: "user"|"preference"|"default", confidence } },
    preference_updates: [{ key, value, confidence, source: "inferred" }],
    missing_required: string[],
    reasoning: string }
  ```
- **Two routes only in v1**: `workflow` and `fallback`. We deliberately omit `direct_tool` (no defined execution path; main agent already handles simple fetches cleanly via its tool loop) and `needs_clarification` (the main agent's existing `ask_user` tool handles clarification; router surfaces `missing_required` in the prompt so the main agent asks naturally instead of the router maintaining a pending-turn state machine).
- Sensible-fallback route: when the router cannot confidently classify, it emits `"fallback"` with populated entities/slots and any `missing_required` slots. The main agent runs with a fallback playbook under the universal analyst stance, not the current silent-drop to base prompt.
- **Source enum matches existing codebase convention**: `"user" | "preference" | "default"` (aligned with `SlotSource` in `src/routing/types.ts`, `buildDisclosureBlock` labels in `src/prompts/workflow-prompts.ts`, and memory retrieval). NOT `"memory"`.
- **High-confidence-only preference writes**: only `confidence: "high"` `preference_updates` are persisted. Medium/low are dropped from storage (router can still surface them in `reasoning` for observability).
- **Assumptions block becomes router-owned**: moved out of per-workflow prompt builders into a shared renderer that reads `slots[].source`. Workflow and fallback routes both get a consistent Assumptions block.
- **Every turn is recorded**: `workflow_runs` gets a new `turn_type` column. Values are exactly `workflow` and `fallback`, matching the router's `route` field verbatim. For fallback turns, `workflow_type` is set to the sentinel `"fallback"` (satisfies the existing `NOT NULL` constraint without a column-type migration). Unclassified turns become queryable.
- **Router context window**: last 5 turns of conversation history + current investor_profile snapshot + 3 most recent `workflow_runs` summaries. Fixed window, matches existing `MAX_WORKFLOW_HISTORY_PER_TYPE = 3` pattern.
- **Evals split into two tiers**:
  - **Deterministic CI fixtures** (required): checked-in JSON fixtures with pre-recorded expected router outputs. Run in CI on every PR. Merge-gated on pass-rate. No live API calls.
  - **Opt-in live eval** (not CI-gated): a local script that runs the real router against sampled-and-anonymized real turns, compares against labeled expectations, and reports deltas. Developers run before PRs that touch router prompt/model; CI does not require it.
- Universal analyst stance (from `honest-analyst-stance`) applies to both routes.
- **BREAKING (internal)**: `classifyIntent` function signature and return type become internal-only, hidden behind a feature flag during rollout (see below). Any code importing `ClassificationResult`, `WorkflowType`, `ExtractedEntities` from `src/routing/` switches to the router's types. Public tool API unchanged.
- **BREAKING (schema)**: `workflow_runs` schema bump (`CURRENT_SCHEMA_VERSION` 2 → 3) to add `turn_type` column. Per AGENTS.md, schema changes require explicit approval — design.md lists this explicitly and the tasks require a maintainer OK before editing `sqlite.ts`. Migration strategy: additive `ALTER TABLE workflow_runs ADD COLUMN turn_type TEXT NOT NULL DEFAULT 'workflow'`. The current `resetSchema`-on-version-mismatch path would drop all rows and MUST be replaced with a real additive migration before shipping.
- **Rollout via `OPENCANDLE_ROUTER_MODE` flag**: `rules` remains the default for one release cycle. While the flag is in play, the rule path stays callable — the router code coexists with `classifyIntent` rather than replacing it. When the flag flips to `llm` as default and evals have been stable for a full cycle, a follow-up change removes the rule path entirely. This change does NOT delete `classifyIntent`.

## Capabilities

### New Capabilities
- `intent-routing`: LLM-based routing contract — input shape, output schema, route categories, provenance rules, preference-write confidence gating, and how `missing_required` is surfaced to the main agent.
- `router-evals`: two-tier eval harness for the router — deterministic CI fixtures and opt-in live-run fixtures, with clearly separated responsibilities.

### Modified Capabilities
- (none — `intent-routing` replaces a non-spec'd module; existing eval infra capabilities like `deterministic-evals` and `eval-baseline` remain untouched and may be referenced in design.md for shared patterns)

## Impact

- `src/routing/classify-intent.ts`: retained but callable only when `OPENCANDLE_ROUTER_MODE=rules`. Follow-up change removes it entirely.
- `src/routing/`: new `router.ts` + `router-prompt.ts` + `router-types.ts`; `entity-extractor.ts` and `slot-resolver.ts` either fold into router output or remain as typed helpers used by the rules path until removal.
- `src/memory/preference-extractor.ts`: callable only when `OPENCANDLE_ROUTER_MODE=rules`. Follow-up change removes it.
- `src/memory/storage.ts`, `src/memory/sqlite.ts`: additive schema migration, new `turn_type` column, full preservation of existing rows. Replaces the `resetSchema`-on-mismatch behavior with a real ALTER-based path for v2→v3.
- `src/pi/opencandle-extension.ts`: input handler branches on `OPENCANDLE_ROUTER_MODE`; router path dispatches through the new flow; rules path unchanged.
- `src/prompts/context-builder.ts`: shared Assumptions-block renderer; fallback playbook section added.
- `src/prompts/workflow-prompts.ts`: `buildDisclosureBlock` moves to the new shared renderer or becomes a thin adapter that consumes router output directly.
- `src/workflows/*.ts`: each workflow's prompt builder consumes the shared Assumptions renderer output instead of rendering locally.
- `tests/routing/`: existing rule tests retained until the rule path is removed; new router fixture + assertion tests added alongside.
- `tests/fixtures/router/`: new — deterministic fixtures checked in. Seeded from sampled + anonymized real turns but recorded (the router output captured once and then asserted against).
- `tests/scripts/run-live-router-eval.ts`: new — opt-in live eval script, not part of CI.
- Depends on: `honest-analyst-stance` landing first (specifically the stance fixes to `workflow-prompts.ts` and the workflow step prompts, which remove the disclaimer instructions that this change also needs to be gone).
- Adds a per-turn LLM call (Haiku-class) when the flag is flipped. Latency budget 300–800ms added to every turn; acceptable because most turns already make a main-agent LLM call.
