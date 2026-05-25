## Summary

Promote `asset_compare` into the next prompt-to-policy migration slice.

This change moves ETF and asset comparison guidance into an `asset_compare` policy card and active answer contract while preserving existing compare workflow dispatch behavior.

## Motivation

Asset comparison prompts already route through `compare_assets`, but their migration state is still placeholder. ETF overlap and dividend-vs-growth tradeoffs need explicit comparison obligations, capability-gap disclosure for exact holdings overlap, and no regression to portfolio construction.

## Scope

In scope:

- implement the `asset_compare` policy card
- activate the `asset_compare_tradeoff` answer contract
- keep the existing placeholder asset-compare evidence plan and `etf_holdings_overlap` capability gap
- run dual-run and replacement-active parity gates for `etf-overlap-check` and `dividend-growth-etf-tradeoff`
- update the parity ledger and migration evidence docs

Out of scope:

- exact ETF holdings provider or overlap-by-weight calculation
- new compare workflow tools
- portfolio-builder migration
- semantic validators or corrective retry

## Acceptance

- `PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=etf-overlap-check,dividend-growth-etf-tradeoff PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts` passes before and after replacement activation.
- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=etf-overlap-check,dividend-growth-etf-tradeoff PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts` passes after replacement activation.
- Unit tests prove the asset-compare policy card is injected outside observe-only mode and unrelated task-family prompts are isolated.
- Unit tests prove the answer contract requires comparison tradeoffs, data-gap disclosure, and no construction commitment.
