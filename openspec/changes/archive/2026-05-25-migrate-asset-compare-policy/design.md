## Design

The slice follows the established selected-slice migration pattern:

1. `observe_only`: asset-compare planning metadata is recorded but no policy card is injected.
2. `dual_run`: the asset-compare policy card can render alongside existing compare workflow instructions.
3. `replacement_active`: the policy card and answer contract own ETF comparison answer obligations, while the compare workflow continues to own workflow dispatch and tool orchestration.

No legacy prompt clause is removed in this slice. The current owner is the compare workflow plus router correction, not a fallback playbook item. Replacement activation therefore means active policy-card and answer-contract ownership, not workflow prompt deletion.

## Validation

- focused policy-card, answer-contract, planning, and prompt-assembly tests
- focused strict manifest for `etf-overlap-check,dividend-growth-etf-tradeoff`
- focused ref parity against `3e3a039`
- full `npm test`
- `graphify update .`
