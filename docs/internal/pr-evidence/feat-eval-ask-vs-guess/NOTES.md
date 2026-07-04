# E5 Ask-Instead-Of-Guess Eval Notes

## Scope

This PR adds E5 boundary eval coverage only. It does not modify production routing, prompts, workflow code, or tools.

## Behavior Mapping

- Ambiguous `"Should I sell my calls?"` with two saved option positions: `ask-vs-guess-ambiguous-sell-my-calls` expects exactly one focused `ask_user` and no guessed NVDA/AMD resolution before clarification.
- Ambiguous `"Compare the banks."` with no tickers: `ask-vs-guess-ambiguous-compare-the-banks` expects exactly one focused `ask_user` and no guessed bank ticker resolution before clarification.
- Resolvable calls twin: `ask-vs-guess-prior-turn-sell-my-calls` uses prior turn context plus the seeded saved option positions and expects zero `ask_user`, options workflow routing, and NVDA-only resolution.
- Resolvable banks twin: `ask-vs-guess-prior-turn-compare-the-banks` uses prior turn context and expects zero `ask_user` plus JPM/BAC resolution.

## Tests

- `tests/unit/evals/product-evals.test.ts` verifies exact `ask_user` scoring, no-guess symbol assertions, prior-turn resolution assertions, E5 case pairing, and opt-in tiering.
- `tests/evals/product/scorer.ts` now scores exact ask count, ask question focus, and resolved symbol presence/absence from trace evidence.
- `tests/scripts/run-product-evals.ts` supports opt-in product cases, multi-prompt product cases, and disposable seeded market-state fixtures.

## Live Evidence

- `ambiguous-compare-the-banks.product-evals.json`: FAIL, asks once but still resolves JPM/BAC/WFC/C before user clarification.
- `ambiguous-sell-my-calls.product-evals.json`: FAIL, does not ask and resolves both seeded option underlyings.
- `prior-turn-compare-the-banks.product-evals.json`: PASS, no ask and resolves JPM/BAC.
- `prior-turn-sell-my-calls.product-evals.json`: FAIL, asks despite prior context and includes AMD in resolution.
