## Design

The migration follows the established slice pattern:

1. `observe_only`: retail planning metadata is recorded but no retail policy card is injected.
2. `dual_run`: the retail policy card can render while the legacy fallback retail clause remains present.
3. `replacement_active`: the retail policy card owns brokerage/account/product tradeoff answer shape, and only fallback playbook item 17 is omitted for `retail_finance_tradeoff` turns.

The slice keeps no active finance tools for these durable-knowledge prompts. Capability gaps for brokerage comparison, cash-yield products, and fund tax efficiency remain explicit; the policy requires facts that depend on current provider pages or current yields to be labeled for verification instead of fabricated.

## Validation

- focused policy-card, routing, answer-contract, and prompt-assembly tests
- focused strict manifest for the three retail prompt IDs
- focused ref parity against `3e3a039`
- full `npm test`
- `graphify update .`
