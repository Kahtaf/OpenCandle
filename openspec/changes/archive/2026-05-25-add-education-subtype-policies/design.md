## Design

Use policy-card variants, not new task families.

`concept_explainer` remains the task family because the evidence plan and answer contract are unchanged: no live evidence is required, and the answer should be educational rather than a concrete trade recommendation. The only thing that changes is the selected policy card.

The planner can refine `policyCardId` based on durable concept vocabulary:

- options education: covered calls, protective puts, option premium, assignment, strike/expiration basics
- inflation/cash education: inflation, purchasing power, real return, cash drag, TIPS, duration
- valuation metrics: P/E, EV/EBITDA, P/S, valuation metric workflow

Each card stays compact and topic-general. It names answer obligations and risks, but does not embed ticker examples or sector assumptions.

## Review Notes

- This addresses observed parity gaps without rebuilding a large router prompt.
- It is maintainable because each education topic has one policy card and shares the existing answer contract.
- It is extensible because future education topics can add policy-card variants only when eval evidence shows a recurring obligation gap.

## Validation

- focused planner tests for subtype selection
- policy-card rendering tests proving only the selected card is injected
- prompt-policy strict smoke for education prompts when available
- competitive fixed-prompt smoke for the two previously regressed prompts when API/cached competitor setup is available
- full `npm test`
