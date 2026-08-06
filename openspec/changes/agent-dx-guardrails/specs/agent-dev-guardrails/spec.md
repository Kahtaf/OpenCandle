# agent-dev-guardrails

## ADDED Requirements

### Requirement: Canonical proof commands
The repo SHALL expose `npm run typecheck` (running `tsc --noEmit`) and `npm run gates` (running typecheck, `npx biome ci .`, `npm test`, and `npm run test:agent-tools` in that order) as the single named proof battery for agent handoffs, and `npm run review:pr` SHALL invoke the same battery via `npm run gates` rather than a duplicated inline command string.

#### Scenario: Gates passes on a clean tree
- **WHEN** `npm run gates` is run on a checkout where typecheck, lint, unit tests, and agent-tool tests are green
- **THEN** it exits 0

#### Scenario: Gates fails on any red leg
- **WHEN** any of typecheck, `biome ci`, `npm test`, or `test:agent-tools` would fail
- **THEN** `npm run gates` exits non-zero

#### Scenario: Single definition of the battery
- **WHEN** `package.json` is inspected
- **THEN** the `review:pr` script's `--parallel-tests` argument is `npm run gates`, and no other script re-spells the same command chain

### Requirement: Agent worktree bootstrap
The repo SHALL provide `scripts/agent-bootstrap.mjs`, exposed as `npm run bootstrap:agent`, which idempotently prepares the current checkout for agent work: copying `.env` from the main checkout when absent, installing dependencies via `npm ci` only when `node_modules` is missing or stale relative to `package-lock.json`, and printing a readiness report. The script MUST never overwrite an existing `.env`, MUST never print secret values, MUST never use `npm install` or workspace-prefixed installs, and MUST exit 0 when ready and 1 when blocked.

#### Scenario: Fresh worktree gets env and deps
- **WHEN** `npm run bootstrap:agent` runs in a worktree lacking `.env` and `node_modules`, and the main checkout has `.env`
- **THEN** `.env` is copied with mode 0600, `npm ci` runs at the root, and the report ends `ready` with exit 0

#### Scenario: Existing env is preserved
- **WHEN** the current checkout already has `.env`
- **THEN** the file is left byte-identical and the report line reads `env: present`

#### Scenario: Missing source env is a warning, not a failure
- **WHEN** neither the current nor the main checkout has `.env`
- **THEN** the report line reads `env: missing-source` and the script still exits 0 if dependencies are ready

#### Scenario: Dry run makes no changes
- **WHEN** `npm run bootstrap:agent -- --dry-run` runs
- **THEN** planned actions are printed and no file or `node_modules` mutation occurs

#### Scenario: Testable via root overrides
- **WHEN** the script is invoked with `--from <dir> --to <dir> --skip-install` against fixture directories
- **THEN** the env-copy behavior operates on those directories without requiring a real git worktree

### Requirement: Checked-in delegation contract and resume template
The repo SHALL provide `.agents/delegation/subagent-contract.md` and `.agents/delegation/resume-template.md`. The contract MUST begin with a per-run variables block (owned tasks, commit policy, branch and PR target, test scope, extra constraints) and MUST include standing clauses covering: bootstrap-first, stop-and-report on contradictions, TDD with the failing run observed, `npm run gates` green before handoff, truthful task bookkeeping with declared deviations, no production-code edits to make evals pass, no live evals without credentials, secret hygiene, scope fencing, CHANGELOG entry, `graphify update .`, checking advisory Codex PR review feedback without treating it as a merge gate, and the final report shape. The resume template MUST instruct continuation from the preserved working tree and re-running `npm run gates`.

#### Scenario: Orchestrator composes a delegation prompt
- **WHEN** an orchestrating agent prepends the contract file to a task description and fills the variables block
- **THEN** no standing clause needs to be authored by hand in the prompt

#### Scenario: PR treats Codex review as advisory
- **WHEN** a delegated run opens or updates a PR that receives an automatic or manually requested Codex review
- **THEN** the contract directs the agent to address or rebut available feedback without waiting for a Codex status check or treating the review as merge-blocking

#### Scenario: Interrupted run resumes with the template
- **WHEN** a delegated run dies (timeout, crash, capacity error) and the orchestrator sends the resume template with the reason filled in
- **THEN** the template directs the agent to continue from the working tree and re-run the full proof

### Requirement: AGENTS.md injection-budget guard
An agent-tools test SHALL fail when `AGENTS.md` exceeds 24,576 bytes (75% of the Codex 32,768-byte default project-doc injection budget) or when it no longer references `npm run gates`, `npm run bootstrap:agent`, or `.agents/delegation/subagent-contract.md`. The same test SHALL pin the existence and required content of the canonical scripts and delegation files.

#### Scenario: AGENTS.md grows past the budget headroom
- **WHEN** an edit pushes `AGENTS.md` above 24,576 bytes
- **THEN** `npm run test:agent-tools` fails with a message naming the Codex injection budget

#### Scenario: Guardrail references removed
- **WHEN** the `gates` script, the bootstrap script, a delegation file, or an AGENTS.md reference to them is removed or renamed
- **THEN** the guard test fails
