## 1. Spec Review

- [x] 1.1 Validate the OpenSpec change strictly.
- [x] 1.2 Review the spec for accidental construction workflow changes, tax advice overreach, and hidden capability claims.

## 2. TDD Implementation

- [x] 2.1 Add a failing planner test for existing-portfolio rebalance prompts selecting the rebalance policy card.
- [x] 2.2 Add a failing planner test proving portfolio construction prompts still select `portfolio_build`.
- [x] 2.3 Add a failing policy-card rendering test for rebalance prompt injection.
- [x] 2.4 Implement the rebalance portfolio review policy and selection refinement.

## 3. Validation

- [x] 3.1 Run focused planner and policy-card tests.
- [x] 3.2 Run focused product or fixed competitive eval smoke for portfolio rebalance behavior.
- [x] 3.3 Run `npm run build`.
- [x] 3.4 Run `npm test`.
- [x] 3.5 Run `graphify update .`.
