## Summary

Add deterministic portfolio exposure-map evidence for rebalance review prompts so OpenCandle can reason about concentration and hidden overlap without relying only on prose instructions.

## Motivation

Main prompt behavior often does well on portfolio questions because the large prompt reminds the agent to inspect concentration, hidden index overlap, target bands, and tax caveats. The new architecture should capture those obligations as typed planning evidence and answer contracts.

The first step should be provider-light and honest: parse user-stated allocation percentages, identify direct sleeves and broad-index overlap caveats, and disclose that exact holdings overlap remains a provider capability gap.

## Scope

In scope:

- add a `portfolio_exposure_map` planning evidence type
- build deterministic exposure-map records from user prompts with allocation percentages
- include broad-index overlap and exact-holdings caveats without inventing exact current holdings
- attach exposure-map evidence to portfolio rebalance review planning traces
- add unit coverage for normalization and harness telemetry

Out of scope:

- live ETF/index constituent fetching
- tax-lot optimization
- ticker/sector-specific hardcoding
- active answer rewriting from the evidence record

## Acceptance

- Portfolio rebalance review traces include a portfolio exposure-map evidence record when allocation percentages are present.
- The record includes direct sleeves, approximate broad-index overlap caveats, target-band prompts, and the `etf_holdings_overlap` capability gap.
- Unit tests verify the evidence record without live provider calls.
