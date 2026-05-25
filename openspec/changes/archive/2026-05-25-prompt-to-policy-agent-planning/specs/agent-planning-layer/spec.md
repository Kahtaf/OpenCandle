## ADDED Requirements

### Requirement: Typed Planning Layer

The system SHALL enrich each routed finance turn with a typed, versioned planning object before final synthesis. The planning object SHALL include a task family, commitment mode, policy card identifier, evidence plan identifier, answer contract identifier, structured-check identifiers, optional workspace/artifact placeholder identifiers, capability-gap identifiers, and planning diagnostics.

#### Scenario: Planning metadata is present for an agent task

- **WHEN** the router resolves a finance turn to `routeKind: "agent_task"`
- **THEN** the resolved turn context includes planning metadata with `version`, `taskFamily`, `commitmentMode`, `policyCardId`, `evidencePlanId`, `answerContractId`, `structuredCheckIds`, optional workspace/artifact placeholder IDs, and `diagnostics`

#### Scenario: Planning preserves existing route metadata

- **WHEN** planning metadata is added to a resolved turn context
- **THEN** the existing route kind, legacy route, workflow label, slots, slot provenance, entities, tool bundles, active tools, memory provenance, and diagnostics remain present

#### Scenario: V1 planning can run observationally

- **WHEN** a task family has not been behaviorally migrated yet
- **THEN** the system still records planning metadata and diagnostics
- **AND** it does not require prompt-clause deletion, hard tool-bundle enforcement, or blocking structured-check behavior

### Requirement: Shadow Planning Preserves Current Behavior

The planning layer SHALL support shadow planning in which current prompt, router, workflow, tool-scope, provider-degradation, and final-answer behavior remains active while planning metadata and replacement behavior run observationally.

#### Scenario: Planner enriches but does not override current routing

- **WHEN** shadow planning is enabled
- **THEN** planning metadata is added after existing route validation, deterministic corrections, workflow dispatch, and tool-bundle selection
- **AND** the planner does not silently change the current route kind, workflow, active tool scope, or clarification behavior

#### Scenario: Current prompt behavior remains active until parity passes

- **WHEN** a behavior is still marked `legacy_active`, `observe_only`, or `dual_run` in the parity ledger
- **THEN** the legacy prompt or deterministic behavior remains the active behavior owner
- **AND** replacement policy cards, evidence plans, answer contracts, or structured checks may only record diagnostics

### Requirement: Parity Ledger Gates Behavioral Removal

The planning layer SHALL maintain a parity ledger for every current behavior that may be migrated out of global prompt prose, router corrections, workflow dispatch, tool-scope behavior, or provider-degradation handling.

#### Scenario: Behavior cannot be removed without owner and passing gate

- **WHEN** a prompt clause, router correction, workflow behavior, tool-scope rule, or provider-degradation behavior is selected for removal or weakening
- **THEN** the parity ledger includes its current owner, replacement owner, characterization cases, required assertions, baseline run path, migration status, and rollback knob
- **AND** removal is blocked until those characterization cases pass with equal or better behavior

#### Scenario: Explicit accepted improvement can differ from baseline

- **WHEN** the replacement intentionally changes current behavior
- **THEN** the parity ledger records the accepted improvement and expected changed assertions
- **AND** the eval report classifies the change as accepted rather than an unreviewed regression

### Requirement: Small Task-Family Taxonomy

The planning layer SHALL use a bounded task-family taxonomy. A new task family SHALL be introduced only when the task requires a distinct evidence plan, answer contract, or structured-check set.

#### Scenario: Scenario wording does not create a new task family

- **WHEN** two prompts differ only in wording but require the same evidence and answer obligations
- **THEN** the planner assigns the same task family to both prompts

#### Scenario: Distinct evidence requirements justify a task family

- **WHEN** a prompt requires a distinct evidence pattern such as ticker disambiguation or current-event explanation
- **THEN** the planner MAY assign a specialized task family with its own policy card, evidence plan, and structured checks

