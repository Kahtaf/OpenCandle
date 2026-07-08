# Tasks

## 1. Verify classification

- [x] 1.1 Re-run the reference check before moving anything: for each file in the proposal's Archive list, `grep -rl "<basename-without-extension>" src tests gui scripts .github package.json` must return zero results. Any file with a hit moves to the Keep list and the proposal's classification section is amended in the same PR.
- [x] 1.2 Read the header of `claude-code-principles-for-opencandle.md`: if it self-describes as a point-in-time exercise rather than evergreen guidance, add it to the Archive list; otherwise it stays. Record the decision in the PR description.

## 2. Archive

- [x] 2.1 Create `docs/internal/archive/` and `docs/internal/archive/README.md` with the index header ("Archived internal docs. Operative docs live one level up. Do not treat anything here as current guidance.").
- [x] 2.2 `git mv` every Archive-list file (and the `baselines/` directory) into `docs/internal/archive/`, preserving file names. No content edits.
- [x] 2.3 Add one index line per moved file to `docs/internal/archive/README.md`: title, one-sentence description, archive date (today), reason (delivered / superseded-by-X / point-in-time).

## 3. Fix references

- [x] 3.1 Update cross-references (full inventory verified 2026-07-05 — these are the only ones outside the archive set): `openspec/changes/forget-command/tasks.md` lines ~36-37 reference `docs/internal/high-leverage-improvements-plan.md` twice (active change — MUST update to the archived path). Mutual references between `openspec-backlog-cleanup-plan.md` ↔ `high-leverage-improvements-plan.md` and `prompt-to-policy-migration-baseline.md` → `baselines/` move together and may stay relative. Nothing in README, CONTRIBUTING, public `docs/`, AGENTS.md, CLAUDE.md, or `.claude/` references any archived file. Re-run the grep to confirm before merging.
- [x] 3.2 `competitive-benchmark-history.md` references `agent-improvement-prompt-suite.md`'s prompt IDs but never its file path (verified) — no edit needed; confirm with a grep.
- [x] 3.3 Opportunistic: the `docs-cleanup` capability spec names `docs/production-plan.md` as a public doc that must remain — that file no longer exists. Note the stale example in the PR description (fixing the base spec is out of scope for this change).

## 4. Verification

- [x] 4.1 `npm test` green (proves no test reads a moved path).
- [x] 4.2 `npx tsc --noEmit` and `npx biome ci .` green.
- [x] 4.3 `ls docs/internal/` shows only: the Keep-list files, `archive/`, and the git-ignored `pr-evidence/`.
- [x] 4.4 CHANGELOG `[Unreleased]` entry under Fixed or Changed noting the archive pass.
- [x] 4.5 `npx openspec validate archive-internal-docs --strict` passes; archive this change through the OpenSpec CLI after merge.
