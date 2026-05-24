## 0. Feature Parity Gates

- [x] 0.1 Create a parity ledger that lists current prompt-protected behavior, deterministic router corrections, workflow dispatch behavior, tool-scope behavior, provider-degradation behavior, and competitive-eval fixes that must survive the refactor.
- [x] 0.2 For each ledger entry, record current owner/source location, replacement owner, characterization prompts/tests, required route/workflow/tool/evidence/final-answer hard assertions, optional judge assertions, baseline run path, migration status, accepted-improvement status if applicable, and rollback knob.
- [x] 0.3 Define shadow planning so current prompt/routing/tool behavior remains active while planning metadata, minimal evidence records, capability gaps, and structured checks run observe-only.
- [x] 0.4 Add a no-regression rule: no global prompt clause, router correction, workflow behavior, provider-degradation behavior, or tool-scope rule may be removed or weakened until its parity-ledger entry passes.
- [x] 0.5 Define V1 completion as feature parity with current behavior plus traceable planning scaffolding, not prompt shrinkage.
- [x] 0.6 Resolve GitHub issue #22 or incorporate equivalent tests/comments that make legacy deterministic routing safety-net boundaries explicit before planner-owned behavior or policy-card injection is activated.
- [x] 0.7 Capture all non-V1 ideas in `future-roadmap.md` with promotion criteria for later specs.

## 1. Baseline and Prompt Safety

- [x] 1.1 Add characterization tests that assemble current production prompt variants and report section lengths plus truncation markers.
- [x] 1.2 Add no-truncation assertions for active non-memory prompt sections in standard, fallback, workflow dispatch, clarification, pass-through, and no-tool prompt variants.
- [x] 1.3 Identify the current global scenario clauses in `src/prompts/context-builder.ts` and map each clause to a parity-ledger entry plus intended task family, policy card, evidence plan, answer contract, V1 structured check, future semantic validator, or retained deterministic owner.
- [x] 1.4 Create a committed before-migration prompt manifest covering all parity-ledger behavior, including brokerage selection, ETF overlap, ticker aliases, unknown-ticker earnings risk, crypto sizing, market-closed "today" move, sentiment source coverage, filing thesis review, dividend-vs-growth ETF tradeoffs, safe cash products, mortgage-vs-investing, covered-call/protective-put routing, macro portfolio review, provider degradation disclosure, no-tool education, and at least two followups.
- [x] 1.5 For each manifest prompt, record exact prompt ID, text, followup sequence when applicable, expected route/workflow/tool/evidence/final-answer hard assertions, optional judge assertions, baseline OpenCandle report path, competitor baseline report path/hash, model/date metadata, and whether cached competitor answers are allowed.
- [x] 1.6 Run the current unit tests and targeted harness prompt manifest; record route, tool, trace, and final-answer baseline paths in `docs/internal/competitive-benchmark-history.md` or a dedicated migration note.
- [x] 1.7 Classify each recent competitive loss or prompt patch as routing, planning, evidence-plan, tool-capability, evidence-normalization, answer-contract, structured-check, retry-eligibility, synthesis, or judge/harness.
- [x] 1.8 Add a baseline comparison check that fails if a migrated path changes route kind, workflow, tool calls, provider-gap disclosure, or required final-answer hard assertions without an explicit accepted improvement.
- [x] 1.9 Add a specialist-capability scorecard that reports disclosed capability gaps as honest but not specialist-competitive until the underlying capability is implemented.

## 2. V1 Planning Scaffold and Manifest

