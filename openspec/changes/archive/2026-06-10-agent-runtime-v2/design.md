## Context

OpenCandle is a financial analysis agent running as a Pi shell extension. Its current runtime has several structural weaknesses:

- **Workflow execution** uses `queuePromptSequence()` in `opencandle-extension.ts` — a chain of prompt strings submitted one-at-a-time with polling-based settlement detection. There is no step-level state, no typed step definitions, no cancellation beyond sequence-ID checking.
- **Memory** is dumped wholesale via `buildMemoryContext()` — all preferences and recent workflow runs are injected every turn with no relevance filtering or staleness awareness.
- **System prompt** is a single string in `system-prompt.ts` with memory and third-party tools concatenated. No section budgets, no dynamic composition.
- **Analyst orchestration** in `orchestrator.ts` produces prompt strings per analyst role. Outputs are prose in a shared conversation thread — synthesis reads prior freeform text, not structured evidence.
- **Validation** is a single LLM prompt (`VALIDATION_PROMPT`) appended after synthesis. No deterministic checks.
- **Provenance** exists for slots (`SlotSource: "user" | "preference" | "default"`) but not for fetched data, computed metrics, or memory recalls.
- **Provider failures** are handled inconsistently — some tools gracefully degrade, others silently omit data.

The extension file (`opencandle-extension.ts`, 271 lines) owns session init, memory init, preference extraction, intent classification, workflow dispatch, system prompt augmentation, and prompt settlement — all in one module.

## Goals / Non-Goals

**Goals:**

- Replace prompt-queue execution with a typed workflow runner that supports step-level state, cancellation, and partial completion
- Make provenance a runtime-wide contract covering all data sources, not just slots
- Add deterministic validation before LLM validation
- Make memory retrieval selective and staleness-aware
- Decompose the monolithic system prompt into composable sections
- Make provider failure handling a structured runtime contract
- Convert analyst orchestration to produce and consume typed evidence records
- Add lightweight workflow event logging for debuggability
- Decompose the extension into focused modules

**Non-Goals:**

