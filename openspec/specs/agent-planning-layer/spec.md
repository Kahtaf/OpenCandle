# agent-planning-layer Specification

## Purpose
TBD - created by archiving change prompt-to-policy-agent-planning. Update Purpose after archive.
## Requirements
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

### Requirement: Current Event Explanation Slice Migration

The planning layer SHALL support migrating the `current_event_explanation` task family from legacy fallback prompt prose into a dedicated policy card, answer contract, and structured checks after parity passes. The slice SHALL reuse the existing `market_status` evidence plan ID and existing `tool_result` evidence records for quote, news, filing, or event evidence.

#### Scenario: Current-event prompt selects current-event planning owners

- **WHEN** the user asks why a ticker moved today, this morning, right now, after close, or on the most recent trading day
- **THEN** the resolved planning metadata selects task family `current_event_explanation`
- **AND** it selects the `current_event_explanation` policy card and answer contract
- **AND** it selects evidence plan `market_status`

#### Scenario: Current-event evidence requires temporal grounding

- **WHEN** current-event explanation is selected
- **THEN** the evidence plan requires market-status evidence before causal claims
- **AND** quote freshness and fetched news, filing, or event evidence are represented as existing `tool_result` evidence records with raw trace pointers when available
- **AND** it records a market-calendar capability gap when exact holiday/session data is unavailable

#### Scenario: Current-event contract requires source coverage

- **WHEN** current-event explanation is selected
- **THEN** the answer contract requires freshness disclosure, source coverage metadata, data-gap disclosure, and market-calendar capability-gap disclosure
- **AND** structured checks record failures observe-only until the parity gate permits active behavior

#### Scenario: Market-closed prompts avoid invented intraday catalysts

- **WHEN** the user asks why a security moved today and the market is closed, the day is a weekend, or exact market status is unavailable
- **THEN** the answer contract requires the final answer to distinguish the current date from the most recent trading day
- **AND** it must not invent an intraday move or causal catalyst without supporting evidence

#### Scenario: Current-event migration has explicit activation states

- **WHEN** the slice is observe-only
- **THEN** the current-event policy card is not injected and the legacy fallback clause remains authoritative
- **WHEN** the slice is dual-run
- **THEN** the current-event policy card may be injected while the legacy fallback clause remains present
- **WHEN** the slice is replacement-active or legacy-removed
- **THEN** only the matching today-move legacy fallback clause may be removed

#### Scenario: Legacy current-event prompt clause remains until parity passes

- **WHEN** the `market-closed-today-move` parity gate has not passed for the replacement path
- **THEN** the legacy fallback prompt clause remains active or equivalent legacy behavior remains authoritative
- **AND** current-event policy-card behavior is observe-only or dual-run

#### Scenario: Current-event migration does not promote deferred roadmap items

- **WHEN** current-event explanation is implemented
- **THEN** the change does not add new providers, meta-tools, evidence types, persisted workspaces, typed artifacts, semantic validators, active retry, role escalation, hard tool-bundle enforcement, or router-owned planning

### Requirement: Concept Explainer Slice Migration

The planning layer SHALL support migrating the `concept_explainer` task family from legacy fallback prompt prose into a dedicated policy card and answer contract after parity passes. The slice SHALL preserve no-tool conceptual education routing and SHALL NOT require live evidence.

#### Scenario: Concept prompt selects concept planning owners

- **WHEN** the user asks a no-symbol conceptual or valuation education question
- **THEN** the resolved planning metadata selects task family `concept_explainer`
- **AND** it selects the `concept_explainer` policy card and answer contract
- **AND** it selects evidence plan `placeholder_concept_explainer`
- **AND** no live finance tool bundle is required

#### Scenario: Concept policy preserves educational answer shape

- **WHEN** concept explanation is selected
- **THEN** the answer contract requires a framework or checklist answer
- **AND** the policy card requires educational sections such as Bottom line, Core mental model, Practical workflow, Where it misleads, Cross-checks, and Quick checklist when the user asks how to use a valuation metric without over-relying on it
- **AND** it prevents analyst commitment, confidence-band, and invalidation boilerplate for pure education prompts

