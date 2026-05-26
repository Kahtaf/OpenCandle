## Summary

Add a reusable main-vs-branch replay harness for prompt-to-policy work.

The harness lets OpenCandle compare the current branch against `origin/main` on the same product and competitive prompts without depending on new scripts already existing on `main`.

## Motivation

The prompt-to-policy branch has already shown cases where the new planning architecture improves some prompts while regressing others. The current comparison workflow is too manual: it uses temporary worktrees, ad hoc prompt pinning, and report rescoring that is easy to lose after cleanup.

OpenCandle should become the best financial agent by making regressions visible at the planning, evidence, contract, and synthesis layers. A stable replay harness lets us improve capability without stuffing every recovered scenario back into one large router prompt.

## Scope

In scope:

- create a scriptable comparison harness that can run the same eval mode on the current checkout and a git ref such as `origin/main`
- support product eval replay first, with hooks for fixed-prompt competitive replay when cached competitor answers exist
- write combined reports under `tests/evals/runs/`
- classify unsupported base-ref features as harness limitations, not product wins
- add focused unit coverage for report discovery, command planning, and comparison summarization

Out of scope:

- adding new judge rubrics
- adding new external competitors
- requiring the base ref to contain current branch-only prompt-policy scripts
- making live competitive evals part of `npm test`

## Acceptance

- A developer can run one command to compare current branch product eval behavior against `origin/main`.
- The report includes branch name/ref, eval mode, report paths, score deltas, pass/fail deltas, and unsupported-run reasons.
- Unit tests cover comparison summarization without live model or network calls.
- The implementation does not require modifying `origin/main` or copying branch scripts into the base worktree.