#### Scenario: Retail tradeoffs use a framework-first task family

- **WHEN** the user asks a practical retail-investor tradeoff such as brokerage choice, safe cash products, mortgage-vs-investing, tax-loss harvesting, crypto sizing, or dividend-vs-growth ETFs
- **THEN** the planner assigns a retail finance task family or equivalent contract
- **AND** it does not require live market tools unless the user's wording needs current prices, rates, or security-specific facts

### Requirement: Commitment Mode Defines Answer Shape

The planning layer SHALL distinguish task family from commitment mode. Commitment mode SHALL define whether the answer should make a decision, compare tradeoffs, provide a framework, construct an allocation, update state, or clarify missing information.

#### Scenario: Comparison prompt is not converted into construction

- **WHEN** the user asks whether dividend ETFs or growth ETFs better fit a goal
- **THEN** the planner uses a comparison-oriented commitment mode
- **AND** the answer contract does not require building a full portfolio unless the user asks for one

#### Scenario: Recommendation prompt keeps a clear call obligation

- **WHEN** the user asks whether to buy, wait, or avoid a security
- **THEN** the planner uses a decision-oriented commitment mode
- **AND** the answer contract requires a clear call with major risks and conditions

### Requirement: Policy Cards Replace Migrated Scenario-Specific Global Prompt Clauses

The system SHALL represent migrated scenario-specific domain guidance as compact policy cards selected by task family rather than appending those instructions to the global system prompt. Unmigrated legacy guidance SHALL remain active until its parity-ledger gate passes.

#### Scenario: Only relevant policy is injected

- **WHEN** a migrated or dual-run selected slice reaches final prompt assembly
- **THEN** the final synthesis prompt contains the ticker-disambiguation policy card
- **AND** it does not contain unrelated policy cards for options, portfolio construction, sentiment, or macro prompts
- **AND** non-migrated legacy guidance remains active through its current owner until the parity-ledger gate passes

#### Scenario: Target global prompt stays scenario-agnostic after migration

- **WHEN** a scenario-specific behavior has passed its parity-ledger gate and moved to policy-card ownership
- **THEN** it contains analyst stance, data honesty, freshness, downside/risk posture, and refusal-boundary invariants
- **AND** the migrated scenario guidance is selected through the policy card rather than retained as a global prompt clause

#### Scenario: Global scenario clause remains while replacement is unproven

- **WHEN** a scenario-specific global prompt clause has not passed its parity-ledger gate
- **THEN** the clause remains active or equivalent legacy behavior remains active
- **AND** policy-card injection for that behavior is either observe-only or dual-run

#### Scenario: Policy card does not hide missing capability

- **WHEN** exact ETF holdings overlap, brokerage fee comparison, cash-product live yield, or market-calendar data is unavailable
- **THEN** the policy card may instruct disclosure of the gap
- **AND** it does not instruct the model to fabricate or imply unavailable capability

### Requirement: Evidence Plans Orchestrate Existing Tools

An evidence plan SHALL define required and optional evidence for a task family using existing tools or meta-tools. Tool bundles SHALL remain coarse capability scope, while evidence plans SHALL define exact orchestration needs.

#### Scenario: Implemented evidence plan runs for selected slice

- **WHEN** the planner selects a task family whose evidence plan is implemented, such as `market_status` or the selected V1 migration slice
- **THEN** the evidence plan records its required and optional evidence
- **AND** non-selected task families may record placeholder IDs, capability gaps, or roadmap diagnostics instead of full evidence-plan behavior

#### Scenario: Evidence plan records unavailable evidence

- **WHEN** required evidence for an implemented evidence plan cannot be fetched because a provider is unavailable, credential-gated, skipped, or soft-degraded
- **THEN** the evidence plan records the missing evidence as a structured gap rather than blocking synthesis solely through prompt text

