## Summary

Promote `macro_allocation_review` into a prompt-to-policy migration slice.

This change moves macro portfolio review guidance from fallback prompt prose into a macro allocation policy card and active answer contract while preserving current macro/sentiment/tool degradation behavior.

## Motivation

Macro and balanced-portfolio prompts currently depend on large fallback clauses for macro series interpretation, mechanism maps, regional source search, structural portfolio reads, and provider-gap continuation. These obligations should become a selected policy and contract before further prompt shrinkage.

## Scope

In scope:

- add a `macro_allocation_review` policy card identifier and implementation
- add or activate a macro allocation answer contract
- keep `market_status` as the evidence plan owner for V1 macro allocation metadata
- keep capability gaps for `market_calendar`, `forward_rate_probabilities`, and sentiment sample depth where applicable
- run dual-run and replacement-active parity gates for `macro-portfolio-review` and `provider-degradation-disclosure`
- remove only fallback playbook items 5 and 10-13 for replacement-active macro allocation turns
- update the parity ledger and migration evidence docs

Out of scope:

- new macro providers or forward-rate probability provider
- portfolio review migration outside macro allocation prompts
- semantic validators or corrective retry
- provider degradation rewrite

## Acceptance

- `PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=macro-portfolio-review,provider-degradation-disclosure PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts` passes before and after replacement activation.
- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=macro-portfolio-review,provider-degradation-disclosure PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts` passes after replacement activation.
- Unit tests prove the macro policy card is injected only outside observe-only mode and unrelated fallback clauses remain active.
- Unit tests prove the macro answer contract requires macro framework/checklist, data-gap disclosure, risk/downside, and freshness/source coverage where applicable.
