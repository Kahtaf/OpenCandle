## Context

Current state (after reading `src/routing/classify-intent.ts`, `src/memory/preference-extractor.ts`, `src/memory/manager.ts`, `src/memory/retrieval.ts`, `src/memory/storage.ts`, `src/memory/sqlite.ts`, `src/runtime/session-coordinator.ts`, `src/prompts/workflow-prompts.ts`, and `src/pi/opencandle-extension.ts`):

- `classifyIntent` is ~15 hand-written regex rules covering 6 workflow types. Queries outside those patterns fall to `"unclassified"` and receive no workflow-specific prompt context.
- `extractPreferences` is 10 regex patterns in `preference-extractor.ts`. "6 month horizon" doesn't match ("12 month" / "long-term" / "short-term" do). "aggressive investor" doesn't match. DCA language doesn't map at all.
- Memory hydration IS wired for unclassified queries (`WORKFLOW_RELEVANT_CATEGORIES["unclassified"] = ["investor_profile"]`) — but the Assumptions block is only rendered by workflow-specific prompt builders (`src/prompts/workflow-prompts.ts::buildDisclosureBlock`), so unclassified queries get profile-as-background-text with no explicit "anchor on this" instruction.
- `SlotSource` in `src/routing/types.ts` is `"user" | "preference" | "default"` and `buildDisclosureBlock` uses labels `User-specified` / `From saved preferences` / `Defaults`. The router spec must match this convention, not introduce a new "memory" value.
- `recordWorkflowRun` is only called inside workflow branches (`opencandle-extension.ts:441,451,466`). Unclassified turns are invisible to `workflow_history` memory.
- `extractAndStorePreferences` runs on every turn *before* prompt assembly, so same-turn extracted preferences do propagate to the same-turn system prompt — but the extractor is too weak to catch most real phrasings.
- `workflow_runs.workflow_type` is `TEXT NOT NULL`. Adding a `turn_type` column is additive; widening or relaxing `workflow_type` would require a table-rebuild migration (SQLite) which we want to avoid.
- `search_ticker` is an existing AgentTool (`src/tools/market/search-ticker.ts`) available to the main agent. `normalizeSymbol` is a local helper in `src/analysts/orchestrator.ts` — not a registered tool. The router cannot "call `normalize_symbol` as a tool" without new infrastructure.

Changing `honest-analyst-stance` (change A) fixes the refusal posture and removes disclaimer directives from workflow prompts. This change (B) fixes the routing + extraction + provenance substrate beneath it.

## Goals / Non-Goals

**Goals:**
- Single LLM router call replaces both `classifyIntent` and `extractPreferences`.
- Every turn produces a typed router output: route + entities + slots with provenance + preference_updates + missing_required.
- Fallback route (for queries outside the workflow taxonomy) receives a real playbook, not a silent drop to base prompt.
- Assumptions block renders uniformly — workflow and fallback routes both get one, owned by a shared renderer.
- Every turn is recorded (new `turn_type` column on `workflow_runs`), migrated additively with no data loss.
- Two eval tiers: deterministic CI fixtures (merge-gated) and opt-in live-run fixtures (local dev use).

**Non-Goals:**
- Replacing the main-agent LLM or its tool-calling. Router is a pre-pass.
- Router-side tool execution. v1 has zero router tools. A `direct_tool` route is not part of this change.
- Router-side clarifier state machine. Main agent's existing `ask_user` AgentTool handles clarification. A `needs_clarification` route is not part of this change.
- Removing `classifyIntent` and `extractPreferences`. Both are retained behind the rollout flag and removed in a follow-up change after the flag has been flipped for a full release cycle.
- Adding multi-turn workflows or long-running conversations as a new concept.
- Implementing the universal analyst stance (that is change A; this change consumes it).
- Adding a `/forget` command or profile editor UI (follow-up work).

## Decisions

### 1. Single structured-output LLM call

- **Considered**: (a) chain of classifier → slot resolver → preference extractor as separate LLM calls; (b) one call emitting full JSON.
- **Chosen**: (b).
- **Why**: atomic provenance (the same call that classifies also names sources). Lower latency envelope than three sequential calls. Easier to evaluate as a single unit.