#### Scenario: Current-event evidence requires market status

- **WHEN** an implemented current-event or market-status evidence plan handles a prompt about what happened today, this morning, right now, or after the close
- **THEN** the evidence plan requires temporal grounding evidence including current date, timezone, market open/closed/holiday status, last trading day, and quote as-of information

#### Scenario: Filing thesis evidence separates source types

- **WHEN** `filing_thesis_review` is selected as the migrated slice or implemented by a later spec
- **THEN** the evidence plan requires filing metadata and filing-derived evidence when available
- **AND** market or news context is represented separately from filing evidence

### Requirement: Evidence Records Normalize Tool Results

The system SHALL represent planned tool results as evidence records containing evidence type, source tool/provider, entity scope, as-of timestamp or observation date, provider status, normalized facts, raw trace pointer, and gaps or caveats.

#### Scenario: Quote evidence includes freshness

- **WHEN** a quote tool returns current or delayed price data
- **THEN** the evidence record includes the symbol, price facts, source provider/tool, and as-of timestamp or market-status caveat

#### Scenario: Provider degradation is preserved

- **WHEN** a tool result contains credential-required, skipped, unavailable, or soft-degraded provider status
- **THEN** the evidence record preserves that status and exposes it to answer contracts and structured checks

#### Scenario: Sentiment evidence captures confidence

- **WHEN** a sentiment tool or meta-tool returns source-level sentiment
- **THEN** the evidence record captures source name, provider status, sample-size or coverage indicators when available, as-of timestamp, and low-volume caveats

### Requirement: Minimal Trace Envelope For Future Workspaces

The planning layer SHALL reserve a minimal trace envelope for future research workspaces and artifacts without implementing persisted workspaces or the full artifact catalog in V1.

#### Scenario: Workspace fields are placeholders in V1

- **WHEN** V1 planning metadata is recorded
- **THEN** traces MAY include stable workspace or artifact identifiers for future compatibility
- **AND** V1 does not require persisted workspace storage, user-visible workspace UI, or a full artifact catalog

#### Scenario: Raw trace remains available

- **WHEN** evidence records or artifacts summarize tool output
- **THEN** they preserve raw trace pointers so synthesis, structured checks, future semantic validators, and debugging can inspect the underlying tool result

#### Scenario: Provider gap semantics are preserved

- **WHEN** evidence records normalize provider-degradation output
- **THEN** the final-answer path can still reproduce current data-gap and credential-remediation semantics
- **AND** normalization does not drop raw provider caveats needed for disclosure

### Requirement: Answer Contracts Define Final-Answer Obligations

Each task family SHALL select an answer contract that defines required final-answer fields, freshness obligations, data-gap disclosure requirements, risk/downside obligations, and whether a concrete commitment is required.

#### Scenario: Current-event explanation contract requires freshness

- **WHEN** the task family is `current_event_explanation`
- **THEN** the answer contract requires the final answer to distinguish the current date from the most recent trading day when applicable
- **AND** any causal claim must be supported by quote, market-status, news, filing, or event evidence

#### Scenario: Concept explanation contract suppresses commitment boilerplate

- **WHEN** the task family is `concept_explainer`
- **THEN** the answer contract does not require entry levels, price targets, confidence bands, or invalidation levels unless the user explicitly asks for an investment decision

#### Scenario: Unresolved ticker contract provides useful framework

- **WHEN** ticker lookup fails within the selected migration slice and the user's intent is still clear, such as asking about earnings-event risk for a held position
- **THEN** the answer contract requires disclosure that the symbol could not be verified
- **AND** it allows a generic framework or checklist that does not invent current facts only where the parity-ledger gate permits active fallback behavior
- **AND** non-selected slices may record fallback eligibility diagnostically without changing final behavior

### Requirement: Structured Checks Observe Evidence-Aware Obligations

