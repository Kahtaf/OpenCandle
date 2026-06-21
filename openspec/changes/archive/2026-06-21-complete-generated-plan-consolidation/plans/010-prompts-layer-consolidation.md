# Plan 010: Snapshot the prompts layer and map duplication (consolidation gated on findings + operator approval)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2a508ed..HEAD -- src/prompts/`
> The prompts layer is the highest-churn area of this repo — drift is LIKELY.
> If any in-scope file changed, re-verify the duplication map in Step 1 before
> consolidating anything.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (prompt output changes can shift eval baselines and agent behavior)
- **Depends on**: none, but do NOT run concurrently with any other prompt-touching work
- **Category**: tech-debt
- **Planned at**: commit `2a508ed`, 2026-06-11

## Why this matters

The prompts layer is the repo's hottest churn zone — `context-builder.ts` (326
lines, 42 commits since April), `policy-cards.ts` (220 lines, 26 commits),
`workflow-prompts.ts` (457 lines, 22 commits). Both policy-cards and
workflow-prompts encode guidance per task family (single-asset decisions,
options strategies, portfolio review…), so one product decision routinely
requires edits in two or three files, and the CHANGELOG records a string of
parity bugs from missing one (options-policy leaking into hedge prompts,
assumptions-block inconsistencies). Consolidating to one source of guidance
per task family turns three coordinated edits into one.

IMPORTANT CONSTRAINT (AGENTS.md): prompt-content changes require asking the
owner first, and benchmark literals must stay in manifests/tests. This plan is
therefore **structure-preserving**: identical final prompt strings, different
file organization. Any step that would change emitted text is a STOP.

EXECUTION SHAPE — this is a **discovery-first** plan in two phases:

- **Phase A (Steps 1–2, always executed)**: snapshot suite + duplication map.
  Completing Phase A and reporting the map is a legitimate DONE state for
  this plan.
- **Phase B (Steps 3–4, GATED)**: consolidation. Proceed ONLY if BOTH hold:
  (a) Phase A's map shows ≥3 genuinely duplicated task families, and
  (b) the operator has explicitly approved Phase B after reading the map.
  Prompt refactors carry high regression risk even under the same-final-string
  constraint; the snapshots alone already deliver most of the safety value.

## Current state

- `src/prompts/policy-cards.ts` — per-task-family reasoning policy snippets.
- `src/prompts/workflow-prompts.ts` — workflow prompt builders
  (`buildPortfolioPrompt`, `buildCompareAssetsPrompt`, …) including
  assumptions-block rendering and disclosure language.
- `src/prompts/context-builder.ts` — assembles per-turn context (saved
  market-state summaries, policy cards, general finance guidance).
- Existing guard: `tests/unit/prompts/prompt-debt-guard.test.ts` (must keep
  passing — AGENTS.md calls it out by name).
- Tests: `tests/unit/prompts/context-builder.test.ts`, `policy-cards.test.ts`,
  `workflow-prompts.test.ts` — extensive (41/25/16 commits of accumulated
  cases). These are the behavior contract.

The advisor did NOT map the exact duplication sites (the files churn too fast
for line-level citations to survive); Step 1 makes the executor build that map
fresh.

## Commands you will need