#### Scenario: Concept migration has explicit activation states

- **WHEN** the slice is observe-only
- **THEN** the concept policy card is not injected and the legacy fallback conceptual-education clause remains authoritative
- **WHEN** the slice is dual-run
- **THEN** the concept policy card may be injected while the legacy fallback clause remains present
- **WHEN** the slice is replacement-active or legacy-removed
- **THEN** only the matching conceptual-education fallback playbook clause may be removed for concept turns

#### Scenario: Concept migration does not promote deferred roadmap items

- **WHEN** concept explanation is implemented
- **THEN** the change does not add providers, meta-tools, evidence types, persisted workspaces, typed artifacts, semantic validators, active retry, role escalation, hard tool-bundle enforcement, or router-owned planning

### Requirement: Sentiment Snapshot Slice Migration

The planning layer SHALL support migrating the `sentiment_snapshot` task family from legacy fallback prompt prose into a dedicated policy card and answer contract after parity passes. The slice SHALL preserve existing sentiment routing and SHALL keep source/sample-depth limitations explicit.

#### Scenario: Sentiment prompt selects sentiment planning owners

- **WHEN** the user asks for ticker-specific retail mood, cross-source sentiment, or sentiment versus price action
- **THEN** the resolved planning metadata selects task family `sentiment_snapshot`
- **AND** it selects the `sentiment_snapshot` policy card and answer contract
- **AND** it selects evidence plan `placeholder_sentiment_snapshot`
- **AND** it keeps the `sentiment_sample_depth` capability gap when source coverage is incomplete

#### Scenario: Sentiment policy preserves source-coverage answer shape

- **WHEN** sentiment snapshot is selected
- **THEN** the answer contract requires source coverage and data-gap disclosure
- **AND** the policy card requires direction and strength of the sentiment signal, score scale when available, missing sources, why missing sources matter, source-coverage risk, low sample caveats, and confidence downgrade
- **AND** ticker-specific sentiment answers state whether sentiment diverges from price action

#### Scenario: Sentiment migration has explicit activation states

- **WHEN** the slice is observe-only
- **THEN** the sentiment policy card is not injected and the legacy fallback sentiment-source clause remains authoritative
- **WHEN** the slice is dual-run
- **THEN** the sentiment policy card may be injected while the legacy fallback clause remains present
- **WHEN** the slice is replacement-active or legacy-removed
- **THEN** only the matching fallback sentiment-source clause may be removed for sentiment turns

#### Scenario: Sentiment migration does not promote deferred roadmap items

- **WHEN** sentiment snapshot is implemented
- **THEN** the change does not add providers, persisted workspaces, typed artifacts, semantic validators, active retry, role escalation, hard tool-bundle enforcement, or router-owned planning

### Requirement: Prompt Policy Manifest Stability

The prompt-to-policy manifest SHALL be stable enough to gate future prompt-clause migrations without unrelated replacement-active slices failing nondeterministically.

#### Scenario: Supplied but unverified ticker does not block event-risk answer

- **WHEN** the user supplies a ticker-like symbol and asks for earnings or event-risk action
- **AND** ticker lookup cannot verify the symbol as the intended security or returns only ambiguous/irrelevant matches
- **THEN** the ticker-disambiguation policy requires unresolved-ticker disclosure
- **AND** the final answer provides an event-risk framework covering trim, hedge, hold, position size, gap risk, and facts that would change the answer
- **AND** it does not stop with only a request for a corrected ticker

#### Scenario: Missing-symbol clarification remains available

- **WHEN** the user asks for financial analysis without supplying any symbol or identifiable asset
- **THEN** clarification through `ask_user` remains allowed
- **AND** the stabilization does not remove clarification behavior from genuinely missing-symbol routes

### Requirement: Filing Thesis Review Slice Migration

The planning layer SHALL support migrating the `filing_thesis_review` task family from legacy fallback prompt prose into a dedicated policy card and answer contract after parity passes. The slice SHALL preserve existing SEC routing and SHALL keep filing-source boundaries explicit.

