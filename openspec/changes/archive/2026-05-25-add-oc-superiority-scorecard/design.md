## Design

Create `tests/evals/oc-superiority-scorecard.ts` as a pure report-composition module and a small CLI wrapper that reads report paths.

The scorecard should avoid pretending precision it does not have. It should classify layers:

- `productReplay`: pass when branch aggregate/pass count is no worse than base or unsupported is explicitly recorded
- `competitiveReplay`: pass when fixed prompts do not regress against the base report and current OpenCandle wins/ties remain acceptable
- `promptPolicy`: pass when manifest reports have zero failed cases
- `architectureSignals`: pass when planning metadata, artifact contracts, and structured checks are present where expected

The top-level status should be:

- `better_than_main`: no blocking regressions and at least one material improvement
- `at_main_parity`: no blocking regressions and no material improvement
- `below_main_parity`: one or more blocking regressions
- `incomplete`: required report inputs are missing or unsupported

## Review Notes

- The scorecard composes evidence; it does not introduce product behavior.
- The scorecard keeps feature parity measurable without enlarging the router prompt.
- Architecture signals are intentionally generic and extensible.
