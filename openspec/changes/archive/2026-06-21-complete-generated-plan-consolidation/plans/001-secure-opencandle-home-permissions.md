# Plan 001: Write OpenCandle config and state files with owner-only permissions

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2a508ed..HEAD -- src/config.ts src/infra/opencandle-paths.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `2a508ed`, 2026-06-11

## Why this matters

`~/.opencandle/config.json` stores plaintext API keys for every configured data
provider (AlphaVantage, FRED, Finnhub, Exa, Brave, plus model keys). It is
written with Node's default file mode, which yields `0644` (world-readable)
under the usual umask — verified on a live install. The `~/.opencandle/`
directory itself is created with default mode too. Any other local user on the
machine can read all of the user's provider credentials. The fix is to create
the directory `0700` and write sensitive files `0600`.

## Current state

- `src/config.ts` — config load/save. `saveFileConfig` at lines 223–226:

```ts
// src/config.ts:223
export function saveFileConfig(config: OpenCandleFileConfig, path = getConfigPath()): void {
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}
```

- `src/infra/opencandle-paths.ts` — path helpers and directory creation:

```ts
// src/infra/opencandle-paths.ts:7
function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}
```

`getConfigPath()` returns `~/.opencandle/config.json` (or under
`$OPENCANDLE_HOME` when set). `ensureParentDir(path)` calls `ensureDir` on the
dirname. Other state lives in the same home dir (`state.db`, `onboarding.json`,
browser profile) — directory mode `0700` covers those defensively even though
this plan only changes file mode for `config.json`.

Repo conventions: TypeScript ESM, relative imports use `.js` extensions,
strictly typed. Tests use Vitest in `tests/unit/`, with `OPENCANDLE_HOME`
pointed at a temp dir (see the `beforeEach` in
`tests/unit/tools/alerts.test.ts:34-45` for the pattern).

## Commands you will need

| Purpose   | Command                                        | Expected on success |
|-----------|------------------------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit`                              | exit 0              |
| All tests | `npx vitest run`                                | all pass            |
| One file  | `npx vitest run tests/unit/config.test.ts`      | all pass (create if absent; see Test plan) |

## Scope

**In scope** (the only files you should modify):
- `src/config.ts`
- `src/infra/opencandle-paths.ts`
- `tests/unit/infra/opencandle-paths.test.ts` (create if it does not exist)
- A config-save test file under `tests/unit/` (locate any existing test that exercises `saveFileConfig` first: `grep -rln "saveFileConfig" tests/`)

**Out of scope** (do NOT touch):
- The Camoufox/Twitter browser profile handling (`src/providers/twitter.ts`) — separate storage with its own lifecycle.
- Windows-specific ACL handling — `mode` is a no-op on Windows; do not add platform branches.
- Any key-rotation or encryption feature.

## Git workflow

- Branch: `advisor/001-secure-home-permissions` off the current branch (`feat/persist-user-market-state`) unless the operator says otherwise.
- Commit style (from `git log`): short imperative subject, e.g. `Harden config file permissions`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create directories with mode 0700 and repair the existing home dir

In `src/infra/opencandle-paths.ts`, change `ensureDir`:

```ts
function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
}
```

Then make `ensureOpenCandleHomeDir()` (lines 18–22) repair pre-existing
installs — `mode` on mkdir only applies at creation, so an already-existing
`~/.opencandle` keeps its old default perms without this:

```ts
export function ensureOpenCandleHomeDir(): string {
  const home = getOpenCandleHomeDir();
  ensureDir(home);
  if (process.platform !== "win32") chmodSync(home, 0o700);
  return home;
}
```

Import `chmodSync` from `node:fs`. Repair only the home dir itself, not a
recursive chmod of its contents (the browser profile manages its own tree;
`config.json` is repaired in Step 2).

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 2: Write config with mode 0600 and repair existing perms

In `src/config.ts`, change `saveFileConfig`:

```ts
export function saveFileConfig(config: OpenCandleFileConfig, path = getConfigPath()): void {
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
  chmodSync(path, 0o600);
}
```

Note: `writeFileSync`'s `mode` only applies when the file is created, so the
explicit `chmodSync` repairs pre-existing `0644` files on the next save. Import
`chmodSync` from `node:fs` alongside the existing imports.

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 3: Tests

Write the tests described in the Test plan.

**Verify**: `npx vitest run` → all pass, including the new tests.

## Test plan

- In a test file colocated with existing config tests (find via
  `grep -rln "saveFileConfig" tests/`; if none exists, create
  `tests/unit/config.test.ts`):
  - **new-file mode**: set `process.env.OPENCANDLE_HOME` to a `mkdtempSync` dir,
    call `saveFileConfig({})`, assert `(statSync(path).mode & 0o777) === 0o600`.
  - **repair mode**: pre-create the config file with `0o644`, call
    `saveFileConfig({})`, assert mode is now `0o600`.
  - **dir mode**: assert `(statSync(dirname(path)).mode & 0o777) === 0o700` for a
    freshly created home dir.
  - **dir repair**: pre-create the home dir with `0o755`, call
    `ensureOpenCandleHomeDir()`, assert mode is now `0o700`.
- Model setup/teardown after `tests/unit/tools/alerts.test.ts:34-58`
  (temp `OPENCANDLE_HOME`, restore env, `rmSync` in `afterEach`).
- Skip these assertions on Windows (`process.platform === "win32"`) with
  `it.skipIf` — POSIX modes don't apply there.

## Done criteria

- [x] `npx tsc --noEmit` exits 0
- [x] `npx vitest run` exits 0; new permission tests exist and pass
- [x] `grep -n "mode: 0o700" src/infra/opencandle-paths.ts` matches
- [x] `grep -n "chmodSync" src/infra/opencandle-paths.ts` matches (existing-dir repair)
- [x] `grep -n "0o600" src/config.ts` matches
- [x] No files outside the in-scope list are modified (`git status`)
- [x] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `saveFileConfig` or `ensureDir` no longer match the excerpts above.
- You find other call sites writing under `~/.opencandle/` with secrets
  (search `grep -rn "writeFileSync" src/`) that are NOT covered by this plan —
  report them; do not expand scope unilaterally.
- `ensureOpenCandleHomeDir` is not actually on the startup path of all entry
  points (CLI, GUI server, monitor) — verify with
  `grep -rn "ensureOpenCandleHomeDir\|ensureParentDir" src/ gui/server/`; if
  some entry point creates the home dir another way, report it.

## Maintenance notes

- Any future code that persists credentials or session tokens under
  `~/.opencandle/` must follow the same `0600`/`0700` pattern; reviewers should
  check new `writeFileSync` calls for a `mode`.
- Existing installs are repaired at the home-dir level on any startup that
  calls `ensureOpenCandleHomeDir`, and at the file level on next config save.
  A recursive chmod sweep of all home-dir contents (sessions, state.db,
  browser profile) is deliberately deferred — startup mutation of user files
  beyond the top-level dir deserves its own decision.
- A committed local `.env` is gitignored and was never tracked; no rotation
  required for that. This plan does not touch `.env` handling.
