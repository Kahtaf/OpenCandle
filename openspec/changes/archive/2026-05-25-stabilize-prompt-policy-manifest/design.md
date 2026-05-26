## Design

The strict prompt-policy manifest is the gate for future prompt-to-policy migrations, so the fix stays inside the existing replacement-active ticker-disambiguation slice instead of weakening manifest assertions.

The failure mode was prompt-level ambiguity: when a user supplied a ticker-like symbol for an earnings/event-risk question, the model could treat failed or ambiguous lookup as a reason to block on `ask_user`. That preserves clarification behavior but violates the migrated ticker-disambiguation contract, which requires a useful unresolved-ticker event-risk framework when the supplied symbol cannot be verified.

The stabilization hardens only the `ticker_disambiguation` policy card:

- old-symbol prompts must explicitly compare the supplied symbol with the current primary ticker when evidence supports one
- supplied-but-unverified event-risk prompts must not block merely because the symbol is unresolved
- if clarification returns no usable answer, the model must disclose the unresolved ticker and continue with the event-risk framework

This keeps genuinely missing-symbol clarification behavior intact. It does not change router classification, tool bundles, evidence-plan ownership, answer-contract ownership, provider integrations, or hard tool enforcement.

## Validation

The gate is considered stable when:

- focused ticker-disambiguation policy-card tests pass
- focused strict manifest passes for `ticker-alias-armh,unknown-ticker-earnings-risk`
- full strict prompt-policy manifest passes all committed cases
- `npm test` passes