- Sub-agent isolation or parallel agent execution (stabilize single-agent first)
- Reusable playbook/skill layer for external contributors (P2, deferred)
- Tool metadata enrichment (premature without workflow runner to consume it)
- Feature flag infrastructure (add ad hoc when needed)
- Shell sandboxing or OS-level permissions (not relevant to OpenCandle's problem space)
- Changing the Pi extension API contract or upstream Pi framework
- Token-level prompt budgeting or compaction (add section budgets first, token counting later)

## Decisions

### D1: Workflow runner as a state machine, not a coroutine or queue

**Decision**: Implement `WorkflowRunner` as an explicit state machine with a `WorkflowStep[]` plan, a step index, and typed state transitions (`pending → running → completed | failed | skipped`).

**Rationale**: The current prompt queue has no inspectable state — the runtime cannot know what step it's on, what has completed, or what to cancel. A state machine makes every transition explicit and persistent. Coroutines were considered but they don't persist naturally across turns and are harder to cancel mid-flight.

**Alternative considered**: Keep prompt queuing but add step metadata alongside. Rejected because the fundamental issue is that prompt strings aren't inspectable — wrapping them in metadata doesn't fix the control flow problem.

### D2: Steps produce structured outputs, not prompt text

**Decision**: Each workflow step declares typed inputs and outputs. Step outputs are structured records (e.g., `EvidenceRecord`, `ValidationResult`) stored on the run, not appended as conversation text.

**Rationale**: When analyst outputs are prose in a shared thread, synthesis has no structured contract to consume. Structured outputs enable deterministic validation, evidence citation, and debuggable event logs.

**Alternative considered**: Parse structured data from LLM prose responses. Rejected as fragile and not deterministic.

### D3: Provenance as a tagged union, extending SlotSource

**Decision**: Generalize `SlotSource` into a `Provenance` type: `{ source: "user" | "preference" | "default" | "fetched" | "computed" | "unavailable"; timestamp?: string; provider?: string; confidence?: number }`. Attach provenance to all values flowing through the runtime.

**Rationale**: The existing `SlotSource` pattern is the right shape — it just needs broader coverage. A tagged union keeps it simple and composable. Adding `timestamp` and `provider` enables freshness and attribution checks.

**Alternative considered**: A separate provenance log indexed by value ID. Rejected as over-engineered — co-locating provenance with values is simpler and sufficient.

### D4: Selective memory retrieval via category + query relevance

**Decision**: Split memory into four typed categories (investor profile, interaction feedback, workflow history, references). At retrieval time, select only categories relevant to the current workflow and apply staleness rules per category.

**Rationale**: The current `buildMemoryContext()` dumps everything. As memory grows, this creates noise and contradictions. Category-based selection with staleness rules is simple and doesn't require embedding similarity search (which would be premature).

**Staleness rules**:
- Investor profile (risk tolerance, goals): long-lived, months
- Interaction feedback: medium-lived, weeks
- Workflow history: recent only, last N runs per workflow type
- Market theses / specific prices: never trusted from memory

**Alternative considered**: Embedding-based similarity search. Rejected as premature — category filtering with staleness rules solves the immediate problem without adding vector DB complexity.

### D5: Composable prompt sections with static + dynamic split

**Decision**: Replace the monolithic `buildSystemPrompt()` with a `PromptContextBuilder` that assembles named sections: `base-role`, `safety-rules`, `tool-catalog`, `workflow-instructions`, `memory-context`, `provider-status`, `output-format`. Each section has a character budget. Workflow-specific instructions are injected only when a workflow is active.

**Rationale**: The current approach concatenates everything into one string in two places (system-prompt.ts and the extension's `before_agent_start` hook). Sections make it possible to budget, cache stable content, and vary dynamic content per turn.

**Alternative considered**: Multiple system messages. Rejected because Pi's API expects a single system prompt augmentation.

### D6: Deterministic validation before LLM validation

**Decision**: Add a `RuntimeValidator` that runs after tool execution and before LLM synthesis/validation. It performs deterministic checks: (1) numbers in outputs match tool result values, (2) timestamps exist for market-sensitive data, (3) options expiries are grounded against today's date, (4) required fields are present or explicitly marked unavailable.

**Rationale**: The current `VALIDATION_PROMPT` asks the LLM to self-check — but LLMs confabulate consistently, so self-validation has low detection rate. Deterministic checks on structured evidence catch the easy failures reliably.

**Alternative considered**: Only improve the LLM validation prompt. Rejected because the problem is structural — LLM-only validation cannot reliably catch fabricated numbers.

### D7: Graceful degradation via structured unavailability

**Decision**: Provider wrappers return a result union: `ProviderResult<T> = { status: "ok"; data: T; timestamp: string } | { status: "unavailable"; reason: string; provider: string }`. The workflow runner treats `unavailable` as a valid step output — non-critical legs continue, critical legs fail the step (not the run).

**Rationale**: Today some providers throw, some return partial data, some silently omit fields. Standardizing the failure shape lets the workflow runner make consistent decisions about continuation vs. failure.

### D8: Event logging to existing SQLite, not a new store

**Decision**: Add a `workflow_events` table to the existing SQLite database. Events are append-only rows: `(run_id, step_index, event_type, payload_json, timestamp)`. No external telemetry.

**Rationale**: The database and migrations infrastructure already exist. Adding a table is minimal work. Append-only events are cheap and make workflow failures debuggable from storage.

### D9: Extension decomposition via delegation, not new Pi APIs

**Decision**: Keep `opencandle-extension.ts` as the Pi integration point but reduce it to tool registration, command registration, and event delegation. Move orchestration to `SessionCoordinator` (session lifecycle, memory init), `WorkflowRunner` (step execution), `PromptContextBuilder` (prompt assembly), and `MemoryManager` (retrieval, staleness).

**Rationale**: The extension currently owns too many concerns (271 lines, 6+ responsibilities). Decomposing into focused modules improves testability and makes each concern independently evolvable. No changes to Pi's extension API are needed.

## Risks / Trade-offs

**[Structured outputs require LLM cooperation]** → The workflow runner can define typed output contracts, but the LLM may not produce conforming responses. Mitigation: Use structured output contracts as guidance in step prompts; add parsing with fallback to raw text; log parsing failures as events.

**[Migration complexity during the transition]** → Existing workflows (portfolio builder, options screener, compare assets, comprehensive analysis) must keep working during incremental migration. Mitigation: Implement WorkflowRunner alongside existing `queuePromptSequence`; migrate one workflow at a time; keep the old path as fallback until all workflows are migrated.

**[Memory schema migration]** → Adding new SQLite tables and modifying memory categories requires schema migration. Mitigation: Use the existing `initDefaultDatabase()` pattern with `CREATE TABLE IF NOT EXISTS`; new tables are additive, not destructive.

**[Prompt section budgets are estimates, not enforced]** → Character budgets per section are advisory — there's no token counting. Mitigation: Start with conservative character limits; add token counting in a future iteration if prompt bloat becomes measurable.

**[Deterministic validation has limited scope]** → It can only verify numbers that appear in structured evidence records. Free-text claims outside the evidence pipeline won't be caught. Mitigation: Push as much data as possible through the evidence pipeline; use LLM validation as a complementary second layer.

## Open Questions

1. **Step execution model**: Should steps execute as separate Pi message turns (current model) or as tool-call sequences within a single turn? The former preserves compatibility; the latter gives more control but requires deeper Pi integration.

2. **Evidence record granularity**: Should each tool call produce one evidence record, or should records be per-data-point (e.g., one record per metric)? Per-tool-call is simpler; per-data-point enables finer validation.

3. **Memory migration**: Should existing preferences be migrated into the new typed categories automatically, or should the system start fresh and re-learn? Auto-migration preserves user context; fresh start avoids stale data.
