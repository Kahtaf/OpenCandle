# Plan 007: Tighten non-budget dollar-amount detection in entity extraction

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2a508ed..HEAD -- src/routing/entity-extractor.ts tests/unit/routing/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `2a508ed`, 2026-06-11

## Why this matters

`extractBudget` pulls the first `$N` match out of a prompt as the user's
budget. A context guard (`isNonBudgetDollarAmount`) recognizes cost-basis and
premium phrasing, but only via a fixed keyword list in a ±32/24-char window.
Phrasings like "I own 100 shares now worth $6,000" or "it pays $2 in
dividends" slip through: the first dollar amount becomes the budget, which
then flows into workflow slots and the Assumptions block as
"User-specified" — a wrong financial assumption with high downstream trust.
This is a churn-hot module (entity-extractor had 18 commits since April), so a
test-anchored fix matters more than a clever one.

## Current state

```ts
// src/routing/entity-extractor.ts:61-76 (abridged)
export function extractBudget(input: string): number | undefined {
  if (
    /\b(?:at|above|below|under|over|near)\s+\$\s*[\d,]+(?:\.\d+)?\s*([kK])?\b/i.test(input) &&
    !hasBudgetContext(input)
  ) {
    return undefined;
  }
  const dollarSign = input.match(/\$\s*([\d,]+(?:\.\d+)?)\s*([kK])?\b/);
  if (dollarSign) {
    if (isNonBudgetDollarAmount(input, dollarSign.index ?? 0, dollarSign[0].length)) {
      return undefined;
    }
    ...
```

```ts
// src/routing/entity-extractor.ts:101-106
function isNonBudgetDollarAmount(input: string, start: number, length: number): boolean {
  const before = input.slice(Math.max(0, start - 32), start);
  const after = input.slice(start + length, start + length + 24);
  return /\b(?:average\s+cost|avg\s+cost|cost\s*basis|basis|entry(?:\s*price)?)\s*(?:is|at|of|:)?\s*$/i.test(before) ||
    /^\s*(?:premium|max\s+premium|average\s+cost|avg\s+cost|cost\s*basis|basis|entry(?:\s*price)?)\b/i.test(after);
}
```

There is also `hasBudgetContext(input)` (positive signal). Tests:
`tests/unit/routing/` — find the extractor's existing budget cases with
`grep -rn "extractBudget\|budget" tests/unit/routing/ | head -20` and read
them before changing behavior; they encode settled product decisions
(CHANGELOG 0.4.0 mentions "dollar-phrase-preservation" fixture class 018 in
`tests/fixtures/router/`).

## Commands you will need

| Purpose   | Command                                          | Expected on success |
|-----------|--------------------------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit`                                | exit 0              |
| Targeted  | `npx vitest run tests/unit/routing/`              | all pass            |
| Router fixtures | `npx vitest run tests/unit/routing/router.test.ts` | all pass     |
| All tests | `npx vitest run`                                  | all pass            |

## Scope

**In scope**:
- `src/routing/entity-extractor.ts` — `isNonBudgetDollarAmount` (and at most
  `extractBudget`'s use of it)
- The routing unit test file(s) covering budget extraction

**Out of scope**:
- `tests/fixtures/router/*` recorded expected outputs — if your change alters
  a recorded fixture expectation, that's a STOP condition, not an edit.
- `hasBudgetContext` and price-level phrasing (`at/above/below ... $N`) —
  already handled.
- LLM-router prompt (`src/routing/router-prompt.ts`).

## Git workflow

- Branch: `advisor/007-budget-context-guard`.
- Commit style: `Tighten non-budget dollar amount detection`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Write failing tests first (repo mandates TDD)

Add cases to the existing budget-extraction test block:

- `"I own 100 shares of AAPL now worth $6,000"` → `undefined`
- `"my position is valued at $12,500"` → `undefined` (note: "at $" may already
  be caught by the price-level guard — verify, keep the test either way)
- `"it pays $2 per share in dividends"` → `undefined`
- `"the stock is trading around $150"` → `undefined`
- Regression (must still extract): `"I have $10,000 to invest"` → `10000`,
  `"invest $5k in ETFs"` → `5000`, and every existing passing case unchanged.

**Verify**: `npx vitest run tests/unit/routing/` → the new negative cases FAIL, existing cases pass.

### Step 2: Extend the guard

Extend `isNonBudgetDollarAmount`'s keyword sets (keep the windowed-regex
shape — do not rewrite the mechanism):

- `before` set add: `worth`, `valued?\s+at`, `pays?`, `dividend(?:s)?\s+of`,
  `gained`, `lost`, `received`, `made`, `profit\s+of`, `up`, `down`
- `after` set add: `per\s+share`, `in\s+dividends?`, `profit`, `gain`, `loss`

Tune until Step 1's cases pass without breaking the positive cases. If a case
is genuinely ambiguous ("I have $5,000" vs "it gained $5,000"), prefer
extracting (current behavior) — the router's clarification flow handles
ambiguity better than silently dropping a real budget.

**Verify**: `npx vitest run tests/unit/routing/` → all pass.

### Step 3: Full regression

**Verify**: `npx vitest run` → all pass (router fixture tests in particular).

## Test plan

Covered in Step 1 — new negative and positive cases in the existing routing
test file, modeled on its current `expect(extractBudget(...)).toBe(...)`
style. Verification: `npx vitest run tests/unit/routing/` → all pass.

## Done criteria

- [x] `npx tsc --noEmit` exits 0
- [x] `npx vitest run` exits 0; ≥4 new negative cases and ≥2 positive regression cases present
- [x] No recorded fixture in `tests/fixtures/router/` modified (`git status`)
- [x] No files outside the in-scope list modified
- [x] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- A new negative case can only pass by breaking a recorded router fixture in
  `tests/fixtures/router/` — those encode product decisions; report the
  conflict.
- The guard's windowed approach fundamentally can't distinguish a case (e.g.
  needs sentence-level parsing) — report rather than growing the window past
  ~48 chars or adding a parser.
- `isNonBudgetDollarAmount` has been refactored away (drift).

## Maintenance notes

- This guard is a curated keyword list by design; when the LLM router
  (OPENCANDLE_ROUTER_MODE=llm) becomes the default, budget extraction moves to
  the model and this list becomes a rules-mode-only artifact — note in any
  router-removal plan.
- Reviewer: check no benchmark-specific phrases were added (AGENTS.md forbids
  overfitting prompts/extractors to benchmark literals; run
  `npx vitest run tests/unit/prompts/prompt-debt-guard.test.ts` if in doubt).