#### Scenario: Filing prompt selects filing planning owners

- **WHEN** the user asks for recent SEC filings, 10-Q/10-K changes, or thesis-changing filing evidence
- **THEN** the resolved planning metadata selects task family `filing_thesis_review`
- **AND** it selects the `filing_thesis_review` policy card and answer contract
- **AND** it selects evidence plan `placeholder_filing_thesis_review`

#### Scenario: Filing policy preserves source separation

- **WHEN** filing thesis review is selected
- **THEN** the answer contract requires source coverage and data-gap disclosure
- **AND** the policy card requires separation between filing metadata, filing-section summaries or filing-body gaps, news or management commentary, and market data
- **AND** unsupported claims about Item changes, management changes, risk-factor changes, or thesis-changing events are prohibited unless supported by SEC filing output

#### Scenario: Filing migration has explicit activation states

- **WHEN** the slice is observe-only
- **THEN** the filing policy card is not injected and the legacy fallback SEC filing clause remains authoritative
- **WHEN** the slice is dual-run
- **THEN** the filing policy card may be injected while the legacy fallback clause remains present
- **WHEN** the slice is replacement-active or legacy-removed
- **THEN** only the matching fallback SEC filing clause may be removed for filing turns

#### Scenario: Filing migration does not promote deferred roadmap items

- **WHEN** filing thesis review is implemented
- **THEN** the change does not add providers, filing-body parsing, persisted workspaces, typed artifacts, semantic validators, active retry, role escalation, hard tool-bundle enforcement, or router-owned planning

### Requirement: Retail Finance Tradeoff Slice Migration

The planning layer SHALL support migrating the `retail_finance_tradeoff` task family from legacy fallback prompt prose into a dedicated policy card and answer contract after parity passes. The slice SHALL preserve no-tool durable-knowledge retail behavior and SHALL keep capability gaps explicit.

#### Scenario: Retail prompt selects retail planning owners

- **WHEN** the user asks about brokerage/account selection, cash parking products, mortgage-vs-investing, or similar durable retail finance tradeoffs
- **THEN** the resolved planning metadata selects task family `retail_finance_tradeoff`
- **AND** it selects the `retail_finance_tradeoff` policy card
- **AND** it selects answer contract `retail_tradeoff_framework`
- **AND** it selects evidence plan `placeholder_retail_finance_tradeoff`

#### Scenario: Retail policy preserves durable tradeoff answer shape

- **WHEN** retail finance tradeoff is selected
- **THEN** the answer contract requires comparison tradeoffs and data-gap disclosure
- **AND** the policy card prevents punting just because no dedicated live provider exists
- **AND** it requires provider-site facts or current yield facts to be labeled for verification instead of fabricated
- **AND** it covers the relevant durable dimensions for brokerage choice, cash parking, or mortgage-vs-investing prompts

#### Scenario: Retail migration has explicit activation states

- **WHEN** the slice is observe-only
- **THEN** the retail policy card is not injected and the legacy fallback retail clause remains authoritative
- **WHEN** the slice is dual-run
- **THEN** the retail policy card may be injected while the legacy fallback clause remains present
- **WHEN** the slice is replacement-active or legacy-removed
- **THEN** only the matching fallback retail tradeoff clause may be removed for retail turns

#### Scenario: Retail migration does not promote deferred roadmap items

- **WHEN** retail finance tradeoff is implemented
- **THEN** the change does not add providers, persisted workspaces, typed artifacts, semantic validators, active retry, role escalation, hard tool-bundle enforcement, crypto-specific migration, or router-owned planning

### Requirement: Asset Compare Slice Migration

The planning layer SHALL support migrating the `asset_compare` task family from placeholder planning metadata into a dedicated policy card and answer contract after parity passes. The slice SHALL preserve existing compare workflow dispatch and SHALL keep exact ETF holdings overlap as an explicit capability gap.

#### Scenario: ETF comparison prompt selects asset-compare planning owners

