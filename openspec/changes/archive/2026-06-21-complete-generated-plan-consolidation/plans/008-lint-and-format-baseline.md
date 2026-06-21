# Plan 008: Add a lint/format baseline (Biome) and gate it in CI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `ls biome.json eslint.config.* .prettierrc* 2>/dev/null`
> If any lint/format config now exists, this plan is stale — STOP and report.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (large one-time diff risk if formatting is applied carelessly)
- **Depends on**: none — but land AFTER plans 001–007 to avoid churning their diffs
- **Category**: dx
- **Planned at**: commit `2a508ed`, 2026-06-11

## Why this matters

The repo has no lint or format configuration at all (no eslint, biome, or
prettier config anywhere; CI gates only `npx tsc --noEmit` + `npm test`).
AGENTS.md declares conventions — "Strictly typed. No `any` except provider raw
API responses", kebab-case files, `.js` import extensions — that nothing
enforces; a grep finds 200+ `any`/cast sites. The project explicitly invites
third-party add-on tool contributors (docs/build-a-tool.md), who get no
automated style guardrails. One tool (Biome: linter + formatter, single
binary, fast) closes this with minimal dependency surface.

## Current state

- No config files: verified `ls .prettierrc* eslint.config.* biome.json .eslintrc*` → none.
- CI: `.github/workflows/ci.yml` jobs: checkout → setup-node 22 → `npm ci` →
  `npx tsc --noEmit` → npm-pack content check → `npm test`.
- Workspaces: root (`src/`, `tests/`), `gui/server`, `gui/web` (React 19 + Vite + Tailwind).
- Style observed in source: 2-space indent, double quotes, semicolons,
  trailing commas in multiline, ~100-col lines.
- devDependencies live in root `package.json`; scripts are root-level.

## Commands you will need

| Purpose    | Command                                       | Expected on success |
|------------|-----------------------------------------------|---------------------|
| Install    | `npm install --save-dev --save-exact @biomejs/biome` | exit 0       |
| Lint check | `npx biome check .`                            | exit 0 after Step 3 |
| Typecheck  | `npx tsc --noEmit`                             | exit 0              |
| Tests      | `npx vitest run`                               | all pass            |
| GUI build  | `npm run gui:web:build`                        | exit 0              |

## Scope

**In scope**:
- `biome.json` (create, root)
- root `package.json` (devDependency + `lint`/`format` scripts)
- `.github/workflows/ci.yml` (one added step)
- Mechanical formatting/lint-fix diffs across `src/`, `gui/`, `tests/` produced
  by `biome check --write` — in a **separate commit** containing nothing else

**Out of scope**:
- `dist/`, `node_modules/`, `graphify-out/`, `validation-output/`, `website/`,
  `openspec/`, `docs/`, `.agents/`, fixtures under `tests/fixtures/` (exclude
  all of these in `biome.json` `files.ignore`).
- Fixing pre-existing `any` usage — set the `noExplicitAny` rule to `"warn"`,
  not `"error"`; tightening is a follow-up.
- Renaming files or changing import styles.

## Git workflow

- Branch: `advisor/008-lint-baseline`.
- THREE commits, strictly separated:
  1. `Add Biome config and scripts` (config + package.json + CI)
  2. `Apply Biome formatting` (mechanical only — no manual edits)
  3. (only if needed) `Fix lint findings` (manual, small)
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Install and configure

`npm install --save-dev --save-exact @biomejs/biome`, then create `biome.json`:

- formatter: 2-space indent, line width 100, double quotes, semicolons always,
  trailing commas `all` — chosen to match existing style so the mechanical
  diff stays small.
- linter: `recommended: true`; downgrade to `"warn"` any rule with >50
  existing violations (measure with `npx biome check . 2>&1 | tail -20` before
  deciding); `noExplicitAny: "warn"`.
- `files.ignore`: the out-of-scope list above plus `*.md`, `package-lock.json`.
- organizeImports: enabled.

Add scripts to root `package.json`:
`"lint": "biome check ."`, `"format": "biome check --write ."`.

**Verify**: `npx biome check . 2>&1 | tail -5` → runs and reports (count noted, not yet clean).

### Step 2: Measure, then apply mechanically

Record the violation count. If error-level findings exceed ~200 after rule
tuning, STOP and report the breakdown (the right rule set is a judgment call
for the maintainer at that scale). Otherwise run `npx biome check --write .`
and commit the mechanical diff alone.

**Verify**: `npx tsc --noEmit` → exit 0; `npx vitest run` → all pass;
`npm run gui:web:build` → exit 0. If any fail, the formatter changed behavior
(almost always an organize-imports side effect on import order with
side-effectful modules) — STOP and report the failing file.

### Step 3: Clean remaining errors and gate CI

Fix remaining error-level findings manually (commit 3). Then add to
`.github/workflows/ci.yml` after the Typecheck step:

```yaml
      - name: Lint
        run: npx biome ci .
```

**Verify**: `npx biome check .` → exit 0; full test suite passes.

## Test plan

No new unit tests. The gate is: `npx biome ci .` exits 0, and the existing
suite + GUI build prove the mechanical diff is behavior-neutral.

## Done criteria

- [x] `biome.json` exists; `npm run lint` exits 0
- [x] CI workflow contains the `biome ci` step
- [x] `npx tsc --noEmit` exits 0; `npx vitest run` exits 0; `npm run gui:web:build` exits 0
- [x] Formatting changes isolated in their own commit (verify `git log --stat`)
- [x] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Any lint/format config already exists (drift — someone beat you to it).
- Error-level findings exceed ~200 after reasonable rule tuning.
- The mechanical format commit breaks tests or the GUI build and the cause
  isn't an obvious import-order issue you can exclude via config.
- Plans 001–007 are not complete per `plans/README.md` — formatting now would
  conflict with their diffs; coordinate ordering with the operator.

## Maintenance notes

- The repo's other plans (001–007) were written against unformatted code;
  if this plan lands first, their "Current state" excerpts may mismatch on
  whitespace — executors should treat whitespace-only drift as acceptable.
- Follow-ups deferred: raising `noExplicitAny` to error per-directory
  (start with `src/tools/`), import-extension lint rule (`.js` suffix
  enforcement) if Biome supports it by then, pre-commit hook (husky) if the
  team wants it — CI-only is the deliberate starting point.
