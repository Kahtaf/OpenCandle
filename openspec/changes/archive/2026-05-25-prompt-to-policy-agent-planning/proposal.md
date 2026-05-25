## Why

OpenCandle's finance behavior is increasingly encoded as scenario-specific prose in the global prompt, which is already large enough for important rules to be truncated before they reach the model. This change migrates OpenCandle toward a specialist-agent architecture where routing, evidence gathering, answer obligations, structured checks, and eval comparison are typed and testable instead of being carried by an ever-growing super prompt.

## What Changes

- Introduce a typed, versioned planning layer between `ResolvedTurnContext` and final synthesis. The V1 layer records a small task family, commitment mode, policy card, evidence plan, answer contract, structured-check IDs, capability-gap IDs, and planning diagnostics for each turn.
- Ship V1 as a migration scaffold first: stable IDs, manifest validation, traces, prompt-size gates, minimal evidence envelopes, capability-gap classification, and observe-mode structured checks before broad behavior changes.
- Preserve the existing granular tool collection and router work by making tool bundles the coarse capability scope and evidence plans the exact orchestration layer.
- Move migrated scenario-specific prompt clauses into compact, route-selected policy cards and task contracts that are injected only when relevant; non-migrated legacy clauses remain active until their parity gate passes.
- Add evidence plans and minimal evidence records that capture tool source, timestamp, provider status, missing data, normalized facts, raw trace pointers, and final-answer obligations. Intermediate artifacts are deferred to `future-roadmap.md`.
- Add V1 structured checks for measurable obligations such as freshness, data-gap disclosure, source coverage, commitment mode, and required evidence presence. Semantic validators and corrective retries are deferred to `future-roadmap.md`.
- Add a capability-gap registry so competitive losses become durable planning/tool/data work rather than new global prompt clauses. Disclosed gaps preserve honesty, but they do not count as specialist-agent parity for that capability.
- Add deterministic temporal grounding for "today", "right now", "this morning", and "after close" prompts through market-status evidence.
- Add migration/eval gates so current behavior can be measured before and after the prompt-to-policy refactor without losing existing routing, tool, prompt-protected, or answer-shape behavior.
- Keep the global system prompt small: analyst stance, tool honesty, data freshness, downside/risk posture, and refusal boundaries only.

## V1 Scope

V1 SHALL be feature-parity first. It does not need to delete every global scenario clause, and it MUST NOT remove or weaken any current behavior until the replacement path proves parity. V1 creates durable seams while current behavior remains the active baseline:

- versioned planning envelope on `ResolvedTurnContext`
- deterministic manifest validation and stable string IDs
- shadow planning that leaves current prompt/routing/tool behavior active while replacement planning records comparable outputs
- a parity ledger that maps every current prompt-protected behavior and deterministic routing correction to its replacement owner
- minimal evidence record and capability-gap trace fields
- prompt-size and active-section no-truncation gates
- committed before/after migration prompt manifest covering current retail-investor behavior, with exact prompt text, expected assertions, baseline paths, and cache metadata
- shadow planning and observe-mode structured checks for broad coverage without changing final behavior
- migrated behavior only for slices whose policy/evidence/contract path matches or improves current behavior on the parity ledger

Follow-up changes MAY then add research workspaces, typed artifacts, semantic validators, corrective retry, deeper planners, meta-tools, new providers, role escalation, or additional task-family migrations without changing the trace shape or replacing the planning architecture. Deferred work is captured in `future-roadmap.md`.

## No-Regression Policy

The refactor SHALL be treated like a behavioral rewrite, not prompt cleanup. Any current behavior encoded in global prompt prose, deterministic router correction, tool-scope behavior, provider-degradation handling, workflow dispatch, or harness reporting is considered product behavior until proven otherwise.

A global prompt clause, router correction, workflow behavior, or tool-scope rule MAY be removed or changed only when:

- it is listed in the parity ledger with an explicit replacement owner
- a characterization case captures current route, workflow, tool calls, evidence/source behavior, and final answer obligations
- the new path passes the same case with equal or better behavior
- rollback can restore the previous behavior independently

## Capabilities

### New Capabilities

- `agent-planning-layer`: typed task-family planning, policy cards, evidence plans, answer contracts, evidence records, structured checks, and capability gaps that replace scenario-specific global prompt growth over time.

### Modified Capabilities

- `intent-routing`: resolved-turn context SHALL carry task-family and policy/evidence identifiers while preserving existing route kinds, workflow labels, tool bundles, slot provenance, and deterministic post-processing. Router output MAY suggest planning fields, but deterministic planning owns final selection in V1.
- `deterministic-evals`: eval traces and always-tier cases SHALL capture planning-layer fields and compare pre/post migration behavior through route, tool, evidence, and answer-contract assertions.
- `llm-judge-evals`: judge-based quality evals SHALL distinguish prompt quality regressions from routing, evidence-plan, tool-capability, structured-check, retry-eligibility, and synthesis failures.
- `router-evals`: router live/deterministic evals SHALL include task-family and, where behavior has been migrated or dual-run, policy-card selection expectations in addition to route/workflow correctness.

## Impact

- Affected code areas: `src/routing/`, `src/prompts/`, `src/runtime/`, `src/workflows/`, `src/tools/`, `src/pi/opencandle-extension.ts`, `tests/harness/`, `tests/evals/`, `tests/fixtures/router/`.
- Existing tools are preserved, but some will be grouped behind evidence planners or finance meta-tools over time.
- Existing OpenSpec work in `typed-finance-router`, `router-context-and-observability`, and `production-router-and-tool-hardening` remains foundational; this change builds on those artifacts rather than replacing them.
- GitHub issue #22, "Clarify legacy deterministic router boundaries after typed router", is related prerequisite work. This change depends on the same boundary: default LLM routing stays primary, deterministic routing remains rollback/safety-net infrastructure, and the planner enriches resolved turns after those guardrails.
- No external provider dependency is required by the first migration phase. Future meta-tools may add provider-backed capabilities such as market-calendar or ETF holdings overlap under separate changes.
- Policy cards are not allowed to hide missing tools. If a benchmark needs exact ETF holdings overlap, brokerage fee/yield comparison, live cash-product rates, forward-rate probabilities, or richer earnings-event data that OpenCandle cannot fetch, the result SHALL be classified as a capability gap and tracked explicitly.
