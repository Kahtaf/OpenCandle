## Design

The migration follows the established slice pattern:

1. `observe_only`: filing planning metadata is recorded but no filing policy card is injected.
2. `dual_run`: the filing policy card can render while the legacy fallback SEC filing clause remains present.
3. `replacement_active`: the filing policy card owns source-separation answer shape, and only fallback playbook item 7 is omitted for `filing_thesis_review` turns.

The slice keeps the existing SEC route and tool-bundle behavior. It does not add filing-body parsing or typed artifacts; if full filing body coverage is unavailable, the policy requires explicit disclosure rather than implying every section was read.

## Validation

- focused policy-card, routing, answer-contract, and prompt-assembly tests
- focused strict manifest for `filing-thesis-review`
- focused ref parity against `3e3a039`
- full `npm test`
- `graphify update .`
