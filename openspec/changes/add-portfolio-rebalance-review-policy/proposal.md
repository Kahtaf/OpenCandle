## Summary

Add a rebalance-specific portfolio review policy card for existing allocation prompts.

The task remains `portfolio_review`, but the planner should select a targeted policy card when the user asks how to rebalance, diversify, or fix concentration in an existing portfolio.

## Motivation

The branch improved portfolio review versus the old architecture but still missed important obligations in competitive review: hidden S&P 500 tech concentration, tax-aware execution, uncertainty about risk tolerance, and actionable rebalance bands.

These are stable portfolio-review obligations, not a reason to add a giant global prompt. A selected policy card keeps OpenCandle practical, maintainable, and extensible for future portfolio subtypes.

## Scope

In scope:

- add a `portfolio_rebalance_review` policy card under task family `portfolio_review`
- select it for existing-allocation prompts involving rebalance, diversify, concentration, overweight, target weights, or drift
- keep the answer contract `portfolio_review`
- add artifact placeholders for exposure map and rebalance action plan when artifact contracts exist
- test planning and prompt rendering

Out of scope:

- exact ETF holdings overlap provider work
- tax-lot optimization or account-specific tax advice
- portfolio construction workflow changes
- making S&P 500 tech concentration a ticker-specific hardcoded rule outside rebalance context

## Acceptance

- Existing-allocation rebalance prompts select `portfolio_review` with the rebalance policy card.
- Portfolio construction prompts still use `portfolio_build`.
- The policy card requires concentration/overlap review, staged/tax-aware actions, and uncertainty handling without inventing exact holdings or tax lots.
- Focused eval for the rebalance prompt shows planning parity and no regression against the previous branch behavior.