- **WHEN** the user asks to compare ETFs, dividend-vs-growth ETF choices, holdings overlap, diversification overlap, or similar asset comparison tradeoffs
- **THEN** the resolved planning metadata selects task family `asset_compare`
- **AND** it selects policy card `asset_compare`
- **AND** it selects answer contract `asset_compare_tradeoff`
- **AND** it selects evidence plan `placeholder_asset_compare`

#### Scenario: Asset-compare policy preserves comparison answer shape

- **WHEN** asset comparison is selected
- **THEN** the answer contract requires comparison tradeoffs and data-gap disclosure
- **AND** the policy card requires comparing requested assets before portfolio construction
- **AND** it requires exact holdings overlap by weight to be disclosed as unavailable unless supported by a dedicated holdings provider
- **AND** it allows useful diversification, dividend/income, growth, tax, and horizon tradeoffs from available quote or fund context

#### Scenario: Asset-compare migration does not rewrite compare workflow dispatch

- **WHEN** the slice is replacement-active
- **THEN** existing `compare_assets` workflow dispatch and tool orchestration remain active
- **AND** no compare workflow prompt clause is removed by this slice
- **AND** rollback can restore observe-only or dual-run asset policy behavior without changing workflow routing

### Requirement: Single Asset Decision Slice Migration

The planning layer SHALL support migrating the `single_asset_decision` task family from legacy fallback freshness guidance into a dedicated policy card and answer contract after parity passes. The slice SHALL preserve clear recommendation behavior, quote/tool-output freshness, downside framing, and data-gap disclosure.

#### Scenario: Single-asset recommendation prompt selects single-asset owners

- **WHEN** the user asks whether to buy, wait, avoid, trim, add, or size a named single security
- **THEN** the resolved planning metadata selects task family `single_asset_decision`
- **AND** it selects policy card `single_asset_decision`
- **AND** it selects answer contract `single_asset_decision`
- **AND** it selects evidence plan `placeholder_single_asset_decision`

#### Scenario: Single-asset policy preserves recommendation answer shape

- **WHEN** single-asset decision is selected
- **THEN** the answer contract requires a clear commitment, risk downside, freshness disclosure, and data-gap disclosure
- **AND** the policy card requires quote or tool-output date disclosure when current data is used
- **AND** it preserves market-closed, delayed, or last-available quote caveats
- **AND** it prevents unavailable DCF or fundamentals from becoming the main thesis

#### Scenario: Single-asset replacement removes only the matching fallback clause

- **WHEN** the slice is replacement-active
- **THEN** only the legacy single-asset recommendation fallback clause may be omitted for single-asset turns
- **AND** unrelated fallback clauses for macro, retail, crypto, current-event, sentiment, filing, and concept turns remain governed by their own ledger rows

### Requirement: Macro Allocation Review Slice Migration

The planning layer SHALL support migrating the `macro_allocation_review` task family from fallback macro portfolio prose into a dedicated policy card and answer contract after parity passes. The slice SHALL preserve current macro evidence use, provider-gap continuation, structural portfolio review shape, and actionable adjustment obligations.

#### Scenario: Macro portfolio prompt selects macro allocation planning owners

- **WHEN** the user asks about macro outlook, inflation, rates, Fed policy, recession risk, or a balanced portfolio under current macro conditions
- **THEN** the resolved planning metadata selects task family `macro_allocation_review`
- **AND** it selects a macro allocation policy card
- **AND** it selects a macro allocation answer contract
- **AND** it preserves the macro, sentiment, and core-market tool bundles selected by routing

#### Scenario: Macro policy preserves portfolio review answer shape

- **WHEN** macro allocation review is selected
- **THEN** the answer contract requires data-gap disclosure and risk/downside framing
- **AND** the policy card requires current macro evidence when available
- **AND** it requires named unavailable macro or sentiment facts when providers are missing
- **AND** it preserves structural portfolio read, sleeve-by-sleeve implications, key risks/opportunities, actionable adjustment, what the adjustment does not fix, and watchlist/invalidation

#### Scenario: Macro replacement removes only matching macro fallback clauses

