# E1 Multi-Turn Coreference Notes

## Claimed behavior

- `tests/evals/cases/live-multi-turn-coreference.eval.ts` adds the live E1 three-turn coreference case using the I1 `runOpenCandleSession({ prompts })` harness path.
- The eval seeds an isolated OpenCandle home with an AMD portfolio lot, then runs: "tell me about NVDA" -> "what about at $500?" -> "and compare it to the one I hold".
- Assertions inspect `opencandle-router` and `opencandle-route-context` custom entries for prompt-indexed router entities, slot provenance, and priorTurns presence.

## Suite placement

- The case is `usually` tier and live opt-in: `EVAL_TIER=usually OPENCANDLE_LIVE_MULTI_TURN_EVAL=1`.
- Because current behavior fails saved-state coreference, it is also known-fail gated behind `OPENCANDLE_RUN_KNOWN_FAIL_EVALS=1` and skipped by default.

## Evidence

- `trace.json`: credentialed live harness trace.
- `summary.json`: compact observed-router summary from the live run.
