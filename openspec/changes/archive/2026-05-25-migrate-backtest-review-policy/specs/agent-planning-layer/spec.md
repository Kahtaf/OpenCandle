## ADDED Requirements

### Requirement: Backtest Review Policy Migration

The planning layer SHALL support a replacement-active `backtest_review` slice for prompts that ask to run or interpret a strategy backtest.

#### Scenario: Backtest prompts use the backtest review policy

- **WHEN** the user asks to backtest a strategy
- **THEN** the planner selects `backtest_review`
- **AND** the route remains an agent task with the current router workflow label preserved
- **AND** the answer contract requires backtest metric coverage, risk/downside, data-gap disclosure, and source coverage

#### Scenario: Backtest policy preserves practical edge discussion

- **WHEN** a backtest answer is synthesized
- **THEN** it reports strategy return, buy-and-hold return, outperformance, trade count, win rate, max drawdown, and risk-adjusted metrics when available
- **AND** it discusses costs, slippage, or unavailable cost assumptions when the user asks whether the edge is practical
