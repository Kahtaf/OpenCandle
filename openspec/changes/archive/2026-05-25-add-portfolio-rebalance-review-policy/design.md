## Design

Use a policy-card refinement rather than a new task family.

The evidence plan and answer obligations are the same as portfolio review: inspect an existing allocation, explain risks, and make actionable adjustments. Rebalance prompts need more specific synthesis obligations:

- identify concentration and hidden overlap, including common index concentration where relevant
- separate structural target allocation from execution sequencing
- give ranges or bands instead of pretending exact optimization is available
- disclose unknown account type, tax lots, cost basis, risk tolerance, and exact holdings
- include staged and tax-aware implementation options

The card must not imply exact ETF/holding overlap or tax-lot capability unless future tools provide it. It should improve answer quality while preserving honest capability boundaries.

## Review Notes

- This directly targets a known parity gap while staying general to allocation structure.
- It keeps portfolio construction and portfolio review separate.
- It creates a future hook for artifact contracts without requiring full workspace UI.

## Validation

- planner tests for rebalance selection and portfolio-build isolation
- policy-card tests for injection
- focused fixed-prompt/product eval smoke for rebalance behavior
- full build/test/graph update