- **WHEN** the slice is replacement-active
- **THEN** only fallback playbook items 5 and 10-13 may be omitted for macro allocation turns
- **AND** provider-degradation remediation semantics remain preserved
- **AND** generic portfolio review and non-macro fallback clauses remain governed by their own ledger rows

### Requirement: Options Strategy Slice Migration

The planning layer SHALL support migrating the `options_strategy` task family into a dedicated policy card and active answer contract after parity passes. The slice SHALL preserve existing options workflow dispatch, owned-underlying selection, catalyst context, contract-selection evidence use, and strategy-specific risk framing.

#### Scenario: Options prompt selects options strategy planning owners

- **WHEN** the user asks for calls, puts, covered calls, protective puts, option chains, or option setups on a specific security
- **THEN** the resolved planning metadata selects task family `options_strategy`
- **AND** it selects policy card `options_strategy`
- **AND** it selects answer contract `options_strategy`
- **AND** it preserves the `options_screener` workflow dispatch when the workflow is selected
- **AND** it preserves core-market, options, sentiment, and clarification tool bundles selected by routing

#### Scenario: Existing-position options preserve underlying and catalyst roles

- **WHEN** the user asks for a covered call or protective put on an owned position while naming a separate catalyst ticker
- **THEN** the policy card requires the owned or held symbol to remain the option-chain underlying
- **AND** catalyst tickers remain catalyst context rather than replacing the underlying
- **AND** cost basis, share quantity, DTE hints, option strategy, and direction remain available to workflow prompt assembly

#### Scenario: Options answer contract preserves strategy-specific risk obligations

- **WHEN** options strategy planning is selected
- **THEN** the answer contract requires risk/downside framing, freshness/data-gap disclosure, and source coverage where available
- **AND** covered-call answers distinguish premium received, assignment/capped-upside risk, share-price downside, IV/event risk, exit liquidity, and return-if-assigned when inputs support it
- **AND** protective-put answers distinguish hedge floor, premium/decay cost, imperfect hedge risk, liquidity, opportunity cost, and Greeks when available

#### Scenario: Options replacement does not remove workflow prompt ownership

- **WHEN** the slice is replacement-active
- **THEN** workflow dispatch context and options workflow prompts remain authoritative for option-chain calls, expiration selection, contract ranking, stale quote caveats, and final contract tables
- **AND** no non-options task-family fallback clause is omitted by this migration

### Requirement: Portfolio Review Policy Migration

The planning layer SHALL support a replacement-active `portfolio_review` slice for existing-allocation critique that does not ask for a budget or route into portfolio construction unless the user requests construction.

#### Scenario: Existing allocation review is not portfolio construction

- **WHEN** the user asks to critically evaluate an existing portfolio or allocation without requesting a new portfolio
- **THEN** the planner selects `portfolio_review`
- **AND** the route remains an agent task rather than `portfolio_builder`
- **AND** the answer contract requires a clear structural read, risk/downside, data-gap disclosure, and source coverage

#### Scenario: Portfolio construction remains separate

- **WHEN** the user asks to build or construct a portfolio
- **THEN** the planner preserves the `portfolio_build` workflow behavior
- **AND** the `portfolio_review` policy card is not injected for that workflow

### Requirement: Backtest Review Policy Migration

The planning layer SHALL support a replacement-active `backtest_review` slice for prompts that ask to run or interpret a strategy backtest.

#### Scenario: Backtest prompts use the backtest review policy

- **WHEN** the user asks to backtest a strategy
- **THEN** the planner selects `backtest_review`
- **AND** the route remains an agent task with the current router workflow label preserved
- **AND** the answer contract requires backtest metric coverage, risk/downside, data-gap disclosure, and source coverage

#### Scenario: Backtest policy preserves practical edge discussion

- **WHEN** a backtest answer is synthesized
- **THEN** it reports strategy return, buy-and-hold return, outperformance, trade count, win rate, max drawdown, and risk-adjusted metrics when available
- **AND** it discusses costs, slippage, or unavailable cost assumptions when the user asks whether the edge is practical

