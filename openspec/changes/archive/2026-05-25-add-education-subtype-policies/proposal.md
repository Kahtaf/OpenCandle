## Summary

Split broad concept education guidance into selected education sub-policy cards.

The planner should keep `concept_explainer` as the task family, but choose narrower policy cards for options education, inflation/cash education, and valuation-metric education when the prompt calls for them.

## Motivation

Recent fixed-prompt comparisons showed the new architecture lagging `main` on pure education prompts even though the broad concept policy existed. The issue is not that OpenCandle needs a larger global prompt; it needs a small, typed way to select the right educational obligations for the topic.

This keeps OpenCandle flexible and general: topic-specific concepts become composable policy cards, not ticker- or sector-specific router clauses.

## Scope

In scope:

- add concept education sub-policy card IDs for options education, inflation/cash education, and valuation metrics
- select those policy cards deterministically while preserving task family `concept_explainer`
- keep no-tool behavior for pure education prompts
- ensure only one selected education policy card is injected
- add prompt-policy manifest coverage for the regressed education prompts where practical

Out of scope:

- adding live tools for education prompts
- adding ticker/sector-specific teaching examples
- changing the concept answer contract into a decision contract
- global prompt expansion

## Acceptance

- Covered-call basics prompts select an options education policy card.
- Inflation/cash purchasing-power prompts select an inflation/cash education policy card.
- Valuation metric prompts continue selecting valuation-metric education behavior.
- Pure education prompts do not require live finance tools.
- Focused evals for the previously regressed education prompts pass or produce an actionable synthesis failure without planning regression.
