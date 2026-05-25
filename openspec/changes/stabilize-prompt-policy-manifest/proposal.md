## Summary

Stabilize the prompt-to-policy strict manifest before additional prompt-clause migrations proceed.

The current full strict manifest can fail on `unknown-ticker-earnings-risk` even though the migrated ticker-disambiguation slice is already replacement-active. The failure mode is that a supplied-but-unverified ticker can become a blocking clarification loop instead of an unresolved-ticker event-risk answer.

## Motivation

Future prompt-to-policy migrations depend on the manifest as the no-regression gate. If the gate is flaky, every later slice has ambiguous evidence. Stabilizing the existing replacement-active ticker-disambiguation slice keeps the high-level router refactor focused on feature parity with the current product behavior.

## Scope

In scope:

- harden the `unknown-ticker-earnings-risk` manifest behavior so supplied-but-unverified symbols do not stop at clarification
- preserve ticker-disambiguation route, workflow, task family, evidence plan, answer contract, and capability-gap ownership
- keep clarification available for genuinely missing-symbol prompts
- run the full strict prompt-policy manifest after the fix

Out of scope:

- migrating new task families
- broad prompt shrinkage
- changing router ownership or tool-bundle enforcement
- adding new ticker, earnings, or market-data providers

## Acceptance

- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=unknown-ticker-earnings-risk PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts` passes.
- `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts` passes.
- Unit tests prove the ticker-disambiguation policy tells supplied-but-unverified earnings/event-risk prompts to answer with unresolved-ticker disclosure and an event-risk framework rather than stopping at clarification.
