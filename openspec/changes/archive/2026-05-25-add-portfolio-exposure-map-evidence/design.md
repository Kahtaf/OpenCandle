## Design

Extend planning evidence with a deterministic `portfolio_exposure_map` record for portfolio rebalance review prompts.

The parser should be intentionally conservative:

- capture percentages adjacent to allocation/sleeve nouns
- normalize common sleeves such as tech, S&P 500/index, bonds, cash, international, and broad equity
- compute direct exposure totals only from user-provided percentages
- add a qualitative broad-index overlap caveat when S&P 500/index plus sector sleeves appear together
- record `etf_holdings_overlap` as an unresolved capability gap for exact holdings/issuer overlap

The harness should include this record when the planning policy card is `portfolio_rebalance_review`, so evals can assert the evidence exists before answer rendering is enforced.

## Review Notes

- No exact financial facts are guessed.
- The design is general allocation parsing, not ticker/sector overfitting.
- This is a trace/evidence layer improvement that keeps the large prompt from carrying the full scenario checklist.
