## 1. Route Contract and Manifest

- [x] 1.1 Add canonical route kind types for `workflow_dispatch`, `agent_task`, `clarification`, and `pass_through`.
- [x] 1.2 Add a route capability manifest covering route kinds, workflows, required slots, prompt playbooks, memory scopes, tool bundles, and legacy route mapping.
- [x] 1.3 Update router schema and prompt generation to emit and describe canonical route kinds from the manifest.
- [x] 1.4 Add compatibility adapters that derive legacy `route` and `workflow` values for existing consumers.

## 2. Deterministic Post-Processing

- [x] 2.1 Move legacy classify-intent use out of the primary LLM routing path and into validation/post-processing helpers.
- [x] 2.2 Validate LLM router output against the manifest and correct unsupported route, workflow, slot, and tool-bundle combinations.
- [x] 2.3 Normalize entities and symbols after the LLM router result without making a competing primary route decision.
- [x] 2.4 Compute `missing_required` from manifest slot policy and emit route diagnostics for all deterministic corrections.

## 3. Clarification Flow

- [x] 3.1 Route missing required information to `routeKind: "clarification"` when memory/defaults cannot safely fill the slots.
- [x] 3.2 Ensure clarification turns keep `ask_user` available and pass specific missing slot names into prompt assembly.
- [x] 3.3 Add tests for missing-symbol, missing-budget, and prior-context-resolved clarification cases.

## 4. Resolved Turn Context and Memory

- [x] 4.1 Add `ResolvedTurnContext` and build it after router post-processing.
- [x] 4.2 Wire prompt assembly and workflow dispatch to consume resolved context instead of independently interpreting raw router output.
- [x] 4.3 Add route-aware typed memory query planning for preferences, prior turns, workflow summaries, tool observations, and durable memory.
- [x] 4.4 Apply shared trust/staleness filtering to router-visible and analyst-visible memory.
- [x] 4.5 Record memory provenance and filtered-memory diagnostics in resolved context and traces.

## 5. Route Tool Bundles

- [x] 5.1 Define named tool bundles for core market data, options, macro, sentiment, SEC, and clarification.
- [x] 5.2 Select tool bundles from route kind, workflow, entities, and manifest policy.
- [x] 5.3 Add Pi active-tool snapshot/apply/restore handling for each turn when active-tool APIs are available.
- [x] 5.4 Add observe/report mode for selected bundles, active tools, and out-of-bundle tool attempts.
- [x] 5.5 Gate hard enforcement behind a flag or explicit rollout setting until evals are green.

## 6. Prompt, Trace, and Storage Updates

- [x] 6.1 Replace fallback playbook injection with route-kind playbook injection for `agent_task`, `workflow_dispatch`, `clarification`, and `pass_through`.
- [x] 6.2 Update shared assumptions rendering to use resolved context slot provenance.
- [x] 6.3 Record canonical route kind in traces and storage while preserving legacy route compatibility.
- [x] 6.4 Mark legacy classify-intent documentation and exports as deprecated for primary routing.

## 7. Evals and Validation

- [x] 7.1 Extend deterministic router fixtures to cover all four route kinds.
- [x] 7.2 Extend competitive harness reports with route kind, selected tool bundles, active tools, memory provenance, and clarification quality.
- [x] 7.3 Add unit tests for manifest validation and deterministic correction diagnostics.
- [x] 7.4 Run `npm test`.
- [x] 7.5 Run targeted harness prompts covering workflow dispatch, agent task, clarification, pass-through, and memory-backed context resolution.
