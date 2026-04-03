# Claude Code Principles For OpenCandle

**Date:** 2026-04-01  
**Purpose:** Distill the architectural principles in `/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working` that are actually useful for OpenCandle, then translate them into concrete design guidance for this repo.  
**Audience:** OpenCandle maintainers building the next generation of the agent runtime, workflow engine, memory system, and extension surface.

---

## 1. Scope And Method

This write-up is based on a full repo pass over the Claude Code working tree, with emphasis on the layers that matter most for a terminal-native agent:

- architecture and session orchestration
- the core query loop
- system prompt/context assembly
- memory and compaction
- tool abstraction and tool execution
- permission and safety boundaries
- sub-agents, skills, and MCP extensibility
- task management and long-running work

Representative source areas reviewed include:

- `src/QueryEngine.ts`
- `src/query.ts`
- `src/context.ts`
- `src/constants/prompts.ts`
- `src/utils/systemPrompt.ts`
- `src/tools.ts`
- `src/Tool.ts`
- `src/utils/permissions/*`
- `src/memdir/*`
- `src/tools/AgentTool/*`
- `src/tools/SkillTool/SkillTool.ts`
- `src/skills/loadSkillsDir.ts`
- `src/services/mcp/client.ts`
- the architecture, context, tool, safety, agent, and extensibility docs under `docs/`

OpenCandle areas compared against those patterns include:

- [src/pi/opencandle-extension.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/pi/opencandle-extension.ts)
- [src/system-prompt.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/system-prompt.ts)
- [src/routing/classify-intent.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/routing/classify-intent.ts)
- [src/routing/slot-resolver.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/routing/slot-resolver.ts)
- [src/workflows/portfolio-builder.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/workflows/portfolio-builder.ts)
- [src/workflows/options-screener.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/workflows/options-screener.ts)
- [src/analysts/orchestrator.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/analysts/orchestrator.ts)
- [src/memory/storage.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/memory/storage.ts)
- [src/memory/retrieval.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/memory/retrieval.ts)
- [src/tools/interaction/ask-user.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/tools/interaction/ask-user.ts)

This is not a recommendation to clone Claude Code wholesale. Claude Code solves a much broader problem. The goal here is to extract the principles that improve a financial analysis agent without dragging in irrelevant complexity.

---

## 2. Executive Summary

The biggest lesson from Claude Code is not “add more tools.” It is that agent quality comes from runtime architecture, not from prompt cleverness alone.

The most applicable principles for OpenCandle are:

1. make workflow execution an explicit state machine, not a chain of queued prompts
2. separate session management from single-turn execution
3. build prompt context from typed sections, not one large static string
4. treat memory as typed, selective, and query-dependent
5. make provenance, assumptions, and verification first-class runtime concepts
6. degrade gracefully when tools, providers, or workflows are incomplete
7. build extensibility around bounded capabilities, not arbitrary prompt injection
8. instrument the runtime so failures are inspectable instead of anecdotal

If OpenCandle applies only a subset of what follows, the highest-value changes are:

- replace follow-up prompt sequencing with a workflow runner
- replace raw memory dumping with selective memory retrieval
- replace “system prompt as one string” with composable prompt sections
- replace prompt-only validation with structured validation of numbers and claims
- replace ad hoc workflow persistence with durable run state and event logs

---

## 3. Claude Code Source Map

Use these anchors when you want to verify that a principle in this document maps back to a concrete Claude Code implementation.

### Session orchestration and turn loop

