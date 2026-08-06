# Design — Agent DX Guardrails

## Context

Session-history analysis (`docs/internal/agent-dx-audit-2026-07.md`) found four high-frequency, hand-maintained guardrails: the proof-command battery re-spelled per delegation prompt (inconsistently: whole-repo vs changed-file biome, full vs scoped tests), a verbatim 6-point subagent contract pasted into orchestration prompts, worktree bootstrap failures (missing `.env` → agents falsely reporting "blocked on credentials"; missing `node_modules` → first `npm test` fails; `npm install` runs that churn `package-lock.json`), and AGENTS.md conventions re-copied into prompts.

Measured facts this design relies on:
- Codex injects AGENTS.md into every session complete and untruncated today: real sessions show the full file (~8KB) ending at its final line. The Codex default `project_doc_max_bytes` budget is 32,768 bytes and the user config does not override it. The risk is future growth past the budget, not present truncation.
- `.agents/skills/codex-first/` and `.agents/skills/autoreview/` are upstream-synced (pinned in `skills-lock.json`); repo-specific content must not be added to them.
- `npm run review:pr` already runs the exact target battery as its `--parallel-tests` argument: `npx tsc --noEmit && npx biome ci . && npx vitest run && npm run test:agent-tools`.
- Worktrees are created under `.claude/worktrees/agent-*` (and ad-hoc `oc-<slug>` dirs); they contain checked-in files but not `.env`, `node_modules`, or `graphify-out/` (all git-ignored).

## Goals / Non-Goals

**Goals:**
- One stable name for the proof battery (`npm run gates`) referenced by AGENTS.md, delegation prompts, and `review:pr`.
- One command that makes any fresh worktree agent-ready (`npm run bootstrap:agent`), safe to run repeatedly, that never mutates `package-lock.json` and never prints secret values.
- The delegation contract and resume template as checked-in files with explicit per-run variable fields, so orchestration prompts shrink to variables + task text.
- A regression guard that keeps AGENTS.md within the Codex injection budget and keeps the new command/contract references present.

**Non-Goals:**
- No changes to CI workflow gate semantics, `release:check` composition, or autoreview exit semantics.
- No edits inside upstream-synced skills (`codex-first`, `autoreview`, etc.).
- No mechanized "verify like a user" gate, merge-ready checker, or scheduled loops (audit items G5–G8, D1–D4) — separate changes.
- No prompt/routing/product code changes; nothing in this change ships in the npm package (verify `package:contents:check` stays green).

## Decisions

### D1. `gates` composition = the existing review battery, verbatim
`"typecheck": "tsc --noEmit"`, `"gates": "npm run typecheck && npx biome ci . && npm test && npm run test:agent-tools"`.
- Reuses `npm test` (which carries the `check:node` pretest) rather than raw `vitest run`, so the Node-version guard rides along.
- `review:pr`'s `--parallel-tests` argument becomes `"npm run gates"` — same commands, one definition. Alternatives considered: adding `test:scripts:typecheck` and GUI smoke into `gates` — rejected; `gates` must match the per-PR delegation proof (what `review:pr` gates today), not `release:check`. Whole-repo `biome ci .` (not changed-files) is the single canonical form; the changed-files variant disappears.

### D2. Bootstrap is a dependency-free Node script: `scripts/agent-bootstrap.mjs`
Matches the repo's existing `scripts/*.mjs` convention (`check-node-version.mjs`, `packed-install-smoke.mjs`). Behavior (in order):
1. Resolve the current checkout root (`git rev-parse --show-toplevel`) and the main checkout root (`git rev-parse --git-common-dir` → its parent). In the main checkout the two are equal and the `.env` step is a no-op check.
2. `.env`: if absent in the current root and present in the main root, copy it (mode `0600`). Never overwrite an existing file, never print file contents — report only `env: present | copied | missing-source`.
3. Dependencies: if `node_modules` is missing, or `package-lock.json` is newer than `node_modules/.package-lock.json`, run `npm ci` at the root. Always `npm ci`, never `npm install` (lockfile churn was an observed failure); never `npm --prefix gui/web install` (known duplicate-React trap — root install covers the workspace).
4. Report readiness lines: `branch:`, `node:` (version + range check result), `env:`, `deps: ok | installed | failed`, advisory `tool: codex|agent-browser|graphify present|missing` (PATH lookup only, no execution), and a final `ready` / `blocked` line naming `npm run gates` as the proof command.
Exit 0 when ready (missing optional tools and `env: missing-source` are warnings), exit 1 only when blocked (`npm ci` failure, node out of range, not a git checkout).
Flags for testability and safety: `--dry-run` (print planned actions, execute nothing), `--from <dir>` / `--to <dir>` (override main/current roots so tests can drive temp fixtures without real worktrees), `--skip-install`.
npm alias: `"bootstrap:agent": "node scripts/agent-bootstrap.mjs"`.
Alternative considered: a git `post-checkout`/worktree hook — rejected: implicit magic in hooks is harder to audit, and delegation prompts want an explicit first command with visible output.

