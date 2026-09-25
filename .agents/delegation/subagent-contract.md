# Subagent Contract

## Per-run variables

- Owned tasks: `<fill in>`
- Commit policy: `commit-here` or `leave-uncommitted`
- Branch + PR target: `<fill in>`
- Test scope beyond gates: `<fill in>`
- Extra constraints: `<fill in>`

## Standing clauses

- Run `npm run bootstrap:agent` first in a fresh worktree.
- If the plan and repo contradict, stop and report the contradiction verbatim to the parent with a
  concrete diagnosis; preserve useful progress and do not adapt silently.
- Use TDD: write the failing test first and observe it fail before implementation.
- Run the assigned proof scope and keep it green before handoff. The parent may own the full/live gate
  centrally; when it does, run focused proof and report required pending work honestly.
- On any failure, do not stop at a report: diagnose the cause, reproduce it as a credible regression
  red at the declared boundary, fix the actual cause at the narrowest durable layer, and verify with a
  focused run. Classify first: product defect, inaccurate assertion, or harness/environment issue.
- Never weaken, delete, or bypass a required check, retry until green, overfit prompts to a benchmark,
  or suppress failed evidence. If the cause is genuinely unavailable credentials or an external
  dependency, hand the parent a concrete diagnosis and preserve useful progress; never substitute
  mocks as live evidence or otherwise invent proof.
- Truthfully do not check off tasks you did not do; record truth with dated notes and declare deviations.
- Never modify production code merely to make evals pass.
- Always ensure you never print secret values.
- Touch only your Owned tasks and do not rewrite parallel work.
- Add one `CHANGELOG` `[Unreleased]` entry per atomic feature or fix.
- If the run opens or updates a PR, check for any advisory Codex review that ran automatically when the PR was created; request another with `@codex review` when useful. Do not wait for or require a Codex status check, but address or rebut any review comments before reporting the PR review-clean.
- Final report: files changed, proof outputs, and deviations.
