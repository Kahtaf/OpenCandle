## Context

OpenCandle has accumulated a strong tool surface and a typed router foundation, but too much product behavior now lives in prompt prose. Recent competitive-eval improvements added scenario-specific clauses for brokerage selection, ETF overlap, ticker aliases, unknown-ticker earnings risk, crypto sizing, and market-closed "today" questions. Those fixes improved isolated cases, but the fallback playbook and standard prompt now exceed their section budgets, so later rules can be truncated before the model sees them.

This change treats the current router work as the foundation, not as something to discard. `typed-finance-router` already introduced canonical route kinds, a capability manifest, tool bundles, resolved turn context, memory provenance, and route observability. `router-context-and-observability` added prior-turn context and trace capture. `production-router-and-tool-hardening` scopes symbol disambiguation, ticker validation, provider invalid-symbol guards, and acceptance gates. The missing V1 layer is a typed plan that says: for this turn, which domain policy, evidence plan, answer contract, structured checks, optional workspace/artifact placeholders, and capability gaps apply?

The comparison point is specialized finance agents such as Dexter, LangAlpha, TradingAgents, FinRobot, and EDGAR-focused MCP tooling. The useful pattern is not "make a large swarm by default"; it is to move domain behavior into meta-tools, skill workflows, evidence objects, structured traces, optional later workspaces/artifacts, optional role reviews, and contract checks while keeping the conversational model focused on synthesis. V1 does not prove direct specialist-agent benchmark parity; it creates the no-regression migration substrate and capability scorecard needed to compare honestly.

## Goals / Non-Goals

**Goals:**

- Preserve the existing granular tool collection, route kinds, workflow labels, slot provenance, and deterministic post-processing.
- Preserve current prompt-protected behavior until a replacement path proves feature parity.
- Move scenario-specific global prompt clauses into compact policy cards and answer contracts selected by task family.
- Add a planning layer that produces `taskFamily`, `commitmentMode`, `policyCardId`, `evidencePlanId`, `answerContractId`, structured-check IDs, optional workspace/artifact placeholder IDs, and plan diagnostics as part of the resolved turn context.
- Introduce minimal evidence records and capability-gap traces in V1, with research workspaces and typed artifacts deferred until their shape is proven by migrated slices.
- Add structured observe-mode checks in V1, with semantic validators and optional bounded corrective retry deferred until parity gates prove they do not degrade current answers.
- Add a capability-gap registry so missing data/tool coverage is classified explicitly rather than encoded as clever prompt wording.
- Add deterministic temporal grounding for "today", "right now", "this morning", and "after close" prompts.
- Provide a before/after migration test plan so existing routing behavior, tool behavior, and competitive-eval improvements can be compared fairly after the refactor.
- Maintain a parity ledger that maps current behavior to replacement owners and required characterization gates.
- Make prompt size and truncation observable and test-gated.

**Non-Goals:**

- Remove existing tools or replace the current typed router.
- Delete global scenario clauses as cleanup before equivalent behavior is proven.
- Reinterpret deterministic router corrections as optional planning suggestions.
- Flip hard tool-bundle enforcement before eval evidence shows the bundles are safe.
- Build a multi-agent trading-firm architecture as the default interaction model.
- Add new market data providers in this change.
- Solve every missing capability such as exact ETF holdings overlap, broker fee/yield coverage, cash-product live rates, forward-rate probabilities, or richer earnings-event data. Those can be future meta-tools once the planning layer exists. V1 still records these as capability gaps.
- Implement the full research workspace, artifact catalog, semantic claim-grounding validators, corrective retry, role escalation, or new providers in V1.
- Rewrite the Pi agent loop or session storage unless required to carry planning/evidence metadata.

## Decisions

### 1. Add a planning layer after route resolution, not inside the router prompt

`ResolvedTurnContext` remains the application-facing object built after router validation and deterministic post-processing. A new planner step enriches it with:

- `taskFamily`
- `commitmentMode`
- `policyCardId`
- `evidencePlanId`
- `answerContractId`
- `structuredCheckIds`
- optional workspace/artifact placeholder IDs for future compatibility
- plan diagnostics

The router may suggest these fields over time, but deterministic code remains responsible for validating them against manifests and filling safe defaults.

Alternative considered: widen the router prompt to decide everything. Rejected because that turns the router into the next super prompt and makes failures harder to classify.

### 2. Use shadow planning until feature parity is proven

The migration starts with shadow planning:

- current router corrections remain authoritative
- current workflow dispatch remains authoritative
- current tool-scope behavior remains observe-mode unless already enforced today
- current prompt-protected behavior remains active
- planning metadata, minimal evidence records, capability gaps, and structured-check diagnostics are recorded alongside current behavior
- policy-card injection is allowed only for a behavior whose parity gate passes

This means the first implementation may add traces and diagnostics without changing final answers. That is intentional. The refactor succeeds only when each behavior can be moved out of global prompt prose without changing current observable behavior.

### 3. Maintain a parity ledger

The parity ledger is the migration control plane. It should list every current behavior that must survive the refactor, including:

- global prompt clauses in `src/prompts/context-builder.ts`
- deterministic router corrections and fallbacks
- workflow dispatch behavior
- active-tool/tool-bundle behavior
- provider-degradation and `/connect` disclosure behavior
- competitive-eval fixes already landed for retail prompts
- harness/report fields that are used to judge behavior

Each ledger entry should include:

- current owner and source location
- replacement owner: policy card, evidence plan, answer contract, V1 structured check, future semantic validator, tool capability, or deterministic router logic
- characterization prompts/tests
- required route/workflow/tool/evidence/final-answer hard assertions
- optional judge-scored assertions, if prose quality is material
- current baseline run/report path
- migration status: `legacy_active`, `observe_only`, `dual_run`, `replacement_active`, or `legacy_removed`
- rollback knob

No prompt clause or deterministic behavior may move to `legacy_removed` until the replacement path passes its characterization gate.

Judge-score improvement cannot override a failed hard assertion unless the ledger records an explicit accepted improvement and the expected changed assertions.

Issue #22 is directly relevant here: it clarifies that default LLM routing is primary while deterministic routing remains rollback/safety-net infrastructure. This planning layer should not blur that boundary further. Phase 0 should either resolve issue #22 first or incorporate its boundary tests before planner-owned behavior becomes active.

### 4. V1 cut line

V1 is limited to:

- parity ledger and baseline capture
- prompt-size/no-truncation gates
- router-boundary guardrails from issue #22 or equivalent tests
- planning envelope and manifest IDs
- shadow planning diagnostics
- minimal evidence records with raw trace pointers
- capability-gap IDs
- structured observe-mode checks that do not rewrite answers
- one migrated behavior slice only after parity passes

The following are explicitly post-V1 unless a later decision promotes one with a narrow acceptance gate:

- persisted research workspaces
- full typed artifact catalog
- semantic claim-grounding validators
- corrective retry as active behavior
- optional role escalation
- new finance providers or meta-tools
- hard tool-bundle enforcement changes
- broad task-family migration
- user-visible workspace/report UX

### 5. Keep the task-family taxonomy small

Initial task families should be broad enough to avoid scenario explosion:

- `single_asset_decision`
- `asset_compare`
- `portfolio_build`
- `portfolio_review`
- `options_strategy`
- `current_event_explanation`
- `ticker_disambiguation`
- `filing_thesis_review`
- `sentiment_snapshot`
- `concept_explainer`
- `retail_finance_tradeoff`
- `stateful_tracking_update`
- `backtest_review`
- `macro_allocation_review`
- `general_fallback`

A new task family is allowed only when it changes evidence requirements, answer contract, or structured-check set. Wording differences alone are not enough.

Alternative considered: encode every observed competitive prompt as a task family. Rejected because it recreates prompt bloat as routing bloat.

### 6. Separate task family from commitment mode

Task family describes evidence shape. Commitment mode describes the answer shape the user asked for:

- `decision`
- `compare_tradeoffs`
- `framework`
- `construct`
- `update_state`
- `clarify`

This prevents retail prompts from drifting into the wrong product behavior. A dividend-vs-growth ETF question can remain a tradeoff comparison instead of becoming a full portfolio build. A broker-selection prompt can stay a retail finance framework without unnecessary market-data tool calls. A single-stock "would you buy?" prompt can require a clear call, while a "do not provide a buy/sell recommendation" prompt can suppress commitment.

### 7. Tool bundles are capability scope; evidence plans are orchestration

Tool bundles answer "which tools may be useful for this route?" Evidence plans answer "which exact data should be gathered for this task?" This preserves existing tool-bundle work while giving OpenCandle a more precise, testable place for tool sequencing.

For example, a `sentiment_snapshot` plan may require:

- quote evidence for price-action context
- sentiment summary evidence
- source-coverage evidence
- optional sentiment trend evidence when the user asks whether mood has shifted

The model should not need a global prompt paragraph to remember that shape.

Alternative considered: enforce exact tool sequences through active-tool bundles alone. Rejected because bundles are intentionally coarse and cannot express required/optional evidence or fallback behavior.

### 8. Preserve granular tools while introducing meta-tools/evidence planners

Existing tools such as `get_reddit_sentiment`, `get_twitter_sentiment`, `get_web_sentiment`, `get_sentiment_summary`, `get_sec_filings`, `get_stock_quote`, and `compare_companies` remain valuable. The migration should wrap clusters behind planners or meta-tools only where doing so reduces model burden.

Candidate planner IDs, with V1 implementing only `market_status` plus the first selected migration slice:

- `buildMarketStatusEvidence` for date, timezone, market-open/closed/holiday state, last trading day, and quote as-of interpretation
- `buildMarketContextEvidence` for current-event and "today/right now" prompts
- `buildSentimentEvidence` for ticker-specific sentiment snapshots
- `buildTickerDisambiguationEvidence` for ticker alias/current ticker prompts
- `buildFilingReviewEvidence` for SEC filing thesis-review prompts
- `buildRetailTradeoffEvidence` for brokerage, cash-product, mortgage-vs-investing, tax-loss-harvesting, and sizing prompts
- `buildAssetCompareEvidence` for compare/ETF-overlap prompts

Alternative considered: expose only new coarse meta-tools and hide granular tools immediately. Rejected because it risks losing working behavior and makes before/after comparison harder.

### 9. Research workspaces and artifacts preserve depth without default swarms

Post-V1 planned turns may create an internal research workspace containing:

- assumptions and user constraints
- evidence records
- source ledger
- computed artifacts
- open questions
- capability gaps
- selected answer contract

Artifacts are typed intermediate products that can be inspected by tests and traces before they become prose. Initial artifact types include:

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

This borrows the useful part of workspace-oriented specialist agents without turning every turn into a long-running research project. In V1, this remains a trace shape and roadmap concept only; do not build the full artifact catalog before a migrated slice proves which artifacts are actually useful.

### 10. Evidence records become the structured-check substrate

Every planned tool result should be represented as an evidence record with:

- evidence type
- source tool/provider
- symbol/entity scope
- observation date or as-of timestamp
- provider status (`available`, `unavailable`, `credential_required`, `soft_degraded`, `skipped`)
- normalized facts
- raw trace pointer
- gaps or caveats
- confidence/sample-size metadata when applicable
- causal-link strength when the answer would explain a price move

Structured checks and synthesis prompts consume evidence records instead of scraping raw tool text whenever possible.

Alternative considered: validate final answers directly against raw tool output. That remains useful as a fallback but is brittle for multi-tool answers and provider-degradation cases.

### 11. Capability gaps are first-class

The migration must distinguish "the model forgot an instruction" from "OpenCandle lacks a data source or computation." Capability gaps should be recorded with stable IDs and surfaced in eval reports. Initial gap IDs should include:

- `market_calendar`
- `etf_holdings_overlap`
- `brokerage_comparison`
- `cash_yield_products`
- `earnings_event_risk`
- `fund_tax_efficiency`
- `forward_rate_probabilities`
- `sentiment_sample_depth`

Policy cards may describe how to disclose a gap, but they must not pretend the capability exists.

A disclosed capability gap can preserve current OpenCandle honesty and no-regression parity, but it must remain marked as not specialist-competitive for that capability until a tool, provider, evidence plan, or artifact closes the gap.

### 12. Structured checks observe generic obligations, not scenario text

Initial V1 checks should be structured and observe-only:

- `noPromptTruncation`
- `requiredEvidenceSatisfied`
- `freshnessDisclosed`
- `dataGapsDisclosed`
- `commitmentModeRespected`
- `sourceCoverageDisclosed`

Semantic validators remain post-V1 until they can be proven reliable:

- `currentFactClaimsGrounded`
- `directAnswerFirst`
- `downsideRiskPresent`
- `unsupportedClaimAbsent`
- `causalClaimsHedged`

Structured checks should inspect plan + evidence + final answer metadata, not just headings. A check that only tests `answer.includes("Risk")` is insufficient.

Alternative considered: add more pre-answer prompt instructions. Rejected because prompt growth is the problem this change addresses.

### 13. Treat corrective retry as post-V1 telemetry first

Future semantic validators may support one corrective retry with a targeted repair instruction and the same evidence. Retry reason, semantic-validator failures, and repaired output status would be recorded in traces. Retry spikes are product regressions, not invisible success. Corrective retry is post-V1 active behavior; V1 may only reserve retry-eligibility trace fields if needed for forward compatibility.

Alternative considered: unlimited evaluator/optimizer loops. Rejected because latency/cost would be unpredictable and failures could hide systemic issues.

### 14. Optional role escalation is a later capability, not V1 default

Specialist competitors often use bull/bear reviewers, source auditors, or risk committees. OpenCandle should reserve a typed seam for optional role escalation without making every retail prompt multi-agent. V1 should only record escalation eligibility and reasons. Later changes may implement:

- `risk_review`
- `source_audit`
- `bull_bear_review`
- `concept_review`

Escalation triggers should be deterministic and sparse: high-stakes portfolio impact, conflicting evidence, user asks for a clear recommendation, filing/news mismatch, or later semantic-check evidence of unsupported causal claims.

### 15. Followups reuse plans carefully

Planning must understand followups that replace one entity or constraint while carrying forward the prior task shape. Examples include "what about SCHD instead?", "same question but for my taxable account", or "compare that to QQQ." The followup planner should:

- preserve the prior task family and commitment mode when the user only swaps an entity or constraint
- invalidate stale evidence when time-sensitive fields are reused
- record which evidence was reused, refreshed, or discarded
- emit a clarification when the carried context is ambiguous

### 16. Before/after testing is a first-class migration gate

Before deleting or shrinking prompt clauses, capture current behavior through:

- existing unit tests
- router fixtures
- always-tier evals
- competitive benchmark reports for recent retail prompt families
- targeted harness prompts for task families affected by the migration

The migration prompt set should be committed as a manifest with exact prompt ID, prompt text, followup sequence when applicable, expected route/workflow/tool/evidence/final-answer hard assertions, optional judge assertions, baseline OpenCandle report path, competitor baseline report path/hash, model/date metadata, and whether cached competitor answers are allowed.

After migration, rerun the same committed prompt manifest with cached competitor baselines where appropriate and compare:

- route kind / workflow / task family
- tool bundle selection
- actual tool calls and arguments
- evidence records produced
- structured-check failures and retry eligibility
- final-answer hard assertions and optional judge-scored assertions
- workspace/artifact placeholder IDs when present
- capability-gap IDs
- parity-ledger status

If current tests do not cover a behavior that prompt prose currently protects, add a characterization test before removing that prose.

