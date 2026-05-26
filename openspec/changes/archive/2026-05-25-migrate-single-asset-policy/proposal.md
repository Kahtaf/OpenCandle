## Summary

Promote `single_asset_decision` into a prompt-to-policy migration slice.

This change moves current single-stock recommendation freshness and fallback valuation guidance from fallback prompt prose into a single-asset policy card and active answer contract.

## Motivation

Single-asset buy/wait/avoid prompts are central to OpenCandle. They must preserve quote/tool-output freshness, clear decision obligations, downside and invalidation framing, and avoid treating unavailable DCF or fundamentals as the thesis.

## Scope

In scope:

- add a fixed prompt-policy manifest case for a pure single-asset buy/wait/avoid prompt
- implement the `single_asset_decision` policy card
- activate the `single_asset_decision` answer contract
- keep the existing placeholder single-asset evidence plan
- run dual-run and replacement-active parity gates for the new prompt
- remove only fallback playbook item 16 for replacement-active single-asset turns
- update the parity ledger and migration evidence docs

Out of scope:

- new valuation, DCF, earnings, or market-data providers
- single-asset workflow rewrite
- semantic validators, corrective retry, or hard evidence enforcement

## Acceptance

- A manifest prompt for the `current-single-asset-freshness` ledger row exists and passes against the current implementation.
- Focused old-vs-current ref parity passes for the single-asset prompt before and after replacement activation.
- The strict focused manifest passes after replacement activation.
- Unit tests prove replacement-active single-asset prompts omit the legacy single-asset fallback clause while preserving unrelated fallback clauses.
