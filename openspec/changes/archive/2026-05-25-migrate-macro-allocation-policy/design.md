## Design

The migration follows the established selected-slice pattern:

1. `observe_only`: macro planning metadata remains recorded but no macro policy card is injected.
2. `dual_run`: macro policy card renders while fallback playbook macro clauses remain present.
3. `replacement_active`: macro policy card and answer contract own macro portfolio review shape; only fallback playbook items 5 and 10-13 are omitted for `macro_allocation_review` turns.

The slice does not migrate generic `portfolio_review`. It is limited to prompts that resolve to `macro_allocation_review`, including balanced portfolio macro reviews and provider-degraded macro/sentiment prompts.

## Validation

- focused policy-card, answer-contract, planning, and prompt-assembly tests
- focused strict manifest for `macro-portfolio-review,provider-degradation-disclosure`
- focused ref parity against `3e3a039`
- full `npm test`
- `graphify update .`