- [x] 2.1 Add planning-layer types for versioned planning envelope, task family, commitment mode, policy card ID, evidence plan ID, answer contract ID, structured-check ID, optional workspace/artifact placeholder IDs, evidence requirement, capability-gap ID, and planning diagnostics.
- [x] 2.2 Add a planning manifest that maps route kinds/workflows to allowed task families, commitment modes, policy cards, evidence plans, answer contracts, structured checks, capability gaps, and compatible tool bundles.
- [x] 2.3 Implement deterministic planning validation that corrects or diagnoses unsupported route/workflow/task-family/policy combinations.
- [x] 2.4 Extend `ResolvedTurnContext` with planning metadata while preserving existing route, workflow, entity, slot, tool-bundle, memory, and diagnostics fields.
- [x] 2.5 Add unit tests for manifest validation, default task-family selection, unsupported combination correction, and preservation of existing resolved-turn context fields.
- [x] 2.6 Keep planner output observational for non-migrated task families so traces stabilize before behavior changes.
- [x] 2.7 Add tests proving the planner enriches, but does not override, existing deterministic router corrections and workflow dispatch.

## 3. Policy Cards and Prompt Assembly

- [x] 3.1 Create a policy-card registry with stable IDs for `ticker_disambiguation`, `current_event_explanation`, `sentiment_snapshot`, `filing_thesis_review`, `asset_compare`, `retail_finance_tradeoff`, and `concept_explainer`; implement only the first selected migration slice in V1 and leave the rest as placeholders/roadmap entries.
- [x] 3.2 Update prompt assembly so migrated or dual-run selected slices may inject the selected policy card and answer contract for the current resolved turn context; non-migrated legacy clauses remain active until their parity-ledger gate passes.
- [x] 3.3 Keep the global prompt limited to analyst stance, data honesty, tool-before-current-facts, freshness, downside/risk posture, and refusal boundaries.
- [x] 3.4 Add prompt assembly tests proving unrelated policy cards are not injected for a selected task family.
- [x] 3.5 Remove migrated global scenario clauses only after their parity-ledger entry passes route, tool, evidence, provider-gap, and final-answer assertions.
- [x] 3.6 Add an assertion that policy cards cannot claim missing capabilities; they may only disclose a capability gap or route to a future tool/meta-tool.
- [x] 3.7 Add dual-run prompt assembly support for selected slices so legacy prompt guidance and replacement policy cards can be compared before switching behavior.

## 4. Evidence Plans and Minimal Evidence Records

- [x] 4.1 Add evidence record types that capture evidence type, tool/provider source, entity scope, observation timestamp, provider status, normalized facts, raw trace pointer, and gaps/caveats.
- [x] 4.2 Keep research workspace and artifact catalog work out of V1 except for stable trace IDs/placeholders documented in `future-roadmap.md`.
- [x] 4.3 Add evidence plan definitions for `market_status` and the first selected migration slice only.
- [x] 4.4 Add placeholder manifest IDs for later evidence plans without implementing their full behavior.
- [x] 4.5 Wire planned tool calls into evidence record capture without removing the existing raw tool-call trace.
- [x] 4.6 Capture deterministic market-status evidence for "today", "right now", "this morning", "after close", market-closed, weekend, and holiday prompts.
- [x] 4.7 Normalize provider-degradation tags and unavailable data into structured evidence gaps.
- [x] 4.8 Add capability-gap registry entries for market calendar, ETF holdings overlap, brokerage comparison, cash-yield products, earnings-event risk, fund tax efficiency, forward-rate probabilities, and sentiment sample depth.
- [x] 4.9 Add full evidence-plan unit tests only for `market_status` and the selected migration slice; for non-selected families, assert placeholder IDs, capability gaps, raw trace pointer preservation, or roadmap entries instead of full behavior.
- [x] 4.10 Add tests proving evidence normalization preserves current provider-degradation and `/connect` disclosure semantics.

## 5. Answer Contracts and Structured Checks

