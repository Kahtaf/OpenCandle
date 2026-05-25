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
- evidence plan: `market_status` plus current-event quote/news evidence
- answer contract: freshness-first causal explanation
- structured checks: required evidence, freshness field, capability-gap disclosure, and data-gap disclosure

The legacy fallback prompt clause remains active in dual-run mode. It may move to `legacy_removed` only after the slice parity gate passes.

## Required Behavior

The answer must:

- check current date and market status before causal claims
- distinguish "today" from the most recent trading day when relevant
- use quote freshness and fetched news/event evidence where available
- avoid inventing an intraday move on weekends or holidays
- disclose market-calendar capability gaps when exact calendar/holiday data is unavailable
- continue with a useful framework when provider evidence is unavailable, without presenting speculation as fact

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