V1 structured checks SHALL observe selected answer contracts and evidence records without rewriting, suppressing, or retrying final answers. Semantic validators SHALL be deferred to a later spec unless promoted with a narrow acceptance gate.

#### Scenario: Required evidence is observed

- **WHEN** an answer contract declares required evidence, freshness, provider-gap disclosure, source coverage, or commitment-mode obligations
- **THEN** V1 structured checks record whether those structured obligations are present
- **AND** they do not perform broad semantic claim-grounding

#### Scenario: Structured check remains observe-only

- **WHEN** a structured check fails during V1
- **THEN** the trace records the failure and parity impact
- **AND** the final answer is not automatically rewritten or suppressed

#### Scenario: Semantic checks are deferred

- **WHEN** a behavior needs semantic validation such as unsupported-claim detection, causal-claim hedging, direct-answer quality, or downside-risk quality
- **THEN** it is captured in `future-roadmap.md` unless a later spec promotes it

#### Scenario: Commitment mode is respected

- **WHEN** the selected commitment mode is `compare_tradeoffs`
- **THEN** V1 records whether the answer shape appears to remain in comparison mode using structured contract metadata
- **AND** any active behavior change still requires a parity-ledger gate

### Requirement: Corrective Retry Is Deferred

V1 SHALL NOT activate corrective synthesis retry. It MAY reserve trace fields for future retry behavior, but active retry requires a later spec or an explicit promoted slice with parity gates.

#### Scenario: Retry fields are trace-only

- **WHEN** structured checks fail in V1
- **THEN** the system MAY record retry eligibility or suggested repair diagnostics
- **AND** it does not retry synthesis or replace the final answer

#### Scenario: Active retry requires later promotion

- **WHEN** a future change wants active corrective retry
- **THEN** it must define accepted semantic validators, retry limits, latency budget, rollback behavior, and parity assertions before activation

### Requirement: Prompt Truncation Is Not Allowed for Production Prompt Sections

Production prompt assembly SHALL fail tests or emit explicit diagnostics when active non-memory prompt sections are truncated. Prompt truncation SHALL NOT silently remove policy cards, answer contracts, or global invariants.

#### Scenario: Fallback prompt truncation fails tests

- **WHEN** a production prompt variant includes a truncation marker in base role, safety rules, tool catalog, workflow instructions, policy card, answer contract, or output format
- **THEN** the prompt assembly test fails or emits a blocking diagnostic

#### Scenario: Memory truncation is explicit

- **WHEN** retrieved memory or provider status exceeds its budget
- **THEN** truncation is allowed only if the prompt includes an explicit truncation marker and tests verify no active policy or contract section was dropped

### Requirement: Followup Planning Preserves Or Replaces Context Deliberately

The planning layer SHALL support followup turns that reuse the prior task family and commitment mode when appropriate while replacing entities, constraints, or evidence freshness deliberately.

#### Scenario: Entity replacement preserves task shape

- **WHEN** a user asks a followup such as "what about SCHD instead?" after an ETF tradeoff prompt
- **THEN** the planner preserves the prior task family and commitment mode
- **AND** it replaces the relevant entity and records which prior evidence was reused, refreshed, or discarded

#### Scenario: Ambiguous carryover requests clarification

- **WHEN** a followup depends on prior context but the referenced entity or constraint is ambiguous
- **THEN** the planner emits a clarification diagnostic instead of guessing silently

### Requirement: Optional Role Escalation Is Traceable But Not Default

The planning layer SHALL reserve a traceable seam for optional role escalation, such as risk review, source audit, bull/bear review, or concept review, without requiring multi-agent execution for ordinary turns.

#### Scenario: Escalation eligibility recorded

- **WHEN** a prompt has high-stakes portfolio impact, conflicting evidence, filing/news mismatch, or a requested clear recommendation
- **THEN** the planning trace MAY record escalation eligibility and reason
- **AND** V1 does not require a separate specialist agent to execute the review
