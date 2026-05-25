## Purpose

This document captures architecture ideas that are intentionally outside V1 of `prompt-to-policy-agent-planning`. They may be valuable, but they should not be implemented in the first parity refactor unless promoted by a separate spec with its own acceptance criteria.

V1 success is feature parity with current OpenCandle behavior plus traceable planning scaffolding. The items below are follow-up candidates after the parity ledger proves the replacement path can preserve current behavior.

## Promotion Rule

A roadmap item may move into an implementation spec only when:

- the parity ledger shows which current behavior it improves or replaces
- a narrow prompt family or workflow is selected
- baseline current behavior is captured
- the item has a measurable acceptance gate
- rollback is clear
- it does not require broad prompt, router, Pi loop, or provider rewrites

## Deferred Architecture

### Additional Task-Family Migrations

Completed replacement-active migrations after V1:

- `current_event_explanation`
- `concept_explainer`
- `sentiment_snapshot`
- `filing_thesis_review`
- `retail_finance_tradeoff`
- `asset_compare`
- `single_asset_decision`
- `macro_allocation_review`
- `options_strategy`
- `portfolio_review`
- `backtest_review`
- `stateful_tracking_update`

Remaining post-V1 migration candidates:

- None currently identified in this roadmap.

Why deferred:

- V1 should prove the parity ledger, shadow planning, minimal evidence records, and one migrated slice before broad migration.
- Implementing many task families at once would make regression attribution hard.

Promotion signal:

- A selected migrated slice proves parity and prompt-clause deletion works without changing current behavior.
- Future task-family migrations should follow the same focused old-vs-current ref parity and rollback-knob pattern before activation.

### Persistent Research Workspaces

Internal or user-visible workspaces that persist assumptions, evidence records, source ledgers, artifacts, open questions, and answer obligations across turns.

Why deferred:

- V1 only needs traceable planning metadata and minimal evidence records.
- Persisted workspace lifecycle would touch session/Pi/storage boundaries.
- The artifact shape should be proven by migrated prompt families first.

Promotion signal:

- Followup-heavy evals need reusable evidence or user-visible intermediate work.
- Filing, portfolio, or thesis-review prompts repeatedly benefit from retained source ledgers.

### Typed Artifact Catalog

Candidate artifacts:

- `comparison_table`
- `source_coverage_table`
- `filing_change_summary`
- `earnings_risk_checklist`
- `brokerage_comparison_matrix`
- `cash_product_tradeoff_matrix`
- `position_sizing_band`
- `scenario_map`
- `holdings_overlap_estimate`
- `backtest_summary`

Why deferred:

- Implementing the whole catalog before proving one slice would create a second rules jungle.
- V1 should assert minimal evidence records and raw trace pointers first.

Promotion signal:

- A migrated slice has repeated eval assertions that are awkward without a structured artifact.

### V1 Trace Placeholder IDs

Stable placeholder families reserved by V1 traces:

- `research_workspace_v1_placeholder`
- `artifact_source_coverage_placeholder`
- `artifact_filing_change_placeholder`
- `artifact_comparison_table_placeholder`
- `artifact_capability_gap_placeholder`

Why deferred:

- V1 only records minimal evidence records, raw trace pointers, and capability gaps.
- Persisted workspaces, user-visible artifacts, and full artifact lifecycle management need a later spec.

Promotion signal:

- A migrated slice needs reusable intermediate work that cannot be tested with minimal evidence records plus raw trace pointers.

### Semantic Validators

Candidate validators:

- `currentFactClaimsGrounded`
- `directAnswerFirst`
- `downsideRiskPresent`
- `unsupportedClaimAbsent`
- `causalClaimsHedged`

Why deferred:

- V1 structured checks only consume contract metadata, evidence records, and trace fields.
- Robust semantic validation risks fragile NLP and false positives.
- V1 should use structured checks only: required evidence present, freshness present, data gap disclosed, commitment mode respected, source coverage captured.

Promotion signal:

- Structured checks pass consistently and failures remain in prose quality rather than routing/evidence/contract selection.

### Corrective Retry

One bounded retry using the same evidence and targeted validator feedback.

Why deferred:

- Active retry can mask systemic regressions and add latency.
- V1 can reserve trace fields without changing answers.

Promotion signal:

- Observe-only validator output shows a high-confidence, low-cost repair class that improves answers without changing route/tool behavior.

### Optional Role Escalation

Candidate review roles:

- `risk_review`
- `source_audit`
- `bull_bear_review`
- `concept_review`

Why deferred:

- Default swarms are not appropriate for ordinary retail prompts.
- OpenCandle should first prove evidence plans and contracts can preserve current behavior.

Promotion signal:

- High-stakes recommendation or thesis prompts need adversarial pressure that contracts/checks cannot provide.

### New Finance Providers And Meta-Tools

Candidate capability gaps:

- exact ETF holdings overlap
- brokerage fee/yield comparison
- live cash-product rates
- market-calendar/holiday data beyond deterministic weekday handling
- forward-rate probabilities
- richer earnings-event calendar/transcripts
- fund tax-efficiency data
- sentiment sample-depth improvements

Why deferred:

- V1 should classify these gaps, not solve them.
- New providers require fixture, rate-limit, degradation, and test strategy.

Promotion signal:

- Capability-gap IDs dominate benchmark losses after planning parity is achieved.

### User-Visible Research Reports

Report/export UX for filing reviews, portfolio reviews, backtests, or thesis memos.

Why deferred:

- Current OpenCandle parity is answer behavior, not report generation.
- The internal workspace/artifact model should stabilize first.

Promotion signal:

- Users need inspectable intermediate work or reusable deliverables beyond chat answers.

### Prompt Shrinkage Beyond Gated Slice Removal

Broad deletion of global scenario clauses after V1, beyond the single selected migration slice.

Why deferred:

- V1 success is parity plus traceable planning scaffolding, not a smaller prompt.
- Deleting many clauses at once would make regressions hard to attribute.

Promotion signal:

- Each candidate clause has a passing parity-ledger row, baseline comparison, and rollback knob.

### Deeper Planner Or Router-Suggested Planning

Allowing the router or a deeper planner to suggest richer task-family, evidence, policy, or answer-contract fields.

Why deferred:

- V1 deterministic planning owns final selection so the router does not become another super prompt.
- Richer planner agency needs separate failure-classification and rollback criteria.

Promotion signal:

- Static manifest defaults are stable, and eval misses show deterministic selection lacks needed context.

## Explicitly Not V1

- Full artifact catalog implementation
- Persisted workspace/session rewrite
- Active corrective retry
- Semantic claim-grounding validators
- Role-based multi-agent orchestration
- New provider integrations
- Hard tool-bundle enforcement changes
- Broad prompt clause deletion
- Prompt shrinkage before parity-ledger gates pass
- Router-owned scenario guidance or deep planner agency
- User-visible report/workspace UX
