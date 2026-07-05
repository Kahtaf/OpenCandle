# Archive Completed docs/internal Plans

## Why

`docs/internal/` currently mixes operative documents (the competitive-benchmarking process, the append-only benchmark history ledger, the code-referenced prompt-policy manifest) with completed plans, point-in-time audits, and superseded records. A new contributor or agent cannot tell current state from history, and stale plans keep getting read as if they were live guidance. The same hygiene applied to `docs/internal/pr-evidence/` (pruned 2026-07-04) should apply to the planning docs.

## What Changes

- Create `docs/internal/archive/` with a `README.md` index (one line per archived doc: title, one-sentence description, archive date, why archived).
- `git mv` the completed/point-in-time documents listed below into `docs/internal/archive/`, preserving file names and git history.
- Update any cross-references in remaining `docs/`, `docs/internal/`, `openspec/`, `AGENTS.md`, and `CLAUDE.md` markdown to the new paths.
- Leave every operative document in place, untouched.

## Classification (decided; do not re-derive)

**Archive** (completed, superseded, or point-in-time record):

- `agent-improvement-prompt-suite.md` — self-declares "Historical record (2026-05)".
- `codebase-audit.md` — point-in-time audit.
- `competitive-analysis.md` — point-in-time analysis.
- `eval-framework-plan.md` — delivered.
- `high-leverage-improvements-plan.md` — executed on `feat/high-leverage-improvements` (merged as PR #85); remaining items are superseded by the 2026-07-05 OpenSpec changes (`freshness-ledger`, `answer-receipts`, `saved-state-personalization`, `close-the-loop`, `competitive-panel-hard-assertions`, `eval-entrypoint-consolidation`, and peers).
- `openspec-backlog-cleanup-plan.md` — fully merged as PR #64.
- `pr85-open-items.md` — PR #85 merged; triage record complete.
- `prompt-to-policy-failure-classification.md`, `prompt-to-policy-migration-baseline.md`, `prompt-to-policy-parity-ledger.md` — migration records; the migration is complete. (The **manifest JSON stays** — see below.)
- `release-readiness-audit-2026-06-20.md`, `release-readiness-audit-2026-06-21.md` — point-in-time audits; findings shipped as release gates.
- `baselines/` (the `prompt-to-policy/2026-05-24` snapshot) — point-in-time baseline for the completed migration.

**Keep in `docs/internal/` (operative):**

- `prompt-to-policy-migration-manifest.json` — load-bearing: referenced by 7 code/test files including `tests/unit/prompts/prompt-debt-guard.test.ts`, `tests/evals/prompt-policy-assertions.ts` consumers, and `tests/scripts/run-competitive-finance-eval.ts`. MUST NOT move.
- `competitive-benchmarking.md` — operative benchmark process documentation.
- `competitive-benchmark-history.md` — operative append-only ledger, still appended per run.
- `router-gemini-triage-table.md` — active justification record for the live router eval's `stripNonContract` exemptions.
- `agent-usefulness-memory-design.md` — design for future (unimplemented) memory work.
- `claude-code-principles-for-opencandle.md` — evergreen guidance; verify header before keeping (see tasks).

## Non-Goals

- No content edits to archived documents beyond nothing at all — archived files move byte-identical.
- No deletion of any file.
- No changes to `openspec/changes/archive/` (OpenSpec has its own archive mechanism).
- No changes to the git-ignored `docs/internal/pr-evidence/` directory.

## PR Description Notes

- `claude-code-principles-for-opencandle.md` stays in `docs/internal/`: its header describes reusable OpenCandle design guidance for maintainers, not a completed point-in-time exercise.
- The base `docs-cleanup` capability spec still names `docs/production-plan.md` as a public doc that must remain, but that file no longer exists; fixing the base spec example is out of scope for this archive pass.
