## Summary

Promote the `sentiment_snapshot` roadmap item into the next prompt-to-policy migration slice.

This change moves sentiment source-coverage guidance from fallback prompt prose into a sentiment policy card and active answer contract after parity proves the replacement preserves the existing `sentiment-source-coverage` behavior.

## Motivation

The ticker, current-event, and concept slices now show that small policy-card migrations can preserve feature parity while shrinking targeted fallback clauses. `sentiment_snapshot` is the next narrow slice because it has one committed manifest prompt, existing sentiment tools, and a clear protected behavior: direction/strength, missing sources, low sample coverage, and divergence from price action.

## Scope

In scope:

- implement the `sentiment_snapshot` policy card
- activate the `sentiment_snapshot` answer contract
- keep the existing placeholder sentiment evidence plan unless a minimal source-coverage evidence record is already available
- run dual-run and replacement-active parity gates for `sentiment-source-coverage`
- remove only the matching fallback sentiment-source clause for replacement-active sentiment turns
- update the parity ledger and rollback instructions

Out of scope:

- new sentiment providers or scraping behavior
- changes to sentiment tool implementations
- hard tool-bundle enforcement
- semantic validators, corrective retry, persisted workspaces, or typed artifacts
- broad removal of global sentiment reminders outside the targeted fallback clause

## Acceptance

- `PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=sentiment-source-coverage PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts` passes before and after replacement activation.
- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=sentiment-source-coverage PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts` passes after replacement activation.
- Unit tests prove the sentiment policy card is injected only outside observe-only mode and unrelated policy cards are not injected.
- Unit tests prove replacement-active sentiment prompts omit the legacy fallback sentiment-source clause while keeping unrelated fallback clauses active.
