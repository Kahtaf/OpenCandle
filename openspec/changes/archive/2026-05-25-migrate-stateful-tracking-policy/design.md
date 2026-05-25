## Review Loop

Before implementation:

1. Validate this change with `openspec validate migrate-stateful-tracking-policy --strict`.
2. Review against existing watchlist/prediction routing tests and e2e CLI prompts.
3. Confirm `runOpenCandleSession()` isolates state with a temporary `OPENCANDLE_HOME`.
4. Run focused ref parity for the stateful prompt against `3e3a039`.

If the baseline route, task family, tool bundle, or tool call differs from the proposed prompt, update the manifest/spec before implementation.

## Scope

The migration covers prompts that update or inspect persistent OpenCandle state through watchlist or prediction tools. The policy must preserve:

- route remains `agent_task` with `watchlist_or_tracking`
- state mutation is done by the appropriate tool, not by prose-only confirmation
- final answer confirms the action, symbol, direction/price/target/stop/timeframe when provided, and where the user can inspect it
- missing required fields for state mutation should use clarification rather than inventing values
- check/list operations should summarize existing state and disclose empty state

## Rollback

Set `PLANNING_MANIFEST.stateful_tracking_update.migrationStatus` to `dual_run` or remove it so the slice returns to observe-only behavior. Keep current watchlist/prediction tool behavior unchanged.
