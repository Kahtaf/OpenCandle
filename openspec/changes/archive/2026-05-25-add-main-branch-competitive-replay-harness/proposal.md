## Summary

Add a fixed-prompt competitive replay harness that compares the current prompt-to-policy branch against `origin/main` using the same competitive report shape and cached generic-agent answers.

## Motivation

Product replay says whether the branch preserved internal OpenCandle behavior. It does not answer the harder question: whether the new router/planning architecture beats OpenCandle on `main` on prompts where generic agents are also strong.

OpenCandle should become the best financial agent by making regressions visible at the planning, evidence, answer-contract, and synthesis layers. The comparison must preserve the forward architecture and avoid stuffing every recovered case into the large router prompt.

## Scope

In scope:

- compare current and base competitive finance reports for matching fixed prompts
- summarize OpenCandle score deltas, winner changes, planning metadata, cached competitor coverage, and regression reasons
- provide a CLI entry point that can either compare existing reports or run fixed prompts against a base ref when supported
- keep generic competitor answers cached/reused where available
- add focused unit coverage for comparison behavior without live model calls

Out of scope:

- adding new judge rubrics or external competitors
- making competitive replay part of `npm test`
- patching current branch scripts into the base worktree
- treating unsupported base refs as branch wins

## Acceptance

- A developer can produce a current-vs-main competitive comparison report under `tests/evals/runs/`.
- The report identifies regressions and improvements per fixed prompt.
- The report includes planning metadata so wins/losses can be tied back to the new architecture.
- Unit tests cover report comparison without network or live model calls.