### Requirement: Stateful Tracking Policy Migration

The planning layer SHALL support a replacement-active `stateful_tracking_update` slice for watchlist, portfolio tracking, alert, and report state turns. Prediction recording and checking are not part of the stateful tracking scope.

#### Scenario: Watchlist mutation prompt uses stateful tracking policy

- **WHEN** the user asks to add, remove, or update a watchlist item, portfolio lot, alert rule, or report template
- **THEN** the planner selects `stateful_tracking_update`
- **AND** the route remains an agent task with the `watchlist_or_tracking` workflow label
- **AND** the answer contract requires state update confirmation rather than a market recommendation

#### Scenario: Stateful policy preserves tool-owned persistence

- **WHEN** a watchlist, portfolio, alert, or report turn mutates state
- **THEN** the appropriate tool owns the persisted change
- **AND** the final answer confirms the persisted symbol/action/parameters without inventing missing values

#### Scenario: Prediction prompts are not offered a tracking tool

- **WHEN** the user asks to record or track a prediction
- **THEN** the policy scope offers no prediction tool
- **AND** the answer explains that prediction tracking is not supported rather than simulating a persisted record

### Requirement: Concept Education Sub-Policies

The planning layer SHALL support selected concept education policy cards under the existing `concept_explainer` task family so recurring educational obligations can move out of broad fallback prose without creating new task families.

#### Scenario: Options education selects options concept policy

- **WHEN** the user asks a no-symbol education question about covered calls, protective puts, option premiums, assignment, strikes, expirations, or similar option mechanics
- **THEN** planning selects task family `concept_explainer`
- **AND** it selects an options education policy card
- **AND** it keeps evidence plan `placeholder_concept_explainer`
- **AND** it does not require live options-chain tools unless the user asks for current tradable examples

#### Scenario: Inflation and cash education selects inflation concept policy

- **WHEN** the user asks how inflation affects cash, purchasing power, savings, bonds, real returns, or inflation protection
- **THEN** planning selects task family `concept_explainer`
- **AND** it selects an inflation/cash education policy card
- **AND** it keeps the concept answer contract rather than a macro allocation decision contract unless the user asks for a portfolio recommendation

#### Scenario: Valuation metric education remains concept education

- **WHEN** the user asks how to use a valuation metric such as P/E, P/S, EV/EBITDA, trailing earnings, forward earnings, normalized earnings, or cyclically adjusted metrics without over-relying on it
- **THEN** planning selects task family `concept_explainer`
- **AND** it selects valuation-metric education policy behavior
- **AND** it does not add entry levels, confidence bands, or invalidation boilerplate

#### Scenario: Education sub-policies remain compact and general

- **WHEN** an education sub-policy is selected
- **THEN** only the selected concept policy card is injected
- **AND** the card does not encode ticker-specific, sector-specific, or time-specific examples as required behavior
- **AND** unrelated education cards are not injected

### Requirement: Portfolio Rebalance Review Policy

The planning layer SHALL support a rebalance-specific policy card under the existing `portfolio_review` task family for prompts that ask how to rebalance, diversify, reduce concentration, or correct allocation drift in an existing portfolio.

#### Scenario: Existing allocation rebalance selects review subtype

- **WHEN** the user provides or references an existing portfolio allocation and asks how to rebalance, diversify, reduce concentration, set target bands, or handle drift
- **THEN** planning selects task family `portfolio_review`
- **AND** it selects a rebalance review policy card
- **AND** it keeps answer contract `portfolio_review`
- **AND** it does not switch to `portfolio_build` unless the user explicitly asks to construct a new portfolio

#### Scenario: Rebalance policy preserves capability honesty

- **WHEN** the rebalance policy card is injected
- **THEN** it requires disclosure of unknown exact holdings, tax lots, account type, cost basis, risk tolerance, and exact ETF overlap when those facts are unavailable
- **AND** it does not imply exact tax optimization or holdings-overlap capability without supporting tools

#### Scenario: Rebalance answer includes actionable structural obligations

