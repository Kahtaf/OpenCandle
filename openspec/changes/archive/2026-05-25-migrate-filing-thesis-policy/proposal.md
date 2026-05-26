## Summary

Promote `filing_thesis_review` into the next prompt-to-policy migration slice.

This change moves SEC filing thesis-review source-separation guidance from fallback prompt prose into a filing policy card and active answer contract after parity proves the replacement preserves the existing `filing-thesis-review` behavior.

## Motivation

Filing thesis review has a clear protected behavior: use SEC filing evidence, separate filing metadata/body gaps from news or market context, and avoid unsupported filing claims. It has a committed manifest prompt and existing SEC/search tool coverage, so it is a good narrow migration after the current-event, concept, and sentiment slices.

## Scope

In scope:

- implement the `filing_thesis_review` policy card
- activate the `filing_thesis_review` answer contract
- keep the existing placeholder filing evidence plan
- run dual-run and replacement-active parity gates for `filing-thesis-review`
- remove only the matching fallback SEC filing clause for replacement-active filing turns
- update the parity ledger and rollback instructions

Out of scope:

- new SEC parsing, filing-body extraction, or provider behavior
- typed filing artifacts or persisted source ledgers
- semantic validators for unsupported claims
- hard tool-bundle enforcement
- broad removal of SEC or search-web tool catalog guidance

## Acceptance

- `PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=filing-thesis-review PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts` passes before and after replacement activation.
- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=filing-thesis-review PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts` passes after replacement activation.
- Unit tests prove the filing policy card is injected only outside observe-only mode and unrelated policy cards are not injected.
- Unit tests prove replacement-active filing prompts omit the legacy SEC filing fallback clause while keeping unrelated fallback clauses active.
