## Why

OpenCandle's routing direction is converging on a useful shape, but the current contract still overloads the router in ways that make behavior hard to improve:

- `workflow` versus `fallback` mixes true workflow dispatch with ordinary agent work.
- The deterministic classifier can look like a competing router even though the LLM router is now the default.
- Missing-slot clarification is represented as a hint to the main agent rather than a first-class route outcome.
- All tools remain visible too often, so tool selection quality depends on prompt discipline instead of an explicit scoped capability policy.
- Pi memory is available, but router and prompt code do not yet share a single typed turn context that explains what memory was retrieved, why it was retrieved, and whether it is safe to use.

Research across open source coding and agent systems points to a consistent design: use a small typed router/planner contract, keep deterministic code as validation and normalization, expose only the tools needed for the current route, and treat memory as typed state rather than generic retrieval.

## What Changes

- Replace the overloaded two-value route contract with typed route kinds:
  - `workflow_dispatch`: a known OpenCandle workflow should run.
  - `agent_task`: the main agent should answer using scoped tools and route-aware context.
  - `clarification`: required information is missing and should be collected before analysis.
  - `pass_through`: the request is outside OpenCandle's finance task surface and should not receive finance tool bundles.
- Introduce a route capability manifest as the source of truth for route kinds, supported workflows, required slots, allowed tool bundles, memory scopes, and prompt playbooks.
- Reframe deterministic routing code as a validator/post-processor for the LLM router: JSON repair, schema validation, entity normalization, missing-slot enforcement, tool-bundle validation, and observability.
- Add route-level tool bundles and activate them through Pi's active-tool mechanism so the main agent does not see every registered tool on every turn.
- Add a resolved turn context object that is shared by router output handling, prompt assembly, workflow dispatch, memory retrieval, and trace/eval output.
- Make memory use route-aware and typed: preferences, prior turns, workflow summaries, tool observations, and durable user memory stay distinct and carry provenance.
- Promote clarification to an explicit router outcome instead of relying on fallback prose.
- Extend router and competitive evals to report route kind accuracy, missing-slot quality, active tool scope, memory provenance, and unnecessary tool exposure.

## Capabilities

### New Capabilities

- `route-tool-bundles`: Route and workflow-specific tool bundle policy with Pi active-tool activation.
- `turn-context-resolution`: Shared resolved turn context and typed memory provenance for router, prompt, workflow, and eval paths.

### Modified Capabilities

- `intent-routing`: Typed route kinds, first-class clarification, deterministic post-processing, and manifest-driven routing replace the overloaded `workflow`/`fallback` contract.
- `router-evals`: Eval coverage expands from router-output snapshots to typed route, tool-scope, clarification, and memory-use metrics.

## Impact

- Affected code areas:
  - `src/routing/`
  - `src/prompts/`
  - `src/workflows/`
  - `src/memory/`
  - `src/pi/`
  - `tests/evals/`
  - `tests/harness/`
- Affected specs:
  - `intent-routing`
  - `router-evals`
  - `route-tool-bundles`
  - `turn-context-resolution`
- Migration notes:
  - Keep legacy `route: "workflow" | "fallback"` compatibility only as an adapter during rollout.
  - Do not add a generic `direct_tool` route; ordinary tool use remains owned by the main agent under `agent_task`.
  - Do not remove the deterministic router code immediately; mark legacy classification as deprecated and reuse deterministic logic as post-processing guardrails.
  - Tool bundles should start in observe/report mode where practical, then move to enforcement once eval coverage proves the scope is correct.
