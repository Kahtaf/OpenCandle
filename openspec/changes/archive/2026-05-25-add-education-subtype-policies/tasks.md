## 1. Spec Review

- [x] 1.1 Validate the OpenSpec change strictly.
- [x] 1.2 Review the spec for topic overfitting, prompt bloat, and hidden live-data requirements.

## 2. TDD Implementation

- [x] 2.1 Add a failing planner test for covered-call education selecting the options education policy card.
- [x] 2.2 Add a failing planner test for inflation/cash education selecting the inflation/cash policy card.
- [x] 2.3 Add a failing planner test proving valuation metric education still selects valuation-metric policy behavior.
- [x] 2.4 Add failing policy-card rendering tests proving only the selected education card is injected.
- [x] 2.5 Implement concept education policy-card variants and deterministic selection.

## 3. Validation

- [x] 3.1 Run focused planner and policy-card tests.
- [x] 3.2 Run focused prompt-policy strict smoke for education prompts.
- [x] 3.3 Run fixed-prompt competitive smoke for education regressions when available.
- [x] 3.4 Run `npm run build`.
- [x] 3.5 Run `npm test`.
- [x] 3.6 Run `graphify update .`.
