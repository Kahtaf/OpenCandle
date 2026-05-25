## Summary

Add an OpenCandle superiority scorecard that combines product replay, prompt-policy manifest, competitive replay, and architecture signals into one merge-gate report.

## Motivation

The branch now has several partial proofs: product replay, prompt-policy manifests, competitive fixed-prompt reports, artifact contract traces, and prompt-policy parity reports. None of them alone answers whether the branch is better than OpenCandle on `main` while preserving maintainability.

The scorecard should make the parity question explicit: OpenCandle is better when it preserves or improves main behavior, wins or ties fixed competitive prompts, exposes planning evidence for diagnosis, and keeps migration work out of the monolithic router prompt.

## Scope

In scope:

- build a deterministic scorecard from existing JSON reports
- show pass/fail status for product replay, competitive replay, prompt-policy manifest, and architecture signals
- report blocking regressions and accepted improvements separately
- include enough report paths for auditability
- add unit coverage with synthetic report inputs

Out of scope:

- running live evals directly from the scorecard script
- changing judge scoring
- using the scorecard as a CI gate before it has stable historical baselines

## Acceptance

- A developer can build one JSON scorecard from replay/manifest reports.
- The scorecard clearly says whether the branch is at, below, or above main parity.
- The scorecard includes actionable blocker reasons rather than a single opaque score.
- Unit tests cover pass and fail classification.
