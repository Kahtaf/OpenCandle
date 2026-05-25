## Why

Backtest answer obligations still live in global safety rules, and the planner has a placeholder `backtest_review` task family that is not selected for backtest prompts. This keeps backtest behavior tied to the large router prompt instead of the policy/contract system.

## What Changes

- Add a fixed backtest manifest prompt and capture old behavior before replacement.
- Implement a `backtest_review` policy card and answer contract for strategy-return reporting.
- Activate `backtest_review` as replacement-active after old-vs-current parity passes.
- Update the parity ledger, migration evidence, roadmap, and changelog with rollback instructions.

## Impact

- Affects planning selection, policy-card injection, and answer-contract metadata for backtest prompts.
- Does not change the `backtest_strategy` tool implementation, technical indicator tools, or provider behavior.
