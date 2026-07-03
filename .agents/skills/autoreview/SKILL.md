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
- GUI React changes automatically run React Doctor (pinned `react-doctor@0.6.2`, `--scope changed` against the review base) against changed `gui/web/src` React files and include the structured output in the review bundle. By default, React Doctor `error` diagnostics fail the helper.
- Keep Codex as the default engine. Use `--reviewers codex,claude` only when explicitly requested or when the risk justifies the extra cost.
- Do not push just to review. Push only when the user requested push, ship, or PR update.
- Over-budget diffs are split into per-file review batches automatically (`--batch auto`, budget `--batch-budget 180000` chars) so nothing is silently truncated; each batch shares the full diffstat header and results merge into one report. With a panel, cost multiplies (reviewers x batches). `--batch off` restores single-bundle truncation, which is reported loudly as a notice.
- Deterministic diff signals (`--diff-signals auto`) inject advisory trip-wires into the reviewer prompt for recurring OpenCandle regression classes (unguarded GUI routes, direct provider fetches, sqlite schema bumps without migration tests, prompt/routing changes without fixtures, missing changelog). Signals never affect the exit code; the reviewer must confirm or dismiss each. Disable with `--diff-signals off`.
- The final report prints three advisory sections when non-empty: `pre-check signals` (diff signals found), `notices` (truncation or coverage warnings), and `out-of-scope advisory findings` (reviewer findings on files outside the diff — kept for blast-radius review instead of silently dropped; they never affect the exit code). `--json-output` includes them as `signals`, `notices`, and `out_of_scope_findings`.

## Scope Governor

Autoreview is a closeout gate, not permission to rewrite the task. Before patching a finding, classify it:

- **In-scope blocker**: introduced by the current diff, same owner boundary, fixable without changing the task's contract. Fix it.
- **Follow-up**: real but belongs to an adjacent bug class, sibling surface, cleanup, or broader hardening. Record it; do not patch it now.
- **Stop-and-escalate**: requires a new protocol/config/storage/public API contract, a different owner boundary, or a design choice outside the original request. Report the scope break instead of continuing.

Stop patching when the diff grows past 2x the original files or non-test LOC without explicit approval, or when two review-triggered patch cycles have not converged — pause and reclassify every remaining finding before another edit. Critical exceptions must be explicit: active data loss, crash, broken install/upgrade, release blocker, or concrete security exposure.

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
