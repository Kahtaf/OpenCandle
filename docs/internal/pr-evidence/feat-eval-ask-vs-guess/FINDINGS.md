# E5 Current-Behavior Findings

The E5 product eval cases are marked `tier: "opt-in"` because current live behavior does not satisfy three of the four boundary cases. This follows the I5 eval-author rule: failing current behavior is recorded as a finding, not fixed in production by this eval PR.

## Findings

- `ask-vs-guess-ambiguous-compare-the-banks`: OpenCandle calls `ask_user` exactly once, but the trace also resolves guessed bank symbols (`JPM`, `BAC`, `WFC`, `C`) before the user specifies tickers.
- `ask-vs-guess-ambiguous-sell-my-calls`: OpenCandle does not call `ask_user`; it resolves both seeded option underlyings (`NVDA`, `AMD`) for the ambiguous pronoun-backed request.
- `ask-vs-guess-prior-turn-sell-my-calls`: OpenCandle asks for clarification even though the prior turn names NVDA, routes as `general_finance_qa` instead of `options_screener`, and still includes AMD in resolved symbols.

## Passing Twin

- `ask-vs-guess-prior-turn-compare-the-banks`: OpenCandle correctly uses prior turn context, asks zero clarification questions, routes to `compare_assets`, and resolves `JPM`/`BAC`.

## Promotion Criteria

Promote these cases out of opt-in only after all paired cases pass in live traces: ambiguous cases must ask exactly once without pre-clarification ticker guessing, and resolvable twins must ask zero times while resolving only the contextual symbols.
