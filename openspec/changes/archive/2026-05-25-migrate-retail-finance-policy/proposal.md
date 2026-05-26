## Summary

Promote `retail_finance_tradeoff` into the next prompt-to-policy migration slice.

This change moves brokerage, cash-product, and mortgage-vs-investing tradeoff guidance from fallback prompt prose into a retail policy card and active answer contract after parity proves the replacement preserves the existing no-tool retail behavior.

## Motivation

Retail finance tradeoff prompts are high-value and already have committed manifest coverage. They must answer from durable public finance knowledge without pretending live provider coverage exists, while clearly labeling capability gaps and facts the user should verify.

## Scope

In scope:

- implement the `retail_finance_tradeoff` policy card
- activate the `retail_tradeoff_framework` answer contract
- keep the existing placeholder retail evidence plan and capability gaps
- run dual-run and replacement-active parity gates for brokerage, cash parking, and mortgage-vs-investing prompts
- remove only the matching fallback retail tradeoff clause for replacement-active retail turns
- update the parity ledger and rollback instructions

Out of scope:

- live brokerage, cash-yield, mortgage, or fund tax-efficiency providers
- crypto-sizing migration beyond preserving the existing crypto clause
- typed comparison artifacts or persisted workspaces
- semantic validators, corrective retry, or hard tool-bundle enforcement

## Acceptance

- `PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=brokerage-choice-taxable,safe-cash-products,mortgage-vs-investing PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts` passes before and after replacement activation.
- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=brokerage-choice-taxable,safe-cash-products,mortgage-vs-investing PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts` passes after replacement activation.
- Unit tests prove the retail policy card is injected only outside observe-only mode and unrelated policy cards are not injected.
- Unit tests prove replacement-active retail prompts omit the legacy retail fallback clause while keeping unrelated fallback clauses active.
