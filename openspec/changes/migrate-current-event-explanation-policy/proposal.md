## Summary

Promote the `current_event_explanation` roadmap item from the archived `prompt-to-policy-agent-planning` change into the next narrow migration slice.

This change moves "why did it move today / what is the actual catalyst" behavior from legacy fallback prompt prose into a current-event policy card, evidence plan, and answer contract after parity proves the replacement preserves current behavior.

## Motivation

The V1 prompt-to-policy scaffold is complete and `ticker_disambiguation` proved that a narrow behavior slice can move from prompt prose to a policy card without losing feature parity. The next lowest-risk slice is `current_event_explanation` because:

- it already has deterministic market-status evidence scaffolding
- the parity ledger has a dedicated row: `market-closed-today-move`
- the manifest has a focused prompt: `market-closed-today-move`
- causal/freshness failures are high-value to prevent

## Scope

In scope:

- implement the `current_event_explanation` policy card, evidence plan, and answer contract
- run the slice in dual-run mode before replacement-active mode
- preserve route kind, workflow, tool bundle, market-status evidence, provider-gap disclosure, and final-answer assertions
- remove only the matching legacy fallback prompt clause after parity passes
- document rollback to legacy prompt ownership

Out of scope:

- broad prompt shrinkage
- new market-calendar providers
- semantic claim-grounding validators
- active corrective retry
- user-visible research reports or workspaces
- migrating `sentiment_snapshot`, `filing_thesis_review`, or other task families

## Acceptance

- `PROMPT_POLICY_IDS=market-closed-today-move npx tsx tests/scripts/run-prompt-policy-ref-parity.ts` passes against the chosen baseline ref with no hard parity failures.
- The full prompt-to-policy manifest passes after the slice becomes replacement-active.
- Unit tests prove unrelated policy cards are not injected for current-event prompts.
- Unit tests prove market-closed/current-date evidence is required before current-event causal claims.
- The parity ledger row `market-closed-today-move` documents baseline, dual-run, replacement-active, and rollback state.
