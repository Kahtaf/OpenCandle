# Plan 005: Clear the four moderate npm audit findings

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `npm audit --omit=dev` — if the vulnerability
> list differs from "Current state" below (issues already fixed, or new ones
> appeared), reconcile: only fix what's listed, report anything new.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `2a508ed`, 2026-06-11

## Why this matters

`npm audit --omit=dev` reports 4 moderate advisories in transitive production
dependencies. None is directly exploitable in OpenCandle today (`hono` arrives
via an MCP SDK and is not used by the GUI server, which uses Node's
`http.createServer`; `ws` memory disclosure needs specific frame conditions),
but they are cheap to clear and will otherwise accumulate and mask future,
real advisories.

## Current state

`npm audit --omit=dev` (2026-06-11):

- `brace-expansion` — large numeric range DoS (GHSA-jxxr-4gwj-5jf2)
- `hono` ≤4.12.20 — 4 advisories (IPv6 deny-rule bypass, Set-Cookie injection,
  JWT scheme laxness, mount-path routing) — transitive via
  `@modelcontextprotocol/sdk`
- `qs` 6.11.1–6.15.1 — stringify DoS (GHSA-q8mj-m7cp-5q26)
- `ws` 8.0.0–8.20.0 — uninitialized memory disclosure (GHSA-58qx-3vcg-4xpx)

All four report "fix available via `npm audit fix`" (semver-compatible bumps —
no breaking upgrades required).

Repo facts: npm workspaces (root + `gui/server` + `gui/web`), lockfile
`package-lock.json` at root. CI (`.github/workflows/ci.yml`) runs `npm ci`,
`npx tsc --noEmit`, a pack-content check, and `npm test` on Node 22.

## Commands you will need

| Purpose   | Command                  | Expected on success                       |
|-----------|--------------------------|-------------------------------------------|
| Fix       | `npm audit fix`          | exit 0, lockfile updated, no `--force` use |
| Re-audit  | `npm audit --omit=dev`   | `found 0 vulnerabilities` (or only NEW ones to report) |
| Typecheck | `npx tsc --noEmit`       | exit 0                                     |
| Tests     | `npx vitest run`         | all pass                                   |
| GUI build | `npm run gui:web:build`  | exit 0                                     |

## Scope

**In scope**:
- `package-lock.json` (root)
- `package.json` files ONLY if `npm audit fix` adds an `overrides` entry or a
  direct-dep bump is unavoidable

**Out of scope**:
- `npm audit fix --force` — never.
- Major-version upgrades of any direct dependency.
- devDependency advisories (audit with `--omit=dev` only).

## Git workflow

- Branch: `advisor/005-audit-fix`.
- Commit style: `Bump transitive deps to clear npm audit findings`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Apply the fix

Run `npm audit fix` (NOT `--force`).

**Verify**: `npm audit --omit=dev` → `found 0 vulnerabilities`. If any of the
four remain, inspect why (`npm ls <pkg>`) — a pinned parent may need an
`overrides` entry in root `package.json`; add the narrowest possible override
(exact package, minimum safe version) and re-run.

### Step 2: Full verification

**Verify** (all must pass):
- `npx tsc --noEmit` → exit 0
- `npx vitest run` → all pass
- `npm run gui:web:build` → exit 0 (ws/qs feed the GUI toolchain; the build is
  the cheapest smoke test)

## Test plan

No new tests — this is a lockfile-only change. The existing suite plus the GUI
build are the regression gate. Verification: the three commands in Step 2.

## Done criteria

- [x] `npm audit --omit=dev` reports 0 vulnerabilities
- [x] `npx tsc --noEmit` exits 0
- [x] `npx vitest run` exits 0
- [x] `npm run gui:web:build` exits 0
- [x] `git status` shows only `package-lock.json` (and at most root `package.json` for overrides) modified
- [x] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `npm audit fix` wants to change a direct dependency's major version.
- Tests or the GUI build fail after the bump and a single re-install
  (`rm -rf node_modules && npm ci` is NOT authorized — report instead;
  deleting node_modules is the operator's call).
- New advisories (not in the list above) appear — report them; do not chase.

## Maintenance notes

- Consider a CI step `npm audit --omit=dev --audit-level=high` as a follow-up
  (deferred: moderate-level gating is too noisy).
- If `@modelcontextprotocol/sdk` keeps pinning old `hono`, an `overrides`
  entry will need to be re-checked whenever that SDK is upgraded.