| Purpose   | Command                                                 | Expected on success |
|-----------|---------------------------------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit`                                       | exit 0              |
| Prompts   | `npx vitest run tests/unit/prompts/`                     | all pass            |
| Debt guard| `npx vitest run tests/unit/prompts/prompt-debt-guard.test.ts` | all pass      |
| All tests | `npx vitest run`                                         | all pass            |

## Scope

**In scope**:
- `src/prompts/policy-cards.ts`, `src/prompts/workflow-prompts.ts`,
  `src/prompts/context-builder.ts`
- New module(s) under `src/prompts/` (e.g. `task-family-guidance.ts`)
- `tests/unit/prompts/` — snapshot additions and import updates only

**Out of scope**:
- ANY change to emitted prompt strings (the snapshots in Step 1 are the law).
- `src/system-prompt.ts` (AGENTS.md: ask first).
- `src/routing/` (consumes prompts; don't touch).
- Deleting or weakening `prompt-debt-guard.test.ts`.

## Git workflow

- Branch: `advisor/010-prompts-consolidation`.
- Commit 1: snapshots. Commits 2+: one consolidation move each, snapshots
  green after every commit.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Pin current behavior with snapshots

Create `tests/unit/prompts/prompt-output-snapshots.test.ts`: for every
exported builder in `workflow-prompts.ts` and every policy card in
`policy-cards.ts`, call it with 2 representative fixed inputs (reuse input
shapes from the existing unit tests in the same directory) and
`expect(output).toMatchSnapshot()`. Also snapshot `context-builder`'s main
assembly for 3 representative turns.

**Verify**: `npx vitest run tests/unit/prompts/` → all pass; snapshot file
committed.

### Step 2: Build the duplication map — END OF PHASE A

Read all three files end to end. Produce (in the PR description, not a repo
doc) the list of task families whose guidance text or selection logic appears
in BOTH policy-cards and workflow-prompts, with current line refs.

**Then STOP and report the map to the operator regardless of what it shows.**
Mark this plan's Phase A status in `plans/README.md` with a one-line pointer
to the map. Do not begin Step 3 in the same execution run; Phase B
requires explicit operator approval, and is skipped entirely if fewer than 3
families are genuinely duplicated.

### Step 3 (PHASE B — gated on operator approval): Consolidate, one family at a time

For each duplicated family: move the canonical text/logic into a single
module (`task-family-guidance.ts` with one exported entry per family);
policy-cards and workflow-prompts import from it and assemble exactly the
same final strings.

**Verify after EACH family**: `npx vitest run tests/unit/prompts/` → all pass
with ZERO snapshot updates (`--update` is forbidden in this plan). Commit.

### Step 4 (PHASE B): Full regression

**Verify**: `npx vitest run` → all pass; `npx vitest run tests/unit/prompts/prompt-debt-guard.test.ts` → pass.

## Test plan

- Step 1's snapshot suite is the primary new test artifact (keep it after the
  refactor — it's cheap drift insurance for this hot module).
- All existing prompts tests pass unmodified except import paths.
- Verification: `npx vitest run` → all pass, no snapshot churn.

## Done criteria

Phase A (sufficient for DONE):

- [x] Snapshot suite exists and passes (`npx vitest run tests/unit/prompts/`)
- [x] Duplication map reported to the operator (PR description or report-back)
- [x] `npx tsc --noEmit` exits 0; `npx vitest run` exits 0
- [x] `plans/README.md` status row updated for the completed phase status

Phase B (only if approved and executed):

- [x] Zero snapshot changes across the refactor (`git log -p -- tests/unit/prompts/__snapshots__ | grep -c "^+"` shows only the initial add)
- [x] Each duplicated task family has exactly one guidance source (`grep` the moved literals — each appears in one src file)

## STOP conditions

Stop and report back if:

- You reach the end of Step 2 — ALWAYS (Phase B needs operator approval).
- Any consolidation step requires changing an emitted string, even
  whitespace — that needs owner sign-off per AGENTS.md.
- A snapshot fails and the only fix is `--update`.
- Another branch/PR is actively modifying `src/prompts/` (check
  `git log --since="1 week ago" -- src/prompts/` and ask the operator).

## Maintenance notes

- Future guidance edits should land in `task-family-guidance.ts` only; a
  reviewer seeing per-family text added back into policy-cards or
  workflow-prompts should push back.
- The snapshot suite will legitimately need `--update` when the owner
  intentionally changes prompt content — that's its purpose: making prompt
  diffs visible in review rather than incidental.
- When the LLM router becomes default and the rules path is removed
  (openspec/changes/remove-rule-router), re-audit which policy cards are
  still reachable.