### 2. Haiku-class model for the router

- **Considered**: Haiku 4.5, Opus 4.7, or reusing the main-agent model.
- **Chosen**: start with Haiku 4.5.
- **Why**: structured classification with conversational extraction is Haiku-strength. Latency budget favors the smaller model. Measure p50/p95 and fixture pass-rate; revisit if evals show consistent failure modes.

### 3. Zero router tools in v1

- **Considered**: (a) no tools; (b) lookup tools only; (c) full tool access.
- **Chosen**: (a).
- **Why**: the expected tools (`normalize_symbol`) do not exist as registered AgentTools in the codebase. `normalizeSymbol` is a local helper and `search_ticker` is a main-agent tool. Wiring a router-safe tool surface is extra infrastructure this change doesn't need. Pure-text classification is sufficient to demonstrate the router value and keeps evals deterministic (no tool mocking). If evals reveal ticker disambiguation materially hurts accuracy, a follow-up change wires a router-safe tool set.

### 4. Two routes, `workflow` and `fallback`

- **Considered**: (a) two routes (workflow | fallback); (b) four routes (workflow | direct_tool | fallback | needs_clarification).
- **Chosen**: (a).
- **Why**:
  - `direct_tool`: no defined execution path. Main agent already handles "AAPL quote" cleanly via its tool-calling loop. Adding extension-side tool execution duplicates a solved problem and introduces a new surface (who executes, how does the result get composed with the assistant response, how is the tool call visible to the user). Punted to a follow-up change if evals show enough simple-fetch turns to be worth the cost.
  - `needs_clarification`: the main agent's `ask_user` AgentTool already handles clarification with the correct abstraction (a mid-response tool call surfaced through Pi's existing prompt infrastructure). A router-level clarifier would need a pending-turn state machine, extension-level `promptUser` integration, and parallel test coverage for UI and headless modes. Instead, the router emits `missing_required: string[]` and the main-agent prompt includes "these required slots are missing; use ask_user to collect them before committing." Main agent asks via its normal tool flow. One primitive, one failure mode.

### 5. `turn_type` enum matches `route` verbatim

- `turn_type` values are exactly `"workflow"` and `"fallback"` — identical to the router's `route` field. This eliminates cross-field enum drift (the v1 of this proposal had `direct_tool_call` on one side and `direct_tool` on another; that bug is removed by scoping to two routes).
- For fallback turns, `workflow_type` is set to the sentinel `"fallback"` so the existing `NOT NULL` constraint is satisfied without a column-type migration. Queries that want to count fallbacks use `turn_type = 'fallback'`; queries that want to count a specific workflow use `workflow_type = '<name>' AND turn_type = 'workflow'`.
- **Why**: additive migration only (`ALTER TABLE ... ADD COLUMN turn_type TEXT NOT NULL DEFAULT 'workflow'`). Existing rows default to `turn_type = 'workflow'`, which is correct since every existing row came from a workflow dispatch. No data loss, no table rebuild.

### 6. High-confidence-only preference writes

- **Considered**: (a) write all with confidence tag; (b) high-only; (c) tiered TTL by confidence.
- **Chosen**: (b).
- **Why**: low-confidence noise decays user trust. 90-day `STALENESS_THRESHOLDS` already handles slow drift. Medium/low extractions can still surface in `reasoning` for observability and in the main-agent prompt as non-persistent hints.

### 7. Prior-turn context: last 5 turns, fixed window

- **Considered**: no history, sliding semantic summary, last N turns.
- **Chosen**: last 5 turns verbatim.
- **Why**: matches existing fixed-window pattern in `MemoryManager.retrieve` (`MAX_WORKFLOW_HISTORY_PER_TYPE = 3`, `MAX_PREFERENCE_LINES = 15`). Cheap, predictable, easy to evaluate. Widen if evals show context-dependent queries failing.

### 8. Source enum matches existing codebase: `user | preference | default`

