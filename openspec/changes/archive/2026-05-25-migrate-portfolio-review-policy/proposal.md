## Why

The prompt-to-policy roadmap still leaves generic existing-allocation review behind global fallback guidance and a placeholder `portfolio_review` policy/contract. Macro portfolio prompts are already covered by `macro_allocation_review`, but non-macro existing portfolio evaluation needs its own narrow parity gate so it does not regress into portfolio construction or budget clarification.

## What Changes

- Add a fixed non-macro existing-allocation manifest prompt for `portfolio_review`.
- Implement the `portfolio_review` policy card and answer contract for existing allocation critique without constructing a new portfolio by default.
- Activate `portfolio_review` as replacement-active only after old-vs-current ref parity passes.
- Update the parity ledger, migration evidence, roadmap, and changelog with rollback instructions.

## Impact

- Affects prompt policy selection, answer-contract metadata, and final prompt assembly for `portfolio_review` turns.
- Does not change `portfolio_builder` workflow dispatch, portfolio construction prompts, macro allocation review, or Pi shell integration.
