## Why

OpenCandle's agent quality is bottlenecked by its runtime architecture, not its tool coverage. Workflows execute as queued prompt strings (`initialPrompt` + `followUps`), memory is dumped wholesale into every turn, analyst outputs are prose piled into a shared thread, and validation is LLM-only. These weaknesses compound: the runtime cannot inspect, recover, cancel, or validate workflow execution, and it quietly misrepresents certainty when provenance is implicit. Fixing these fundamentals — informed by the architectural patterns documented in `docs/claude-code-principles-for-opencandle.md` — is prerequisite to every future capability.

## What Changes

- **Replace prompt-queue workflow execution with a typed WorkflowRunner** that owns run IDs, typed step definitions, step-level state, cancellation, and completion. Drop `queuePromptSequence()` and the polling/settlement machinery.
- **Introduce runtime-wide structured provenance** so every slot value, fetched data point, and computed metric carries its source (`user`, `preference`, `default`, `fetched`, `computed`, `unavailable`). Extend the existing `SlotSource` type into a general-purpose `Provenance` contract consumed by synthesis and validation.
- **Add a deterministic validation layer** that runs before LLM validation: verify cited numbers came from tool results, verify timestamps exist for market-sensitive values, verify options expiries are grounded against today's date, and verify missing data is labeled rather than implied.
- **Replace bulk memory dumping with selective, typed memory retrieval** — split memory into investor profile, interaction feedback, workflow history, and references, with staleness rules (risk preferences persist; market theses decay; specific prices are never trusted from memory).
- **Refactor the system prompt into composable, budgeted sections** so workflow-specific instructions, memory context, tool catalog, and safety rules are assembled dynamically rather than concatenated as one monolithic string.
- **Make graceful degradation a runtime contract** — provider failures produce structured `unavailable` fields, non-critical workflow legs continue on partial data, and repeated retries on the same failing provider are blocked centrally.
- **Convert analyst outputs to structured evidence records** with typed contracts per analyst role, so synthesis consumes structured objects rather than prior freeform text.
- **Add lightweight workflow event logging** — append-only events (`workflow_started`, `slot_resolved`, `tool_called`, `tool_failed`, `validation_failed`, `workflow_completed`) persisted to SQLite for debuggability.
- **Decompose the extension** — split `opencandle-extension.ts` into thin Pi integration + `SessionCoordinator` + `WorkflowRunner` + `PromptContextBuilder` + `MemoryManager`.

## Capabilities

### New Capabilities
- `workflow-runner`: Typed workflow execution engine with run IDs, step definitions, state transitions, cancellation, and supersession. Replaces `queuePromptSequence`.
- `structured-provenance`: Runtime-wide provenance tracking for slot values, fetched data, computed metrics, and memory recalls. Extends existing `SlotSource`.
- `runtime-validation`: Deterministic validation layer that verifies numbers, timestamps, and data availability before LLM validation.
- `selective-memory`: Typed, query-relevant memory retrieval with staleness rules and freshness metadata. Replaces bulk memory dumping.
- `composable-prompts`: Section-based system prompt assembly with per-section budgets and dynamic composition.
- `graceful-degradation`: Structured provider failure handling, partial execution contracts, and central retry blocking.
- `structured-analysts`: Typed evidence records for analyst outputs with per-role input/output contracts consumed by synthesis.
- `workflow-events`: Append-only workflow event logging to SQLite for debuggability.

### Modified Capabilities
<!-- No existing specs to modify — openspec/specs/ is empty -->

## Impact

- **Core runtime**: New `src/runtime/` module with workflow runner, validation, evidence types, and prompt context builder.
- **Extension layer**: `src/pi/opencandle-extension.ts` reduced to thin Pi integration; orchestration moves to `src/runtime/`.
- **Memory system**: `src/memory/` refactored for typed categories and selective retrieval. Schema additions to SQLite (new tables for typed memory and workflow events).
- **Analyst orchestration**: `src/analysts/orchestrator.ts` restructured to produce typed evidence records instead of prompt sequences.
- **Prompt system**: `src/system-prompt.ts` replaced by `src/prompts/sections.ts` with composable section builders.
- **Routing/types**: `src/routing/types.ts` `SlotSource` generalized into runtime-wide `Provenance` type.
- **Workflow builders**: `src/workflows/*.ts` updated to produce typed step definitions instead of `WorkflowPlan { initialPrompt, followUps }`.
- **Provider wrappers**: `src/providers/` updated to return structured unavailable fields on failure.
- **No external API changes** — all changes are internal runtime architecture.
- **No new dependencies expected** — uses existing `better-sqlite3`, TypeBox, and Pi extension APIs.
