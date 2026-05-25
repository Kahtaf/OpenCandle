## Review Loop

Before implementation:

1. Validate this change with `openspec validate migrate-backtest-review-policy --strict`.
2. Add a manifest prompt with old behavior expectations and run focused ref parity against `3e3a039`.
3. Confirm the prompt exercises `backtest_strategy` behavior and not generic single-asset recommendation behavior.
4. Only after the baseline passes, update implementation and promote the manifest expectation to `backtest_review`.

The baseline manifest may initially expect `general_fallback` planning because the old ref does not select `backtest_review`. The implementation commit must document the accepted owner promotion from `general_fallback` to `backtest_review`.

## Scope

The migration covers prompts asking to run, evaluate, or interpret a strategy backtest. The policy must preserve:

- route remains `agent_task` and preserves the current workflow label selected by the router
- `backtest_strategy` remains available and expected for backtest prompts
- final answer reports strategy return, buy-and-hold return, outperformance, trade count, win rate, max drawdown, and risk-adjusted metrics such as Sharpe or Sortino when available
- if risk-adjusted metrics, cost assumptions, or enough history are unavailable, the final answer must disclose the gap without collapsing into a tool-failure apology
- answer evaluates why the strategy worked or failed and discusses trading costs/slippage when the user asks about practical edge

## Rollback

Set `PLANNING_MANIFEST.backtest_review.migrationStatus` to `dual_run` or remove it so the slice returns to observe-only behavior. Keep the global backtest safety rule active during rollback.
