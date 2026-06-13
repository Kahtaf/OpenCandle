---
name: autoreview
description: Run OpenCandle's repo-local autoreview helper for local branch, PR, or commit review. Use when the user asks for autoreview, PR review, second-model review, or a final closeout review before commit, push, merge, or release.
---

# Auto Review

Run the bundled structured review helper as an advisory closeout check for OpenCandle PRs and local branches.

Default PR branch review (base auto-detects from the open PR via `gh`, falling back to `origin/main`; pass `--base` only to override — stacked PRs often target a feature branch, and a wrong base reviews the whole stack):

```bash
.agents/skills/autoreview/scripts/autoreview --mode branch --prompt-file .agents/skills/autoreview/references/opencandle-review.md
```

The npm alias is equivalent and additionally gates on typecheck + unit tests run in parallel with the review:

```bash
npm run review:pr
```

## Contract

- Treat output as advisory. Verify every finding by reading the real code path before fixing or reporting it.
- Review the full branch diff, not just the latest commit, unless the user explicitly asks for a commit-only review.
- Prefer small fixes at the right ownership boundary. Do not refactor unrelated code.
- GUI React changes automatically run React Doctor against changed `gui/web/src` React files and include the structured output in the review bundle. By default, React Doctor `error` diagnostics fail the helper.
- Keep Codex as the default engine. Use `--reviewers codex,claude` only when explicitly requested or when the risk justifies the extra cost.
- Do not push just to review. Push only when the user requested push, ship, or PR update.

## Pick Target

Dirty local work:

```bash
.agents/skills/autoreview/scripts/autoreview --mode local --prompt-file .agents/skills/autoreview/references/opencandle-review.md
```

Open PR or feature branch:

```bash
.agents/skills/autoreview/scripts/autoreview --mode branch --prompt-file .agents/skills/autoreview/references/opencandle-review.md
```

Branch review requires a clean worktree so it cannot silently skip local edits. Commit or stash local changes first, or use `--mode local` to review dirty work.

Already-landed or single committed change:

```bash
.agents/skills/autoreview/scripts/autoreview --mode commit --commit HEAD --prompt-file .agents/skills/autoreview/references/opencandle-review.md
```

For a merged GitHub PR, pass the merge commit SHA. The helper reviews merge commits against their first parent so the PR diff is in scope.

Explicit commit-to-commit range:

```bash
.agents/skills/autoreview/scripts/autoreview --mode range --base <base-commit> --head <head-commit> --prompt-file .agents/skills/autoreview/references/opencandle-review.md
```

Range mode reviews exactly `git diff <base-commit> <head-commit>` and validates findings against files changed in that diff.

Add extra evidence when available:

```bash
.agents/skills/autoreview/scripts/autoreview --mode branch \
  --prompt-file .agents/skills/autoreview/references/opencandle-review.md \
  --dataset validation-output/<evidence>.json
```

Override the UI React Doctor gate only when needed:

```bash
.agents/skills/autoreview/scripts/autoreview --mode local --react-doctor off
.agents/skills/autoreview/scripts/autoreview --mode local --react-doctor-fail-on warning
```

## Final Report

Include:

- review command used
- tests and runtime proof run
- React Doctor summary for GUI React changes, or why it was skipped
- findings accepted and fixed, if any
- findings rejected, briefly why
- final clean autoreview result, or why a remaining finding was consciously rejected

Do not run another review just to improve the final report wording.