- [QueryEngine session owner](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/QueryEngine.ts#L186)
- [QueryEngine submitMessage lifecycle](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/QueryEngine.ts#L211)
- [System prompt parts fetched per turn](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/QueryEngine.ts#L295)
- [Transcript persistence during execution](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/QueryEngine.ts#L454)
- [File snapshotting before edits](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/QueryEngine.ts#L649)
- [Single-turn loop state type](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/query.ts#L204)
- [Top-level `query()` entry](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/query.ts#L219)
- [Core `queryLoop()` implementation](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/query.ts#L241)
- [Tool-result budgeting before model call](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/query.ts#L379)
- [Post-compaction message rebuild](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/query.ts#L528)
- [Streaming tool execution path](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/query.ts#L563)
- [Serial tool execution fallback](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/query.ts#L1385)

### Prompt and context assembly

- [System context assembly](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/context.ts#L116)
- [User context assembly](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/context.ts#L155)
- [Dynamic prompt boundary marker](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/constants/prompts.ts#L114)
- [Simple system rules section](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/constants/prompts.ts#L186)
- [Task execution guidance section](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/constants/prompts.ts#L199)
- [Boundary insertion in prompt assembly](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/constants/prompts.ts#L573)
- [Effective system prompt selection](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/utils/systemPrompt.ts#L41)

### Tool system, tasking, and long-running work

- [Global tool registry assembly](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/tools.ts#L191)
- [Todo V2 / task-mode switch](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/utils/tasks.ts#L133)
- [Shared task-list identity resolution](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/utils/tasks.ts#L199)
- [Bash read/search classification](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/tools/BashTool/BashTool.tsx#L95)
- [Assistant blocking budget before backgrounding](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/tools/BashTool/BashTool.tsx#L57)
- [Bash tool definition](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/tools/BashTool/BashTool.tsx#L420)
- [File read tool definition](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/tools/FileReadTool/FileReadTool.ts#L337)
- [File read permission check](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/tools/FileReadTool/FileReadTool.ts#L400)
- [File write tool definition](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/tools/FileWriteTool/FileWriteTool.ts#L94)
- [File write permission check](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/tools/FileWriteTool/FileWriteTool.ts#L137)

### Memory and selective recall

- [Memory type taxonomy](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/memdir/memoryTypes.ts#L14)
- [Rules for when to access memory](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/memdir/memoryTypes.ts#L216)
- [Rules for trusting recalled memory](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/memdir/memoryTypes.ts#L240)
- [Memory line builder](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/memdir/memdir.ts#L199)
- [Memory prompt loader](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/memdir/memdir.ts#L419)
- [Selective memory recall system prompt](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/memdir/findRelevantMemories.ts#L18)
- [Selective memory recall entrypoint](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/memdir/findRelevantMemories.ts#L39)
- [Memory selection side query call](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/memdir/findRelevantMemories.ts#L100)

### Permissions, plan mode, and denial handling

- [Permission request message construction](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/utils/permissions/permissions.ts#L137)
- [Deny-rule collection](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/utils/permissions/permissions.ts#L213)
- [Whole-tool rule matching](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/utils/permissions/permissions.ts#L238)
- [Dangerous bash allow-rule detection](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/utils/permissions/permissionSetup.ts#L94)
- [Plan-mode context preparation](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/utils/permissions/permissionSetup.ts#L1462)
- [Denial thresholds](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/utils/permissions/denialTracking.ts#L12)

### Agents, skills, and extensibility

- [Agent tool definition](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/tools/AgentTool/AgentTool.tsx#L196)
- [Agent-specific MCP initialization](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/tools/AgentTool/runAgent.ts#L95)
- [Sub-agent runtime entry](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/tools/AgentTool/runAgent.ts#L248)
- [Register per-agent hooks](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/tools/AgentTool/runAgent.ts#L568)
- [Clear per-agent hooks](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/tools/AgentTool/runAgent.ts#L821)
- [Built-in agent type guard](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/tools/AgentTool/loadAgentsDir.ts#L168)
- [Filter agents by MCP requirements](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/tools/AgentTool/loadAgentsDir.ts#L250)
- [Skill command merging](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/tools/SkillTool/SkillTool.ts#L81)
- [Forked skill execution](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/tools/SkillTool/SkillTool.ts#L122)
- [Skill usage tracking during execution](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/tools/SkillTool/SkillTool.ts#L620)
- [Skill source-path resolution](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/skills/loadSkillsDir.ts#L78)
- [Skill frontmatter parsing](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/skills/loadSkillsDir.ts#L185)
- [Dynamic skill discovery by touched paths](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/skills/loadSkillsDir.ts#L861)
- [Conditional skill activation](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/skills/loadSkillsDir.ts#L997)

### MCP and external tool integration

- [MCP auth error type](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/services/mcp/client.ts#L153)
- [Session-expiry detection](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/services/mcp/client.ts#L194)
- [Default MCP tool timeout](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/services/mcp/client.ts#L212)
- [MCP connection cache entrypoint](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/services/mcp/client.ts#L596)
- [LRU-cached MCP tool discovery](/Users/kahtaf/Documents/workspace_kahtaf/claude-code-working/src/services/mcp/client.ts#L1759)

---

## 4. The Core Transferable Principles

## Principle 1: The agent loop should be an explicit state machine

**Claude Code pattern**

- `QueryEngine` owns multi-turn session state.
- `query()` owns one agentic turn as a stateful loop.
- continuation, retries, tool execution, fallback, interruption, and compaction are all explicit state transitions.

**Why it matters**

Prompt queues look simple until workflow control gets real. The moment there are follow-ups, clarifications, stale queued work, cancellations, retries, and verification steps, string-based sequencing becomes brittle.

**OpenCandle today**

- Workflow execution is driven from [src/pi/opencandle-extension.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/pi/opencandle-extension.ts).
- `queuePromptSequence()` serializes an `initialPrompt` plus follow-up strings.
- This is already compensating for sequencing bugs with polling and sequence IDs.

**What to apply**

- Introduce a `WorkflowRunner` that owns a `runId`, step list, current step index, cancellation, and completion state.
- Represent workflow steps as typed actions, for example:
  - `clarify`
  - `fetch_data`
  - `rank`
  - `risk_review`
  - `synthesize`
  - `validate`
- Persist step state, not just final summaries.
- Drop stale follow-ups by run ID instead of relying on prompt-settlement polling.

**OpenCandle target files**

- [src/pi/opencandle-extension.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/pi/opencandle-extension.ts)
- new runtime module under `src/workflows/` or `src/runtime/`
- [src/memory/storage.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/memory/storage.ts)

**Priority:** P0

## Principle 2: Session orchestration and turn execution are different responsibilities

**Claude Code pattern**

- `QueryEngine` handles session persistence, usage, permission denials, replay, and prompt assembly.
- `query()` handles the per-turn loop.

**Why it matters**

Mixing session policy with turn logic makes it hard to reason about cancellation, persistence, and context injection.

**OpenCandle today**

- [src/pi/opencandle-extension.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/pi/opencandle-extension.ts) currently handles:
  - session start
  - memory initialization
  - preference extraction
  - workflow routing
  - prompt sequencing
  - system prompt augmentation

**What to apply**

- Split current extension logic into:
  - `SessionCoordinator`
  - `WorkflowRunner`
  - `PromptContextBuilder`
  - `MemoryManager`
- Keep the extension thin: register tools, register commands, delegate runtime behavior.

**OpenCandle target files**

- [src/pi/opencandle-extension.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/pi/opencandle-extension.ts)
- new `src/runtime/*`

**Priority:** P0

## Principle 3: Prompt context should be assembled from sections

**Claude Code pattern**

- The system prompt is assembled as sections with explicit ordering and cache boundaries.
- Static guidance, dynamic environment state, user context, memory, and tool instructions are not all treated the same.

**Why it matters**

One monolithic prompt becomes hard to reason about, easy to bloat, and impossible to budget selectively.

**OpenCandle today**

- [src/system-prompt.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/system-prompt.ts) builds a single string.
- Memory context is appended as a raw text block.
- Third-party tools are appended as another raw block in [src/pi/opencandle-extension.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/pi/opencandle-extension.ts).

**What to apply**

- Build prompt sections explicitly:
  - base role
  - financial safety rules
  - tool catalog
  - workflow-specific instructions
  - memory context
  - provider-readiness context
  - extension/tool additions
  - output style / formatting rules
- Give each section a budget and a reason to exist.
- Make workflow prompts append scoped instructions instead of embedding everything in the top-level system prompt.

**OpenCandle target files**

- [src/system-prompt.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/system-prompt.ts)
- [src/prompts/workflow-prompts.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/prompts/workflow-prompts.ts)
- new `src/prompts/sections.ts`

**Priority:** P1

## Principle 4: Workflows should be typed plans, not prompt templates with extra strings

**Claude Code pattern**

- Plans, tasks, and agent roles are explicit entities with structure and life cycle.
- The runtime understands what phase it is in.

**Why it matters**

Prompt-only workflows are fragile because the runtime cannot inspect or recover them.

**OpenCandle today**

- [src/workflows/types.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/workflows/types.ts) exposes only:
  - `initialPrompt`
  - `followUps`

This is too weak for:

- conditional branching
- clarification budgets
- step-level retries
- deterministic validation
- partial completion
- stale-run cancellation

**What to apply**

- Replace `WorkflowPlan` with something closer to:
  - `workflowType`
  - `slots`
  - `steps`
  - `constraints`
  - `validationRules`
  - `summaryContract`
- Let each step declare:
  - required inputs
  - tools expected
  - outputs produced
  - whether it is skippable
  - whether it blocks user control

**OpenCandle target files**

- [src/workflows/types.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/workflows/types.ts)
- [src/workflows/portfolio-builder.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/workflows/portfolio-builder.ts)
- [src/workflows/options-screener.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/workflows/options-screener.ts)
- [src/workflows/compare-assets.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/workflows/compare-assets.ts)

**Priority:** P0

## Principle 5: Provenance should be a runtime primitive

**Claude Code pattern**

- Permission results carry reasons.
- memories distinguish types and scopes.
- session events are persisted.
- system messages and hook results are tagged rather than blended into ordinary text.

**Why it matters**

In finance, provenance is not optional. A value can be:

- user-specified
- inferred from the user
- recalled from saved preferences
- defaulted by the system
- fetched from a provider
- computed locally
- unavailable

If those states are not explicit, the agent will quietly misrepresent certainty.

**OpenCandle today**

- Slot provenance exists in [src/routing/slot-resolver.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/routing/slot-resolver.ts) and [src/prompts/workflow-prompts.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/prompts/workflow-prompts.ts).
- That is a good start.
- But provenance is still mostly a prompt formatting convention, not a runtime contract.

**What to apply**

- Introduce typed provenance for:
  - slot values
  - fetched data points
  - computed metrics
  - memory recalls
  - unavailable fields
- Keep provenance in step outputs and persisted run records.
- Make synthesis consume structured evidence, not just prior freeform text.

**OpenCandle target files**

- [src/routing/slot-resolver.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/routing/slot-resolver.ts)
- [src/memory/storage.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/memory/storage.ts)
- [src/prompts/workflow-prompts.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/prompts/workflow-prompts.ts)

**Priority:** P0

## Principle 6: Memory should be typed, selective, and recall-driven

**Claude Code pattern**

- Memory is typed: user, feedback, project, reference.
- Not all memory is injected every turn.
- Relevance selection happens before injection.
- stale memories are treated as claims that need re-verification.

**Why it matters**

Dumping all saved preferences and recent runs into every prompt will eventually create noise, contradictions, and stale guidance.

**OpenCandle today**

- [src/memory/storage.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/memory/storage.ts) stores:
  - user preferences
  - workflow runs
  - recommendations
- [src/memory/retrieval.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/memory/retrieval.ts) builds a compact text block by dumping recent preferences and workflows.

**What to apply**

- Split memory into at least:
  - investor profile memory
  - interaction feedback memory
  - workflow history memory
  - external reference memory
- Retrieve only memory relevant to the current workflow and symbols.
- Attach freshness and confidence metadata.
- Add stale-memory rules:
  - remembered risk preference may remain valid
  - remembered market thesis should decay quickly
  - remembered specific price or timing should never be trusted

**OpenCandle target files**

- [src/memory/storage.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/memory/storage.ts)
- [src/memory/retrieval.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/memory/retrieval.ts)
- [src/memory/preference-extractor.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/memory/preference-extractor.ts)

**Priority:** P0

## Principle 7: Context needs explicit budgets before the problem appears

**Claude Code pattern**

- tool results are budgeted
- old results are compacted
- prompt sections are cache- and budget-aware
- recovery paths exist when context gets too large

**Why it matters**

OpenCandle is still small, but the architecture is already trending toward larger prompts:

- system prompt
- memory context
- workflow instructions
- analyst prompts
- provider outputs

This becomes a context-quality problem before it becomes a hard token-limit problem.

**OpenCandle today**

- There is no prompt budgeting or compaction layer.
- Comprehensive analysis is a chain of many prompts in [src/analysts/orchestrator.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/analysts/orchestrator.ts).

**What to apply**

- Define budgets per context layer.
- Summarize older workflow evidence into compact structured artifacts.
- Never re-inject full historical runs when only a summary or slot memory is needed.
- Prefer structured evidence objects over repeated narrative restatements.

**OpenCandle target files**

- [src/system-prompt.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/system-prompt.ts)
- [src/analysts/orchestrator.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/analysts/orchestrator.ts)
- new `src/context/` or `src/runtime/context/`

**Priority:** P1

## Principle 8: Verification must be a first-class phase, not just a prompt flourish

**Claude Code pattern**

- It bakes in verification nudges, task completion checks, and explicit recovery behavior.
- Its runtime is built around not silently accepting partial or broken execution.

**Why it matters**

Finance is far less forgiving than coding-assistant chatter. A numerically polished but wrong answer is worse than an incomplete one.

**OpenCandle today**

- [src/analysts/orchestrator.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/analysts/orchestrator.ts) already appends a validation prompt for comprehensive analysis.
- That is directionally correct, but it is still LLM-only validation.

**What to apply**

- Add runtime validation layers:
  - verify cited numbers came from fetched tool results
  - verify timestamps exist for market-sensitive values
  - verify options expiries are grounded in the actual current date
  - verify required assumptions are disclosed
  - verify missing data is labeled as unavailable, not implied
- Use LLM validation as the last layer, not the only layer.

**OpenCandle target files**

- [src/analysts/orchestrator.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/analysts/orchestrator.ts)
- [src/prompts/workflow-prompts.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/prompts/workflow-prompts.ts)
- new `src/runtime/validation.ts`

**Priority:** P0

## Principle 9: Tool metadata should inform orchestration

**Claude Code pattern**

- tools expose read-only/destructive/concurrency-safe behavior
- tools define output budgets, permission behavior, display behavior, and prompts

**Why it matters**

Once the agent makes multi-step decisions, the runtime needs more than just tool names and schemas.

**OpenCandle today**

- Tools are well-typed, but mostly only expose `name`, `description`, `parameters`, and `execute`.

**What to apply**

- Add metadata like:
  - `dataFreshness`
  - `sideEffectLevel`
  - `provider`
  - `marketSensitive`
  - `cacheTTL`
  - `idempotent`
  - `safeToParallelize`
  - `requiresUserInput`
  - `producesEvidenceType`
- Use this metadata to:
  - dedupe duplicate tool calls
  - choose parallel fetches
  - skip stale re-fetches
  - explain source reliability

**OpenCandle target files**

- [src/tool-kit.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/tool-kit.ts)
- `src/tools/*`
- `src/providers/*`

**Priority:** P1

## Principle 10: Graceful degradation beats brittle refusal

**Claude Code pattern**

- retries when possible
- falls back when possible
- blocks only when genuinely necessary
- preserves the session despite partial failures

**Why it matters**

A financial agent will constantly face:

- provider outages
- symbol coverage gaps
- ETF fundamentals mismatches
- missing options or macro data
- stale or partial responses

**OpenCandle today**

- Some prompts and docs already push toward “continue with what is available.”
- But this is still uneven and heavily prompt-dependent.

**What to apply**

- Make degraded execution part of the runtime contract:
  - partial evidence is acceptable
  - missing providers should produce structured unavailable fields
  - workflows should continue if a non-critical leg fails
  - repeated retries on the same missing provider call should be blocked centrally

**OpenCandle target files**

- [src/system-prompt.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/system-prompt.ts)
- [src/analysts/orchestrator.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/analysts/orchestrator.ts)
- provider wrappers in `src/providers/`

**Priority:** P0

## Principle 11: Clarification should be budgeted and structured

**Claude Code pattern**

- user interaction is an explicit tool
- plan mode and permission prompts are structured
- the runtime treats interruption and clarification as stateful events

**Why it matters**

OpenCandle’s routing work is already moving in this direction. The next step is to stop treating clarification as a freeform escape hatch.

**OpenCandle today**

- [src/tools/interaction/ask-user.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/tools/interaction/ask-user.ts) is explicit and well-bounded.
- Routing and slot resolution already identify missing required values.

**What to apply**

- Give each workflow a clarification budget.
- Declare required vs optional slots.
- Only ask when the answer materially changes ranking, allocation, or risk.
- Persist clarification answers as structured inputs to the active run, not just tool text.

**OpenCandle target files**

- [src/tools/interaction/ask-user.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/tools/interaction/ask-user.ts)
- [src/routing/slot-resolver.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/routing/slot-resolver.ts)
- workflow runtime

**Priority:** P1

## Principle 12: Long-running work needs progress, cancellation, and ownership

**Claude Code pattern**

- long-running commands can background
- subagents report progress
- tasks have owners and status

**Why it matters**

Even if OpenCandle does not need shell backgrounding, it does need clear workflow ownership and user-visible progress once workflows become multi-step.

**OpenCandle today**

- Workflow execution is invisible prompt choreography after routing.
- The user has limited visibility into where a workflow is in its life cycle.

**What to apply**

- Add workflow progress events:
  - `classified`
  - `clarifying`
  - `fetching_market_data`
  - `ranking_candidates`
  - `validating_numbers`
  - `finalizing`
- Make new user input cancel or supersede in-flight workflow steps explicitly.

**OpenCandle target files**

- [src/pi/opencandle-extension.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/pi/opencandle-extension.ts)
- workflow runtime

**Priority:** P1

## Principle 13: Specialization only works when roles are bounded

**Claude Code pattern**

- subagents have scoped prompts, tool pools, optional isolation, and clear task contracts
- skills are bounded workflows, not just prose blobs

**Why it matters**

OpenCandle already uses analyst personas, but right now they are effectively a sequence of prompts in one shared thread.

**OpenCandle today**

- [src/analysts/orchestrator.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/analysts/orchestrator.ts) has useful role specialization.
- The weakness is execution model, not role idea.

**What to apply**

- Keep persona-style specialization.
- Do not keep the current “queue more prompts and hope the model stays scoped” pattern.
- Each analyst step should receive:
  - evidence collected so far
  - allowed questions/tools
  - exact output contract
- Synthesis should consume analyst outputs as structured objects, not a prose pile.

**OpenCandle target files**

- [src/analysts/orchestrator.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/analysts/orchestrator.ts)
- workflow runtime

**Priority:** P1

## Principle 14: Extensibility should separate atomic tools from reusable workflows

**Claude Code pattern**

- tools are atomic capabilities
- skills are reusable workflows/prompts
- MCP extends capabilities from external systems

**Why it matters**

OpenCandle already has third-party tool registration, but not a strong reusable workflow layer for external contributors.

**OpenCandle today**

- [src/tool-kit.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/tool-kit.ts) supports third-party tool registration.
- That solves “new capability.”
- It does not yet solve “new workflow.”

**What to apply**

- Keep tools for atomic data access and computation.
- Add a “skill” or “playbook” layer for:
  - sector screens
  - earnings prep
  - dividend-income portfolio drafts
  - macro regime summaries
  - options income setups
- Require structured metadata for these workflows the same way Claude Code does for skills.

**OpenCandle target files**

- [src/tool-kit.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/tool-kit.ts)
- new `src/skills/` or `src/playbooks/`

**Priority:** P2

## Principle 15: Persistence should be eventful, not summary-only

**Claude Code pattern**

- transcripts are append-only
- cost and status are persisted
- file history and session metadata are durable

**Why it matters**

If OpenCandle is going to become a serious agent, “what happened” must be reconstructible.

**OpenCandle today**

- [src/memory/sqlite.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/memory/sqlite.ts) stores workflow runs and recommendations.
- That is useful, but still too summary-oriented.

**What to apply**

- Add workflow event logs, for example:
  - `workflow_started`
  - `slot_resolved`
  - `clarification_asked`
  - `clarification_answered`
  - `tool_called`
  - `tool_failed`
  - `validation_failed`
  - `workflow_completed`
  - `workflow_cancelled`
- This should be lightweight and local-first, not a giant telemetry system.

**OpenCandle target files**

- [src/memory/sqlite.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/memory/sqlite.ts)
- [src/memory/storage.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/memory/storage.ts)

**Priority:** P1

## Principle 16: Safety in finance is mostly epistemic, not OS-level

**Claude Code pattern**

- permissions
- sandboxing
- plan mode
- denial tracking

**What transfers directly**

- explicit safe mode vs action mode
- “think/read before acting” as a runtime mode
- central handling for repeated blocked actions

**What does not transfer directly**

- shell sandboxing and filesystem permissions are not the main OpenCandle problem

**What OpenCandle should copy instead**

- a financial safety mode focused on:
  - stale data detection
  - explicit “educational draft” posture
  - no fabricated prices/metrics
  - no silent defaults on high-impact assumptions
  - hard labeling of unavailable evidence
  - absolute dates in market-sensitive reasoning

**OpenCandle target files**

- [src/system-prompt.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/system-prompt.ts)
- workflow runtime
- validation layer

**Priority:** P0

## Principle 17: Read-before-write and freshness checks are not just for code editors

**Claude Code pattern**

- File write/edit tools refuse to overwrite content that changed since read.

**Why it matters for OpenCandle**

The analogous risk is using stale evidence after user clarification, new market time, or changed workflow assumptions.

**What to apply**

- Track freshness for provider results.
- Invalidate stale evidence when:
  - the workflow run changes materially
  - the date-sensitive target changes
  - the user overrides a slot
  - the session crosses a freshness threshold
- Force re-fetches only when freshness rules say they are needed.

**OpenCandle target files**

- provider/tool orchestration layer
- workflow runtime
- [src/infra/cache.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/infra/cache.ts)

**Priority:** P1

## Principle 18: Build experiments behind flags, not forks

**Claude Code pattern**

- heavy use of feature flags to evolve behavior without splitting the runtime

**Why it matters**

OpenCandle is still exploring workflow routing, memory, and prompting. That work will go faster if experiments do not require permanent architectural divergence.

**What to apply**

- Add a light local feature-flag/config layer for:
  - selective memory recall
  - structured validation
  - typed workflow runner
  - analyst role variants
  - alternative disclosure formats

**Priority:** P2

---

## 5. What OpenCandle Should Not Copy

These Claude Code patterns are real, but should not be copied early:

- Full shell permission and sandbox architecture. OpenCandle does not currently operate as a general shell agent.
- Git worktree isolation. Useful only once OpenCandle grows true sub-agent execution or repo-mutating automation.
- Very broad task-team infrastructure. OpenCandle should first stabilize single-agent workflow execution.
- Huge generalized system prompts. OpenCandle should become more modular, not simply longer.

The rule is: copy the principle, not the surface area.

---

## 6. Concrete OpenCandle Roadmap

## Phase 1: Fix the runtime shape

- Replace prompt queues with a typed workflow runner.
- Persist run IDs and step states.
- Make cancellation and supersession explicit.
- Move orchestration out of [src/pi/opencandle-extension.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/pi/opencandle-extension.ts).

## Phase 2: Make context trustworthy

- Refactor [src/system-prompt.ts](/Users/kahtaf/Documents/workspace_kahtaf/opencandle/src/system-prompt.ts) into section builders.
- Replace memory dumping with selective recall.
- Add structured provenance objects for slots, evidence, and assumptions.
- Add runtime freshness policies for market-sensitive evidence.

## Phase 3: Make outputs defensible

- Add a structured validation layer for numbers and claims.
- Convert analyst outputs into structured evidence records.
- Make unavailable fields first-class instead of narrative caveats.
- Log workflow events so failures can be debugged from storage, not memory.

## Phase 4: Open the architecture carefully

- Add a workflow/skill layer for reusable finance playbooks.
- Extend tool metadata for better orchestration.
- Add targeted feature flags for experiments.

---

## 7. Proposed Initial File Layout

One plausible direction:

```text
src/
├── runtime/
│   ├── session-coordinator.ts
│   ├── workflow-runner.ts
│   ├── workflow-events.ts
│   ├── validation.ts
│   ├── evidence.ts
│   └── prompt-context.ts
├── prompts/
│   ├── sections.ts
│   ├── system.ts
│   └── workflow-prompts.ts
├── memory/
│   ├── storage.ts
│   ├── retrieval.ts
│   ├── recall.ts
│   └── types.ts
└── workflows/
    ├── types.ts
    ├── portfolio-builder.ts
    ├── options-screener.ts
    └── compare-assets.ts
```

This is not mandatory, but the important change is the separation of:

- session concerns
- workflow execution concerns
- prompt assembly concerns
- memory concerns
- validation concerns

---

## 8. Final Recommendation

The strongest thing OpenCandle should borrow from Claude Code is architectural discipline around agent execution.

The weakest path forward would be:

- adding more tools
- adding more analyst prompts
- adding more workflow follow-up strings

without fixing the runtime that stitches those pieces together.

The right next move is to make OpenCandle a small but explicit agent system:

- a workflow runner instead of a follow-up queue
- typed memory recall instead of memory dumping
- structured provenance instead of prompt-only disclosure
- validation as a runtime phase instead of just a prompt reminder

That is the part of Claude Code that most directly makes OpenCandle better.
