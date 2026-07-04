# E2 Saved Market-State Fidelity Evidence

Branch: `feat/eval-saved-market-state`

## Scope

- Added `tests/evals/cases/saved-market-state.eval.ts` with two E2 cases:
  - `saved-state-portfolio-rate-exposure-review`
  - `saved-state-spy-cost-basis-lot`
- Added `savedMarketStateFixture` support in the eval runner, using the competitive saved-state fixture values:
  - SPY: 60 shares at $480.00, cost basis $28,800.00
  - AAPL: 40 shares at $175.00
  - XLE: 100 shares at $85.00
- Added `scoreSavedMarketStateFidelity`, which checks:
  - `opencandle-route-context` contains saved-state symbols and numeric lot values
  - route/workflow avoids `portfolio_builder`
  - expected planning task family is present
  - final text repeats fixture values

## Known-Fail Status

The suite is opt-in only:

```bash
EVAL_TIER=usually OPENCANDLE_EVAL_KNOWN_FAIL_E2=1 npx vitest run --config vitest.config.evals.ts tests/evals/cases/saved-market-state.eval.ts
```

Default eval discovery records the suite as skipped with a `KNOWN-FAIL E2` marker. This follows the eval author rule: no production code was changed to make the new eval pass.

## Focused Test Evidence

- `npx vitest run tests/unit/evals/competitive-finance.test.ts tests/unit/evals/scorers.test.ts`
  - Passed: 2 files, 61 tests.
- `npx vitest run --config vitest.config.evals.ts tests/evals/cases/saved-market-state.eval.ts`
  - Passed as skipped: 1 skipped suite / 1 skipped marker.
- Opt-in known-fail run currently cannot register through `vitest-evals` in this worktree:
  - `TypeError: define is not a function`
  - The live harness traces below were collected through `tests/harness/cli.ts` instead.

## Live Trace Findings

`rates-trace.json`:

- Prompt: `is my current portfolio too exposed if rates stay high?`
- Route/workflow path: `agent_task` / `fallback` / `general_finance_qa`
- Planning task family: `portfolio_review`
- Not routed to `portfolio_builder`
- Final answer referenced saved holdings: SPY, AAPL, XLE
- Known-fail: `opencandle-route-context` did not contain saved numeric lot values such as `480`

`spy-cost-basis-trace.json`:

- Prompt: `what's my cost basis on my SPY lot?`
- Final answer contained fixture values: `60` shares, `$480.00` average cost, `$28,800.00` cost basis
- Known-fail: route/workflow path was `watchlist_or_tracking` with planning task family `stateful_tracking_update`, not `portfolio_review`
- Known-fail: `opencandle-route-context` did not contain saved numeric lot values such as `480`

