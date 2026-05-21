## Context

OpenCandle now defaults to the LLM router, while the legacy deterministic classifier is deprecated. The current router output still uses the old `workflow` and `fallback` route split, which was useful for initial rollout but is too coarse for the next stage. It cannot cleanly distinguish known workflow dispatch, ordinary agent work, clarification turns, and out-of-scope pass-through turns.

The routing issue also affects tool use and memory. Pi exposes an active-tool mechanism, but OpenCandle does not yet have a route-level policy that decides which tools should be visible for each turn. Memory retrieval is available, but router output, prompt assembly, workflow dispatch, and eval traces do not share a single typed object that records which memory categories were used and why.

This change makes the router a low-agency planner/classifier. The LLM decides the typed route and candidate slots; deterministic code validates, normalizes, fills safe defaults, and enforces policy.

## Goals / Non-Goals

**Goals:**

- Define a typed router contract with `workflow_dispatch`, `agent_task`, `clarification`, and `pass_through`.
- Keep deterministic code as validation, normalization, and policy enforcement rather than a competing router.
- Introduce a route capability manifest that drives router prompt constraints, dispatch behavior, required slots, tool bundles, and memory scopes.
- Scope active tools per route/workflow through Pi so the main agent has fewer irrelevant choices.
- Resolve one shared turn context for router handling, prompt assembly, memory retrieval, workflow dispatch, traces, and evals.
- Make memory use explicit, typed, and auditable.
- Extend tests and evals to measure route quality, tool scope, clarification quality, and memory use.

**Non-Goals:**

- Add a `direct_tool` route.
- Rewrite provider tools or analyst orchestration.
- Replace Pi memory storage or change SQLite schema unless implementation discovers an unavoidable migration.
- Auto-write new durable memory categories without separate approval.
- Remove legacy `workflow`/`fallback` adapters before compatibility tests prove the new route contract is stable.

## Decisions

### 1. Typed route kind replaces overloaded route values

The canonical router output will carry `routeKind` with one of:

- `workflow_dispatch`
- `agent_task`
- `clarification`
- `pass_through`

The legacy `route` field can remain as an adapter during rollout, derived from `routeKind` for older prompt and trace code. `workflow_dispatch` maps to legacy `workflow`; all other in-agent finance work maps to legacy `fallback` until consumers migrate.

Alternative considered: keep `workflow` and `fallback` and add more fields. That keeps compatibility but leaves too much behavior encoded in conventions. The typed route makes dispatch, clarification, and tool gating explicit.

### 2. Route capability manifest is the source of truth

Add a static manifest in routing code that declares:

- route kind
- allowed workflows
- required and optional slots
- allowed tool bundle names
- memory scopes
- prompt playbook identifier
- legacy route mapping

The router prompt, post-processing validator, workflow dispatch, prompt assembly, and eval assertions should consume the manifest instead of duplicating route rules.

Alternative considered: hardcode policy in each consumer. That is faster initially but makes route changes brittle and harder to evaluate.

### 3. Deterministic layer becomes post-processing

The deterministic classifier should no longer decide the primary route when the LLM router is enabled. It should:

- parse and validate JSON
- retry malformed router outputs once
- normalize symbols and entities
- enforce route/workflow/slot combinations from the manifest
- compute missing required slots
- reject unsupported tool bundles
- emit diagnostics when the LLM output was corrected

Alternative considered: deterministic router first, LLM fallback second. That is attractive for latency but regresses on nuanced prompts and keeps two route sources of truth.

### 4. Clarification is a route outcome

When required data is missing and no safe default or remembered value is available, the router emits `routeKind: "clarification"` with `missing_required` and suggested question metadata. The main agent still uses `ask_user`; the router does not execute the question itself.

Alternative considered: keep clarification as a prompt hint. The current approach works, but it is hard to test and easy for the main agent to skip.

### 5. Tools are scoped by route and workflow

Define named tool bundles, for example:

- `core_market`: quote, ticker search, fundamentals basics
- `options`: option chains and options-related market data
- `macro`: FRED and macro indicators
- `sentiment`: Reddit, news/web sentiment, fear-greed
- `sec`: SEC filing tools
- `clarification`: `ask_user`

At turn start, the session snapshots the current active tools, applies the selected bundle, runs the agent or workflow, then restores the previous active tool set. `ask_user` remains available whenever clarification may be needed.

Alternative considered: expose all tools and rely on prompt text. Prior harness results already show tool selection is a material quality lever, so explicit scope is more testable.

### 6. Resolved turn context joins routing, memory, and prompts

Introduce a `ResolvedTurnContext` built after router post-processing and before prompt assembly. It should contain:

- raw user input and prior-turn window
- canonical `routeKind`
- legacy route mapping while needed
- selected workflow, if any
- normalized entities and slots with source provenance
- missing required slots
- selected tool bundles and active tool names
- memory query plan and retrieved memory snippets by category
- prompt playbook identifier
- diagnostics and correction events

The context is the object written to traces and passed into eval reporting.

Alternative considered: keep adding fields to router output. Router output should remain the model-facing contract; resolved turn context is the application-facing contract.

### 7. Memory retrieval is typed and route-aware

Memory should be retrieved according to the manifest and resolved context. Preferences, prior turns, workflow summaries, tool observations, and durable user memory remain separate categories. Each retrieved item carries category, source, timestamp, relevance, and trust/staleness metadata.

Router-visible memory and analyst-visible memory must use the same filtering rules for stale or low-trust content. The router may use memory to fill slots only when the slot source is recorded as `preference` or `memory` and the context records the exact source.

Alternative considered: generic RAG for all router prompts. That makes memory hard to trust and hard to debug.

### 8. Rollout uses adapter compatibility

The implementation should preserve current behavior behind adapters:

- Generate `routeKind` as canonical.
- Derive legacy `route` and `workflow` fields where existing code still expects them.
- Add eval coverage before enforcing hard tool bundle limits.
- Keep `OPENCANDLE_ROUTER_MODE=rules` as fallback comparison mode, but document that deterministic classify intent is deprecated for primary routing.

Alternative considered: one-step migration. Too much routing, prompt, memory, and Pi code changes at once would make regressions difficult to isolate.

## Risks / Trade-offs

- Route-kind churn can break existing workflow dispatch -> Mitigation: keep legacy route adapters until tests cover all current workflows.
- Tool bundles can hide a tool needed for a valid answer -> Mitigation: begin with observe/report mode for bundle violations, then enforce after harness coverage is green.
- Memory use can introduce stale assumptions -> Mitigation: typed provenance, staleness filtering, and assumptions rendering are part of the resolved context.
- More routing structure can increase implementation complexity -> Mitigation: centralize policy in one manifest and keep route kinds intentionally small.
- Clarification can become over-eager -> Mitigation: eval prompts must include cases where remembered preferences or safe defaults avoid unnecessary questions.

## Migration Plan

1. Add route kind types, manifest, and compatibility adapters.
2. Update router prompt and schema to emit typed route kinds.
3. Move deterministic classifier use into post-processing and diagnostics.
4. Add resolved turn context and wire prompt assembly to consume it.
5. Add route-aware memory query planning and provenance.
6. Add route tool bundle policy in observe/report mode.
7. Extend unit tests and harness evals for route kind, clarification, memory, and tool scope.
8. Turn on active-tool enforcement once the eval suite proves no expected tool is hidden.
9. Remove or further deprecate legacy route consumers in a later change.

Rollback is to keep the compatibility adapter and return to current legacy route handling by switching router schema consumers back to derived `workflow`/`fallback` values. Tool enforcement should be gated separately so it can be disabled without reverting the route contract.

## Open Questions

- Should `pass_through` still allow `ask_user`, or should it use a no-tool answer path unless the user explicitly asks a finance follow-up?
- Which memory categories are safe for router-visible prompts in the first enforcement rollout?
- Should active tool changes be scoped per user turn only, or also per workflow sub-step when workflows become more complex?