- **Considered**: introducing a new `"memory"` source value.
- **Chosen**: use the existing `SlotSource` from `src/routing/types.ts`: `"user" | "preference" | "default"`.
- **Why**: `buildDisclosureBlock` in `src/prompts/workflow-prompts.ts` is already wired to these exact labels. The memory retrieval path (`src/memory/manager.ts`, `src/memory/retrieval.ts`) uses `preference` as the source tag. Introducing `"memory"` would bifurcate the vocabulary for no reason. Router output adopts the existing convention.

### 9. Universal fallback playbook

- When `route = "fallback"`, the main agent receives: universal analyst stance (from change A), Assumptions block rendered from router output, and a fallback playbook section: "you have these symbols and context; tool-first; commit with reasoning, confidence, invalidation. If `missing_required` is non-empty, call ask_user before committing."
- Alternative: leave fallback = base prompt only (current silent-drop). Rejected because the refusal bug lived there.

### 10. Shared Assumptions-block renderer

- Single renderer reads `slots[].source` from router output and produces the canonical Assumptions block. Workflow and fallback routes both consume it.
- `buildDisclosureBlock` in `src/prompts/workflow-prompts.ts` becomes either (a) a thin adapter that takes the router output directly, or (b) is replaced by a new module (`src/prompts/assumptions-block.ts`) that workflow builders and the fallback path both call.

### 11. Two eval tiers

- **Deterministic CI fixtures** (checked in, merge-gated): each fixture is `{ input, priorTurns, profileSnapshot, expectedRouterOutput, tags }`. The `expectedRouterOutput` is a recorded snapshot — generated once by running the real router, reviewed by a human, then committed. CI does NOT call the real router; it calls the router code with a mocked LLM response matching the recorded snapshot, or it asserts against the pure-text routing prompt construction. This keeps CI deterministic, fast, and free of API dependencies.
- **Opt-in live eval** (local, not CI): a script `tests/scripts/run-live-router-eval.ts` that runs the real router against the sampled-real-turn fixtures, compares against `expectedRouterOutput` with tolerance for the `reasoning` field, and reports deltas. Developers run this before PRs touching router prompt/model. It measures p50/p95 latency and fixture pass-rate against a labeled baseline.
- **Why split**: the original spec conflated the two. "Merge-gate on real-model pass-rate" can't run in CI without live API access, which we don't want as a hard CI dependency. Separating them lets CI stay deterministic while keeping a real-model evaluation available where it belongs.

### 12. Rollout flag

- `OPENCANDLE_ROUTER_MODE` env var, values `rules` (default) and `llm`.
- When `rules`: existing `classifyIntent` + workflow-branch cascade + regex `extractPreferences` run unchanged. Router code is present but inert.
- When `llm`: router runs; `classifyIntent` and `extractPreferences` are skipped; turn is recorded with `turn_type` populated.
- The flag-flipping cutover and the code-removal cutover are **two separate changes**. This change coexists with the rule path. A follow-up change (`remove-rule-router`) deletes `classify-intent.ts` and `preference-extractor.ts` after the flag has been flipped for a full release cycle.

### 13. Router output schema

```ts
interface RouterOutput {
  route: "workflow" | "fallback";
  workflow?: WorkflowType;
  entities: {
    symbols: string[];
    direction?: "bullish" | "bearish";
    budget?: number;
    timeHorizon?: string;
  };
  slots: Record<string, {
    value: unknown;
    source: "user" | "preference" | "default";
    confidence: "high" | "medium" | "low";
  }>;
  preference_updates: Array<{
    key: string;
    value: string;
    confidence: "high" | "medium" | "low";
    source: "inferred";
  }>;
  missing_required: string[];
  reasoning: string;
}
```

- **Why this shape**: mirrors existing types (`ClassificationResult`, `ExtractedEntities`, `SlotResolution`, `SlotSource`) to minimize consumer churn. Provenance is per-slot so the shared Assumptions renderer can label each line. `reasoning` is a free-text field for evals and debugging, never user-visible.

## Risks / Trade-offs

