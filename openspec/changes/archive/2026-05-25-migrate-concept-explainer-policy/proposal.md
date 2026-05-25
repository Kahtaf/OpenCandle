## Summary

Promote the `concept_explainer` roadmap item into the next narrow prompt-to-policy migration slice.

This change moves no-tool conceptual education guidance from the fallback playbook into a concept policy card and active answer contract after parity proves the replacement preserves the existing `no-tool-valuation-education` behavior.

## Motivation

The prompt-policy manifest is stable again, and `concept_explainer` is the lowest-risk next slice:

- it has a focused manifest prompt: `no-tool-valuation-education`
- it should not fetch live tools
- the route and tool-bundle behavior is already deterministic
- it can remove one large fallback playbook clause without adding providers, workspaces, artifacts, semantic validators, or router agency

## Scope

In scope:

- implement the `concept_explainer` policy card
- activate the `concept_explainer` answer contract
- keep the existing no-tool evidence-plan placeholder because no live evidence is required
- run dual-run and replacement-active parity gates for `no-tool-valuation-education`
- remove only the matching fallback playbook conceptual-education clause for replacement-active concept turns
- update the parity ledger and rollback instructions

Out of scope:

- broad prompt shrinkage beyond the concept fallback clause
- deleting shared/base-role conceptual education reminders
- new tools, providers, workspaces, artifacts, semantic validators, or corrective retry
- changing router classification or tool-bundle behavior

## Acceptance

- `PROMPT_POLICY_BASE_REF=3e3a039 PROMPT_POLICY_IDS=no-tool-valuation-education PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-ref-parity.ts` passes before and after replacement activation.
- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=no-tool-valuation-education PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts` passes after replacement activation.
- Unit tests prove the concept policy card is injected only outside observe-only mode and unrelated policy cards are not injected.
- Unit tests prove replacement-active concept prompts omit the legacy conceptual-education fallback clause while keeping unrelated fallback clauses intact.