- [x] 5.1 Add answer contract definitions for the first selected migration slice with required fields, freshness obligations, data-gap disclosure, risk/downside obligations, and commitment requirements.
- [x] 5.2 Add commitment-mode contracts for `decision`, `compare_tradeoffs`, `framework`, `construct`, `update_state`, and `clarify`.
- [x] 5.3 Implement V1 structured checks for required evidence presence, freshness field presence, data-gap disclosure, commitment-mode adherence, source coverage metadata, and capability-gap disclosure.
- [x] 5.4 Defer semantic validators such as claim-grounding, unsupported-claim detection, direct-answer quality, downside-risk quality, and causal-claim quality to `future-roadmap.md`.
- [x] 5.5 Add trace fields for structured-check pass/fail results and structured-check failure reasons.
- [x] 5.6 Do not activate corrective retry in V1; reserve trace fields only if needed for forward compatibility.
- [x] 5.7 Add framework-fallback behavior only for the selected migration slice and only where the parity ledger shows equal or better behavior; otherwise record fallback eligibility diagnostically.
- [x] 5.8 Add unit tests for structured-check failures, framework fallback, and commitment-mode preservation.
- [x] 5.9 Keep structured checks observe-only until parity-ledger assertions prove they do not suppress, rewrite, or degrade current final answers.

## 6. Eval and Trace Migration

- [x] 6.1 Extend deterministic eval traces with planning version, task family, commitment mode, policy card, evidence plan, answer contract, structured-check IDs, optional workspace/artifact placeholder IDs, capability-gap IDs, evidence records, structured-check failures, and retry eligibility.
- [x] 6.2 Extend router fixtures or router eval assertions with task-family and policy-card expectations while preserving existing route/workflow/entity/slot/tool-bundle assertions.
- [x] 6.3 Extend competitive benchmark reports with planning metadata and layer-specific failure classification.
- [x] 6.4 Update LLM judge prompts or report analysis so improvement ideas are classified as routing, planning, evidence-plan, tool-capability, answer-contract, structured-check, retry-eligibility, or synthesis issues.
- [x] 6.5 Add before/after migration comparison output for the committed prompt manifest from tasks 1.4-1.5.
- [x] 6.6 Defer workspace-style artifact assertions to `future-roadmap.md`; V1 evals assert minimal evidence records, raw trace pointers, and capability gaps.
- [x] 6.7 Add multi-turn eval assertions for plan carryover, entity/constraint replacement, stale evidence invalidation, and clarification when prior context is ambiguous.
- [x] 6.8 Add parity-ledger status and regression classification to deterministic and competitive eval reports.

## 7. First Migration Slice

- [x] 7.1 Select exactly one V1 migration slice from the parity ledger after baseline capture and issue #22 boundary gates pass.
- [x] 7.2 Recommended first-slice candidates are `ticker_disambiguation` or `current_event_explanation`; document the selected slice and rationale in the parity ledger.
- [x] 7.3 Implement only the selected slice's policy card, evidence plan, answer contract, framework fallback if applicable, and structured checks.
- [x] 7.4 Run legacy and replacement paths in dual-run mode for the selected slice and advance to replacement-active only when the parity ledger passes.
- [x] 7.5 Delete the selected slice's migrated global prompt clause only after parity passes and rollback is documented.
- [x] 7.6 Capture all non-selected task-family migrations in `future-roadmap.md`; do not implement them in V1.
- [x] 7.7 Keep optional role escalation out of V1 unless a later change implements `risk_review`, `source_audit`, `bull_bear_review`, or `concept_review`.

## 8. Validation and Rollout

- [x] 8.1 Run `npm test` after each migrated task-family slice.
- [x] 8.2 Run the committed before/after harness prompt manifest and compare route, task family, tool calls, evidence records, structured-check results, retry eligibility, final-answer hard assertions, and optional judge-scored assertions.
- [x] 8.3 Run `graphify update .` after code changes.
- [x] 8.4 Update `CHANGELOG.md` and internal benchmark/migration docs with the prompt-to-policy migration evidence.
- [x] 8.5 Keep tool-bundle enforcement in observe mode until planning-layer evals prove no expected tool is hidden.
- [x] 8.6 Document rollback knobs for disabling policy-card injection, shadow planning diagnostics, retry eligibility tracing, and hard tool enforcement independently.
- [x] 8.7 Document that V1 completion means stable scaffold plus no regressions against the current behavior baseline; prompt shrinkage is a later outcome, not the V1 success criterion.
- [x] 8.8 Require the full parity prompt manifest, existing router/unit tests, and competitive harness comparison to pass before any migrated prompt clause is deleted.