### D3. Delegation files live in `.agents/delegation/`, referenced — not embedded — by skills
`subagent-contract.md`: a "Per-run variables" fill-in block (Owned tasks / Commit policy: `commit-here | leave-uncommitted` / Branch + PR target / Test scope beyond `gates` / Extra constraints) followed by the standing clauses distilled from the observed hand-pasted contract: bootstrap first; stop-and-report contradictions verbatim instead of adapting; TDD with the failing run observed; `npm run gates` green before handoff; truthful bookkeeping (no checking off undone tasks, deviations declared); never modify production code to make evals pass; no live evals without credentials — stop and report; never print secret values; scope fence (owned tasks only, don't rewrite parallel work); CHANGELOG `[Unreleased]` entry per atomic feature/fix; `graphify update .` after code changes; advisory PR review — inspect automatic Codex feedback when present or request it manually with `@codex review`, but never block merge or handoff on a Codex status check; final report shape (files changed + proof outputs + deviations).
`resume-template.md`: the standard continuation prompt (reason placeholder, "working tree preserved — continue from where you stopped", re-run `npm run gates`, same report shape).
Consumption: the orchestrator prepends the file contents to a delegation prompt (`cat .agents/delegation/subagent-contract.md`) and fills the variables. AGENTS.md gains a short DELEGATION section pointing here. The upstream-synced `codex-first` skill is untouched — its generic prompt-contract guidance remains true, and this repo's specifics resolve through AGENTS.md, which Codex auto-injects.
Alternative considered: editing `codex-first/SKILL.md` — rejected: upstream sync (skills-lock.json) would conflict or silently revert repo-specific content.

### D4. Injection-budget guard is a test, not a restructure
`tests/agent-tools/agent-dx-guardrails.test.ts` (agent-tools suite — repo-maintainer coverage per `tests/AGENTS.md`, not public `npm test`):
- `AGENTS.md` byte size ≤ 24,576 (75% of the 32,768 Codex default — headroom so growth is caught before truncation ever starts).
- `AGENTS.md` contains `npm run gates`, `npm run bootstrap:agent`, and `.agents/delegation/subagent-contract.md`.
- `package.json` scripts `typecheck`, `gates`, `bootstrap:agent` exist with the exact strings from D1/D2, and `review:pr` references `npm run gates`.
- Contract and resume files exist and contain each required clause (assert on stable phrases) and every per-run variable field.
- Bootstrap behavior: (a) `--dry-run` in the repo root exits 0 with well-formed report lines; (b) driving `--from`/`--to` against temp fixture dirs: copies a fake `.env` (and asserts mode `0600`), refuses to overwrite an existing one, reports `missing-source` when absent — all with `--skip-install`.
AGENTS.md content edits are minimal: add the three commands to COMMANDS, add the DELEGATION section, adjust the BOUNDARIES "Always" list to name `npm run gates`. Current size 8KB leaves ~16KB headroom. Alternative considered: aggressive AGENTS.md restructure to front-load conventions — rejected: measurement showed no truncation exists; a guard test is the durable part.

## Risks / Trade-offs

- [`gates` runtime is minutes (full vitest + agent-tools)] → acceptable: it replaces the same battery already demanded per-prompt; scoped `npx vitest run <files>` remains available mid-loop, `gates` is the handoff bar.
- [`npm ci` inside bootstrap can be slow on cold worktrees] → it only triggers when `node_modules` is missing/stale; `--skip-install` covers read-only agents.
- [Bootstrap copies live credentials into worktrees] → same posture as the manual practice it replaces; file lands `0600`, values never printed, worktrees stay on the same machine. `.env` remains git-ignored in worktrees (same repo ignore rules apply).
- [Contract file drifts from actual orchestration practice] → the guard test pins the clauses; the contract is short and edited in-repo where review applies, unlike prompt history.
- [`review:pr` indirection through `npm run gates` changes autoreview's parallel-test invocation] → command content is byte-for-byte the same battery; verify by running `npm run review:pr -- --help`-level smoke plus one real branch review during verification.

## Open Questions

None — decisions above are final for implementation. (Follow-up changes will cover audit items G5–G8 and the scheduled loops.)
