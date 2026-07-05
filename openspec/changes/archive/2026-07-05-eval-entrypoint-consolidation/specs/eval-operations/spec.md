## ADDED Requirements

### Requirement: Single eval front door

The repository SHALL provide one eval front door (`npm run eval -- <suite>`) that can run every eval, benchmark, and replay suite in the repository, including the suites that previously had no npm script (product replay, competitive replay, superiority scorecard, prompt-policy manifest, prompt-policy parity). The front door SHALL delegate to the existing suite runners without reimplementing suite logic, SHALL map its CLI options onto the suites' existing env flags without renaming any flag, and SHALL print the resolved command and env flags before spawning. Invoked with no arguments, it SHALL list every suite with a one-line description.

#### Scenario: Existing suite runs identically through the front door

- **WHEN** `npm run eval -- product --case <id>` runs
- **THEN** it executes `tests/scripts/run-product-evals.ts` with `PRODUCT_EVAL_CASE=<id>` and produces the same report as invoking the script directly

#### Scenario: Script-only suite gains a front door

- **WHEN** `npm run eval -- replay:product --base-ref main` runs
- **THEN** `tests/scripts/run-main-branch-product-replay.ts` executes with `PRODUCT_REPLAY_BASE_REF=main`

#### Scenario: Legacy npm scripts remain behavior-identical aliases

- **WHEN** `npm run test:evals:usually` runs
- **THEN** it routes through the front door with `EVAL_TIER=usually` and exercises the same vitest config and cases as before the consolidation

### Requirement: Release eval cadence is one command

`npm run eval -- release` SHALL run the per-release cadence — live router eval, default-tier eval cases, product evals, and the frozen competitive panel — sequentially, continue past individual suite failures, print an aggregate pass/fail table, and exit non-zero if any suite failed. It SHALL NOT be added to `release:check` or CI (it requires credentials).

#### Scenario: Aggregate failure propagates

- **WHEN** the frozen competitive panel fails a deterministic hard assertion during `eval -- release`
- **THEN** the remaining suites still run
- **AND** the summary marks the frozen panel failed and the process exits non-zero

### Requirement: Eval runs are indexed

Every front-door run SHALL append one JSON line to `tests/evals/runs/index.jsonl` recording the suite id, start and finish timestamps, exit code, argv, and the report file paths produced (discovered by directory diff, so existing report writers are unchanged). The index file is git-ignored alongside the run reports.

#### Scenario: Run is discoverable after the fact

- **WHEN** any suite completes through the front door
- **THEN** the last line of `tests/evals/runs/index.jsonl` names that suite and its report path(s)
