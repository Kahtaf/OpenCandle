## Context

`current_event_explanation` covers prompts like "Why did Boeing move today? I want the actual catalyst, not generic company background." These prompts are sensitive because the model can easily invent an intraday move, especially on weekends, holidays, pre-market/after-hours windows, or when news/search evidence is unavailable.

The archived V1 planning change already provides the substrate:

- task-family selection
- policy-card injection
- market-status evidence records
- capability-gap IDs such as `market_calendar`
- answer contracts and observe-only structured checks
- prompt-policy manifest and ref parity runner

## Decision

Migrate only the `market-closed-today-move` ledger row first. The replacement owner is:

- policy card: `current_event_explanation`
- evidence plan: existing `market_status`, with quote/news/event data represented as existing `tool_result` evidence records and raw trace pointers
- answer contract: freshness-first causal explanation
- structured checks: required evidence, freshness field, source coverage, capability-gap disclosure, and data-gap disclosure

The legacy fallback prompt clause remains active in dual-run mode. It may move to `legacy_removed` only after the slice parity gate passes.

## Implementation Constraints

- Do not add a new market-calendar provider, new finance provider, new meta-tool, or new evidence type in this change.
- Do not create persisted research workspaces, typed artifacts, user-visible reports, semantic validators, active retry, role escalation, hard tool-bundle enforcement, or router-owned planning.
- Keep `evidencePlanId: "market_status"` for `current_event_explanation`; do not introduce a second current-event evidence-plan ID unless a later spec changes the manifest.
- Use existing `tool_result` evidence records for `get_stock_quote`, `search_web`, `get_sec_filings`, or other current tools that the model already calls.
- Limit legacy prompt deletion to the fallback playbook clause that begins `For "today" or "why did it move today" prompts:`. Do not remove broader single-asset freshness, macro, sentiment, filing, or provider-degradation clauses.

## Activation Model

The implementation must support a three-step state for this one slice:

1. `observe_only`: current state; planning metadata is recorded and the current-event policy card is not injected.
2. `dual_run`: the current-event policy card is injectable while the legacy fallback clause remains authoritative.
3. `replacement_active` or `legacy_removed`: only after the parity gate passes; the matching legacy fallback clause may be removed and rollback must restore it.

If the existing planner only has a boolean `migrated` flag, this change should add the smallest task-family-scoped migration-status control needed for `current_event_explanation`. It must not change activation state for unrelated task families.

## Required Behavior

The answer must:

- check current date and market status before causal claims
- distinguish "today" from the most recent trading day when relevant
- use quote freshness and fetched news/event evidence where available
- avoid inventing an intraday move on weekends or holidays
- disclose market-calendar capability gaps when exact calendar/holiday data is unavailable
- expose source-coverage metadata for which source families were used, such as quote, web/news, filing, or provider-gap evidence
- continue with a useful framework when provider evidence is unavailable, without presenting speculation as fact

## Test Matrix

Minimum tests before implementation:

- policy-card registry: `current_event_explanation` remains placeholder in observe-only, becomes implemented for the migration slice, and unrelated policy cards are not injected.
- planner activation: `current_event_explanation` can move through observe-only, dual-run, and replacement-active without changing other task families.
- evidence plan: `market_status` remains the evidence plan ID, required evidence includes `market_status`, optional quote/news/event evidence is captured as `tool_result`, and provider gaps preserve `/connect` semantics.
- answer contract: current-event contract requires freshness disclosure, source coverage, data-gap disclosure, and market-calendar capability-gap disclosure.
- prompt assembly: dual-run includes both legacy clause and current-event policy card; replacement-active removes only the matching today-move clause.

## Rollback

Rollback is to keep or restore the legacy fallback prompt clause for the `market-closed-today-move` row and set the slice back to observe-only. Existing routing and tool behavior remain authoritative.

## Initial Parity Gate

Initial gate command:

- `PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=market-closed-today-move PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts`

Initial gate result:

- Passed 1/1 against baseline ref `3e3a039`
- Hard parity failures: 0
- Warnings: 0
- Report: `tests/evals/runs/2026-05-25T00-08-05-701Z_prompt-policy-ref-parity.json`
