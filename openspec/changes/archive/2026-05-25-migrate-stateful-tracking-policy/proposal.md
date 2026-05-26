## Why

`stateful_tracking_update` remains mapped to the generic fallback policy and contract even though watchlist and prediction prompts mutate OpenCandle state. That leaves state-change confirmation obligations in the large prompt/tool descriptions rather than the planning policy system.

## What Changes

- Add a fixed stateful tracking manifest prompt for prediction recording.
- Implement a `stateful_tracking_update` policy card and answer contract.
- Activate the slice as replacement-active after focused old-vs-current parity passes.
- Update parity ledger, migration evidence, roadmap, and changelog with rollback instructions.

## Impact

- Affects planning selection, policy-card injection, and answer-contract metadata for watchlist/prediction tracking turns.
- Does not change watchlist or prediction tool persistence, file locations, or Pi shell integration.
