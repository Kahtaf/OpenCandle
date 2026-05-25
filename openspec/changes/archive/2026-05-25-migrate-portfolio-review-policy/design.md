## Review Loop

Before implementation:

1. Validate this change with `openspec validate migrate-portfolio-review-policy --strict`.
2. Review against the `portfolio-evaluation-not-construction` ledger row.
3. Confirm the chosen manifest prompt is non-macro and exercises existing-allocation critique rather than portfolio construction.
4. Run baseline ref parity against `3e3a039` with the new manifest prompt before activating the policy card.

If the baseline route or task family differs from the proposed manifest expectation, update this spec and ledger before implementation.

## Scope

The migration covers prompts that ask to critique an existing allocation or portfolio without asking to build a new one. The policy must preserve:

- no portfolio-builder workflow dispatch unless construction is requested
- no budget clarification for existing-allocation critique
- structural allocation read before new-product recommendations
- concentration, diversification, duration, credit, geography, tax, liquidity, rebalance, and horizon-fit critique
- clear bottom-line decision or adjustment, risks, data gaps, and source coverage

Macro-specific evidence and policy guidance remain owned by `macro_allocation_review`.

## Rollback

Set `PLANNING_MANIFEST.portfolio_review.migrationStatus` to `dual_run` or remove it so the slice returns to observe-only behavior. Keep deterministic router correction and existing fallback portfolio clauses active during rollback.
