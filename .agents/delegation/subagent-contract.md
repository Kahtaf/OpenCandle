# Subagent Contract

## Per-run variables

- Owned tasks: `<fill in>`
- Commit policy: `commit-here` or `leave-uncommitted`
- Branch + PR target: `<fill in>`
- Test scope beyond gates: `<fill in>`
- Extra constraints: `<fill in>`

## Standing clauses

- Run `npm run bootstrap:agent` first in a fresh worktree.
- If the plan and repo contradict, stop and report the contradiction verbatim; do not adapt.
- Use TDD: write the failing test first and observe it fail before implementation.
- Run `npm run gates` and keep it green before handoff.
- Truthfully do not check off tasks you did not do; record truth with dated notes and declare deviations.
- Never modify production code merely to make evals pass.
- If credentials for a live eval are missing, stop and report; do not substitute mocks as live evidence.
- Always ensure you never print secret values.
- Touch only your Owned tasks and do not rewrite parallel work.
- Add one `CHANGELOG` `[Unreleased]` entry per atomic feature or fix.
- Run `graphify update .` after code changes.
- If the run opens or updates a PR, wait asynchronously for the automated Codex review: monitor with `gh pr checks --watch` (the `Codex review gate` status stays pending until the review completes) and `gh pr view --comments`; then address or rebut every comment and resolve every thread before reporting the PR review-clean.
- Final report: files changed, proof outputs, and deviations.