- **[Risk]** Router latency adds 300–800ms per turn. **Mitigation**: Haiku-class model, streaming where applicable, measure p50/p95 in opt-in live evals. If unacceptable, consider a rules-first fast-path for unambiguous patterns (`^<TICKER> quote$`), but start without it.
- **[Risk]** Router misclassifies with high confidence. **Mitigation**: deterministic fixtures catch systematic failures; opt-in live evals catch real-model regressions. Fallback playbook + universal analyst stance ensure the main agent can still answer even when classification is wrong.
- **[Risk]** Structured output parse failures. **Mitigation**: JSON schema validator + one retry with error feedback + fallback to emitting a minimal router output (`route: "fallback"`, entities extracted via a cheap regex pass, empty slots) on persistent failure.
- **[Risk]** Schema migration drops all data if the current `resetSchema` path runs. **Mitigation**: replace the current path with a real additive migration; verify against an existing dev DB before merging. Task 2 requires explicit maintainer sign-off before schema edits land.
- **[Risk]** Router extracts a wrong preference at high confidence, polluting memory. **Mitigation**: high-confidence gate + 90-day staleness. Follow-up work for a `/forget` command to correct.
- **[Risk]** Fixed 5-turn context window too narrow for context-heavy queries ("what about at $20k?"). **Mitigation**: opt-in live evals measure this; widen if failures surface.
- **[Risk]** Existing consumers of `classifyIntent`, `WorkflowType`, `ClassificationResult` break. **Mitigation**: during rule-mode they're untouched; during llm-mode the router output types replace them. Grep all call sites during implementation.
- **[Trade-off]** Accepts LLM non-determinism in routing in exchange for massively wider coverage. Evals (both tiers) are how we keep the failure mode bounded.

## Migration Plan

1. Land `honest-analyst-stance` first so universal stance is available and workflow prompts have disclaimer instructions removed.
2. Explicit maintainer sign-off on schema change (AGENTS.md "ask first").
3. Implement additive schema migration for `turn_type` column (do NOT rely on `resetSchema`). Test migration on a real dev DB copy before merging.
4. Write the router prompt + module (`src/routing/router.ts`, `src/routing/router-prompt.ts`, `src/routing/router-types.ts`).
5. Implement shared Assumptions-block renderer (either adapt `buildDisclosureBlock` or introduce `src/prompts/assumptions-block.ts`).
6. Add `OPENCANDLE_ROUTER_MODE` flag plumbing in `src/config.ts` and `src/pi/opencandle-extension.ts`.
7. Wire router into `pi.on("input")` behind the flag. Rules path stays intact and continues to be exercised when flag is default.
8. Implement fallback playbook section in `src/prompts/context-builder.ts`.
9. Build deterministic CI fixture format + runner.
10. Seed ~50 deterministic fixtures (sampled real turns, anonymized, router output recorded). Commit them with the PR.
11. Build the opt-in live eval script. Document how to run it.
12. Add router tests; keep rule tests alive.
13. Live-run the ASTS entry-levels query with `OPENCANDLE_ROUTER_MODE=llm` and verify: router output is `route: "fallback"` with `entities.symbols = ["ASTS"]` and `timeHorizon: "6mo"`, main agent commits under the analyst stance.

**Rollback**: flip `OPENCANDLE_ROUTER_MODE` back to `rules` (default stays `rules` during rollout, so no action needed). Schema rollback requires a manual down-migration — document but don't implement unless needed. No data loss on the forward path since the migration is additive.

## Open Questions

- Router model choice: Haiku-4.5 vs something smaller. Measure latency + accuracy in opt-in live evals; revisit after initial fixture pass.
- Fixture labeling: manual-only vs. stronger-model-assisted first pass with human review. Lean toward the latter for the seed set.
- Router observability: each turn persists the full router JSON as an `opencandle-router` session entry for debugging. Confirm the shape with Pi's `appendEntry` semantics during implementation.
- Should the router prompt itself be cached (Anthropic prompt caching) given it's static + high-volume? Likely yes; verify with the live eval harness once router is wired.
- Follow-up change (`remove-rule-router`) scope and timing — out of scope here but worth anticipating.
