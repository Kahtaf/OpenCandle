## Design

Add a small harness layer under `tests/evals/` and a CLI script under `tests/scripts/`.

The script will:

1. run the selected eval command in the current checkout
2. create a temporary git worktree for the comparison ref
3. link or reuse existing install artifacts when possible
4. run the same eval command if the base checkout supports it
5. parse the latest generated reports
6. write a combined comparison report in the current checkout

The first implementation focuses on product evals because they are deterministic enough to run repeatedly and do not require live competitor calls. Competitive replay remains explicit and fixed-prompt-only, so the harness does not accidentally make expensive external calls.

The comparison report is not a judge. It is evidence for the next improvement slice: which prompts changed, which planning fields changed when available, and whether the branch is ahead, behind, or unsupported for a case.

## Review Notes

- This supports the roadmap by making parity a repeatable gate instead of relying on a large router prompt as a memory device.
- It is general: the harness compares reports and command support, not ticker-specific outcomes.
- It is maintainable: base-ref support is detected explicitly and unsupported runs are reported rather than patched in place.
- It is extensible: competitive fixed-prompt replay can be added through the same report-comparison shape.

## Validation

- focused unit tests for comparison helpers
- `npm test -- tests/unit/evals/main-branch-replay.test.ts`
- `npm run build`
- `npm test`
- `graphify update .`