Alternative considered: rely on competitive evals alone. Rejected because competitive judge wins can hide routing/tool regressions and cached baselines do not prove internal behavior.

## Risks / Trade-offs

- [Risk] The planning layer becomes a second giant rules engine. Mitigation: keep task-family taxonomy small; require new families to demonstrate distinct evidence/contract needs.
- [Risk] Removing prompt prose before equivalent planning, evidence, contract, or structured-check coverage regresses behavior. Mitigation: characterize current behavior first and delete prose only after matching tests pass.
- [Risk] Structured checks become superficial regex checks. Mitigation: V1 checks must inspect evidence records and plan requirements where possible; semantic validators are deferred until they can be specified and tested narrowly.
- [Risk] Tool bundles starve answers when enforced too early. Mitigation: keep observe mode during migration and enforce only after task-family evals are green.
- [Risk] Evidence normalization drops useful nuance from raw tool output. Mitigation: preserve raw trace pointers and allow synthesis to inspect raw snippets for complex tasks.
- [Risk] Corrective retries increase latency if promoted later. Mitigation: V1 records retry eligibility only; any later active retry spec must define a strict retry limit, latency budget, and parity gate.
- [Risk] Multiple runtime paths drift. Mitigation: include LLM router mode, rules fallback, workflow dispatch, `/analyze`, and harness execution in migration tests.
- [Risk] Existing evals do not capture current prompt-protected behavior. Mitigation: add explicit pre-migration characterization prompts for each clause removed from the global prompt.
- [Risk] Retail personal-finance prompts get over-tooled. Mitigation: use `retail_finance_tradeoff` and `commitmentMode` to allow practical frameworks when live market data is unnecessary or unavailable.
- [Risk] Workspace/artifact types become a new abstraction tax. Mitigation: keep V1 internal and trace-oriented; require artifacts only where they directly support eval assertions or answer quality.
- [Risk] Shadow planning becomes permanent and never shrinks the prompt. Mitigation: every ledger entry must have an owner, status, and next action; prompt text can stay only while it is the active behavior owner.
- [Risk] The plan overstates direct specialist-agent comparability. Mitigation: V1 reports generic-agent competitive comparisons plus a specialist capability scorecard/gap taxonomy; direct specialist baselines require a later benchmark integration.

## Migration Plan

1. Add prompt-size observability and fail-fast tests for production prompt variants. Do not yet remove prompt text.
2. Resolve or incorporate issue #22 boundary tests so deterministic routing is clearly safety-net/rollback infrastructure, not a second primary router.
3. Build the parity ledger from current prompt clauses, router corrections, workflows, tool-scope behavior, provider-degradation behavior, and competitive prompt fixes.
4. Capture current baseline behavior for the parity ledger with unit tests, router fixtures, harness traces, competitive reports, and a committed migration prompt manifest.
5. Define planning-layer types and manifests for task families, commitment modes, policy cards, evidence plans, answer contracts, structured checks, and capability gaps.
6. Extend `ResolvedTurnContext` and traces with planning metadata while preserving existing route/workflow/tool-bundle fields.
7. Implement minimal evidence capture observationally for the broad prompt set, with raw trace pointers.
8. Dual-run one replacement slice at a time against the legacy behavior.
9. Switch selected prompts from global scenario clauses to policy-card injection only when the parity ledger entry passes.
10. Rerun before/after evals; compare route, task family, commitment mode, tool calls, evidence, capability gaps, structured checks, final-answer quality, and parity status.
11. Delete migrated global prompt clauses only after equivalent or better coverage exists.
12. Repeat by parity-ledger entry, prioritizing the clauses most responsible for prompt bloat and truncation.

Rollback is to keep the new planning fields observational and restore previous prompt clauses. Because the migration is staged, policy-card injection, shadow-planning diagnostics, retry-eligibility tracing, and hard tool enforcement can be disabled independently.

## Open Questions

- Which single behavior slice should be migrated first after the parity ledger and issue #22 boundary gates pass?
- What prompt-size budget should be enforced after the first migrated slice proves stable?