- **WHEN** the rebalance policy card is selected
- **THEN** the answer should cover concentration, hidden overlap, geography, sector and factor exposure, fixed-income role, time horizon, risk tolerance uncertainty, staged implementation, tax-aware execution caveats, target ranges or bands, and monitoring triggers
- **AND** it should end with a clear adjustment or monitoring trigger tied to the user's stated or assumed horizon

### Requirement: Typed Answer Artifact Contracts

The planning layer SHALL expose typed answer artifact contract identifiers for structured intermediate outputs while keeping V1 trace-only and avoiding persisted workspace or UI requirements.

#### Scenario: Artifact contracts are typed trace metadata

- **WHEN** planning metadata includes artifact contract identifiers
- **THEN** each identifier maps to a registry entry with an owning task family set, description, and lifecycle status
- **AND** V1 treats the contract as trace-only unless a later spec promotes rendering or persistence

#### Scenario: Concept education can request example table structure

- **WHEN** a concept education policy card would benefit from examples, cross-checks, or comparison rows
- **THEN** planning MAY include `concept_example_table`
- **AND** the answer still remains a prose educational answer unless a later spec implements rendered artifacts

#### Scenario: Portfolio rebalance can request exposure and action artifacts

- **WHEN** a portfolio rebalance review policy card is selected
- **THEN** planning MAY include `portfolio_exposure_map` and `rebalance_action_plan`
- **AND** those IDs do not imply exact holdings overlap, tax-lot optimization, or persisted portfolio storage

#### Scenario: Source-heavy tasks can request source coverage structure

- **WHEN** sentiment, filing, or current-event tasks require source/gap visibility
- **THEN** planning MAY include `source_coverage_table`
- **AND** the trace must still distinguish unavailable provider coverage from available evidence

#### Scenario: Artifact contracts do not create new task families by themselves

- **WHEN** a task can reuse an existing task family, evidence plan, and answer contract
- **THEN** adding an artifact contract does not require a new task family

### Requirement: Portfolio Exposure Map Evidence

The planning layer SHALL expose deterministic portfolio exposure-map evidence for portfolio rebalance review prompts without inventing exact provider-backed holdings.

#### Scenario: User allocation percentages become structured exposure evidence

- **WHEN** a portfolio rebalance review prompt includes allocation percentages
- **THEN** planning evidence includes a `portfolio_exposure_map` record with normalized user-stated sleeves and percentages
- **AND** the record distinguishes direct user-stated exposure from inferred overlap caveats

#### Scenario: Broad-index overlap remains honest

- **WHEN** the prompt combines broad-index exposure with sector or concentrated sleeves
- **THEN** the evidence record includes a broad-index overlap caveat
- **AND** exact holdings overlap remains represented by the `etf_holdings_overlap` capability gap

#### Scenario: Exposure evidence is trace-only in V1

- **WHEN** exposure-map evidence is emitted
- **THEN** it appears in planning telemetry and eval traces
- **AND** it does not require live ETF holdings providers, persisted portfolio storage, or rendered artifacts

### Requirement: Semantic Answer Contract Checks

The planning layer SHALL expose observe-only semantic answer contract checks for recurring financial answer obligations that should not live only inside the router prompt.

#### Scenario: Semantic checks evaluate answer text diagnostically

- **WHEN** a selected planning policy requires semantic obligations such as assumptions, tax caveats, target bands, or when-not-ideal guidance
- **THEN** structured checks evaluate those obligations against answer text
- **AND** failures remain observe-only with retry eligibility recorded but no active retry

#### Scenario: Semantic checks are selected by generic policy obligations

- **WHEN** planning selects portfolio rebalance review or concept education refinements
- **THEN** planning includes relevant semantic check IDs
- **AND** the check IDs are generic and not tied to individual tickers, sectors, or memorized prompt strings

#### Scenario: Eval traces expose semantic check outcomes

- **WHEN** the harness records planning telemetry
- **THEN** semantic structured check results and failures appear alongside existing structured checks
- **AND** missing semantic obligations can be tracked as parity gaps before active answer enforcement

