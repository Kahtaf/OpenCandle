# Agent DX Guardrails

## Why

Analysis of all agent session history in this repo (19 Claude sessions, 38 interactive Codex sessions, 34 `codex exec` delegation runs; see `docs/internal/agent-dx-audit-2026-07.md`) shows the maintainer re-types the same guardrails into nearly every agent interaction: the proof-command battery appears hand-spelled in ~28 of 34 delegation prompts with inconsistent invocations, a 6-point subagent contract is pasted verbatim into ~10 orchestration prompts, missing `.env`/`node_modules` in fresh worktrees blocked parallel agents in three separate incidents, and ~10 prompts re-copy AGENTS.md conventions by hand. Codifying these removes the highest-frequency friction for agent-driven development and gives newly onboarded engineers the same guardrails without inheriting the maintainer's prompt habits.

## What Changes

- Add canonical proof commands: `npm run typecheck` (`tsc --noEmit`) and `npm run gates` (typecheck + `biome ci .` + unit tests + agent-tool tests) so every agent prompt, doc, and CI reference names one stable command instead of re-spelling the battery.
- Add `scripts/agent-bootstrap.mjs` (`npm run bootstrap:agent`): idempotent worktree/environment preflight that copies `.env` from the main checkout, installs dependencies when missing/stale, and reports readiness (gates command, branch, key tool availability) in one run.
- Check in the subagent delegation contract at `.agents/delegation/subagent-contract.md` plus a resume-after-interruption template at `.agents/delegation/resume-template.md`, with per-run variables (commit policy, test scope, owned tasks, branch target) as explicit template fields.
- Add a guard test (agent-tools suite) asserting AGENTS.md stays within the Codex project-doc injection budget with headroom, and that binding conventions appear in the file. Restructure AGENTS.md minimally: binding rules reference `npm run gates` and the delegation contract instead of prose that prompts re-copy.
- Update AGENTS.md / tests/AGENTS.md / gui/AGENTS.md command references to the new canonical scripts.

## Capabilities

### New Capabilities
- `agent-dev-guardrails`: repo-level guardrails for agent-driven development — canonical proof commands, agent worktree bootstrap, checked-in delegation contract/resume templates, and an AGENTS.md injection-budget guard.

### Modified Capabilities

<!-- none: no runtime/product spec-level behavior changes; all changes are repo development infrastructure -->

## Impact

- `package.json` scripts (additive: `typecheck`, `gates`, `bootstrap:agent`); `npm run review:pr` parallel-tests arg may reference `npm run gates` (same battery, no gate semantics change).
- New files: `scripts/agent-bootstrap.mjs`, `.agents/delegation/subagent-contract.md`, `.agents/delegation/resume-template.md`, `tests/agent-tools/agent-dx-guardrails.test.ts`.
- Edited docs: `AGENTS.md`, `tests/AGENTS.md`, `gui/AGENTS.md` (command references only; no convention changes).
- Not touched: the upstream-synced `.agents/skills/codex-first/` and `.agents/skills/autoreview/` skill contents (repo-local delegation files are referenced from AGENTS.md instead, so upstream sync stays clean); production `src/`/`gui/` code; CI workflow gate semantics.
