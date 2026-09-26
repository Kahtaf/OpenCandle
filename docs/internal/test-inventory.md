# Test inventory — Phase 1 (inventory only, unreviewed)

Status: **inventory only**. No case has an individual review. `boundary` is
`unknown` and `reviewedDisposition` is `pending-review` for every case until a
human records a classification. Route `boundaryHint` is a triage aid, not a
review. Machine signals (`mocksHeuristic`, route hints) are reported separately
from the human review ledger, and this inventory's own human ledger is empty.
The human disposition record lives in the four separate case-family ledgers
(core, gui, rest, tools), not in this inventory.

- Generator: `scripts/test-inventory.mjs` (collection/CLI) and
  `scripts/test-inventory-lib.mjs` (pure, tested parsing/identity/gate logic).
- Output: `validation-output/test-inventory.json` (machine-local, gitignored).
- Tests: `tests/agent-tools/test-inventory.test.ts` against the independent
  fixture `tests/agent-tools/fixtures/test-inventory-sample.json`.
- Gate policy: `scripts/test-gate-policy.json` is a **shared, checked-in** policy;
  this inventory reads it and never edits it. Its sha256 digest is recorded in
  the output.

## Run it

```bash
node scripts/test-inventory.mjs                    # collect + write
node scripts/test-inventory.mjs --stdout           # collect + print, write nothing
node scripts/test-inventory.mjs --routes           # route registry + derived gate membership
node scripts/test-inventory.mjs --check <file>     # validate an existing inventory, write nothing
node scripts/test-inventory.mjs --from <dir>       # reparse captured per-route JSON
node scripts/test-inventory.mjs --timeout-ms <n>   # bounded per-spawn timeout (default 600000)
```

Read-only modes (`--routes`, `--check`, `--stdout`) never write. Output is
restricted to `validation-output/*.json`; the CLI refuses escaped paths,
symlinks, non-inventory files (unless `--force`), and serialized secret-like
values. Every Vitest spawn is bounded (`SIGKILL` on expiry) and runs with the
known gating env flags stripped first, so an ambient `EVAL_TIER`,
`OPENCANDLE_*_EVAL*`, `OPENCANDLE_GUI_BROWSER`, or
`OPENCANDLE_GUI_RELEASE_SMOKE` cannot reshape the inventory. Incomplete
collection still writes the partial JSON for diagnosis but exits non-zero and
reports `collection-error:<route>`.

## Route registry and derived gate membership

Counts are deliberately **not** listed here. They are collected at run time
(vitest `--staticParse=false`) and written to the JSON `totals` and per-route
`caseCount`; this doc does not cache them. Gate membership is derived from
`scripts/test-gate-policy.json`, not stored as a second list in the registry.

| Route | Collector | Mode | Nature | Gate step(s) | Derived gates |
| --- | --- | --- | --- | --- | --- |
| `unit` | vitest | runtime | deterministic | `test` | core, full, release |
| `site` | vitest | runtime | deterministic | `test:site` | full, release |
| `agent-tools` | vitest | runtime | deterministic | `test:agent-tools` | core, full, release |
| `evals` | vitest | runtime | live | — | none (eval front door) |
| `gui-browser` | vitest | runtime | live | — | none (opt-in live) |
| `gui-integration` | vitest | runtime | deterministic | `test:gui:integration` | full, release |
| `gui-journey` | vitest | runtime | deterministic | `test:gui:journey` | full, release |
| `gui-release` | vitest | runtime | mixed | `test:gui:release-smoke` | full, release |
| `relay` | vitest | runtime | deterministic | `relay:test` | core, full, release |
| `e2e` | tsx | static (file-level) | live | — | none |
| `hosted` | node | static (file-level) | mixed | `test:gui:hosted` | full, release |
| `eval-manifests` | manifest | static (file-level) | live | — | none |

Notes:

- `gui-integration` (tests/e2e/gui-integration.test.ts +
  gui-integration-lifecycle.test.ts) collects its real cases under
  `OPENCANDLE_GUI_INTEGRATION=1`; a stale flag name previously collected it as
  0 (a false zero), which the collector worker corrected. `gui-journey`
  (tests/e2e/gui-session-journey.test.ts) collects its deterministic cases and
  passes in normal and shuffled order. Per-route case counts live in the
  generated JSON (`caseCount`), not in this doc, since both files keep gaining
  cases. Both are required by `gates:full` and
  `release:check` per the policy.
- `gui-browser` is now the **live** set only; the mocked set moved out. It is
  opt-in and in no gate.
- `hosted` is split: the deterministic hosted PWA/WebContainer e2e
  (`test:gui:hosted`, in full/release) versus the provider-relay browser
  live-smoke (`relay:smoke:browser`), which is live and is **not** claimed by
  `gates:full`.
- `e2e` excludes the three new vitest files and the `live-canary-results.ts`
  helper from its standalone glob. `tests/e2e/provider-release-smoke.ts` remains
  inventoried and is the `test:providers:release` live canary, outside every
  gate.

Validation fails with `unknown-gate-step:<step>` if a registry `gateStep`
drifts out of the policy, and with `unknown-route-nature:<id>` for an
unrecognized nature.

## Eval gate routing and skip flags

Eval cases register conditionally; the inventory unions the env variants and
records each case's minimal activation env in `skipFlags` (`EVAL_TIER`,
`OPENCANDLE_EVAL_KNOWN_FAIL_E2`,
`OPENCANDLE_LIVE_MULTI_TURN_EVAL`/`OPENCANDLE_RUN_KNOWN_FAIL_EVALS`).
`knownFail: true` marks the opt-in tracked-failure cases. No eval case is in
`npm test` or any gate. `vitest list` does not report skipped tests, so a
skipped placeholder is not counted.

## Review honesty

- `reviewStatus.machine` records heuristic-only signals
  (`mocks-source-heuristic`, `route-default-boundary-hint`) and always reports
  `reviewedCases: 0`.
- `reviewStatus.human` records `reviewedCases: 0` and an empty `ledgers` list;
  no human review exists yet.
- `boundary` is `unknown` for every case, with `needsHumanReview: true`; these are
  generated fields, not human approval.
- `mocksHeuristic` is a source-text search, never a reviewed disposition and
  never a reason to delete or trust a case.
- The four separate case-family ledgers (core, gui, rest, tools) are the human
  disposition record; confirm individual dispositions there, not in this
  inventory.

## Limitations

- The `gui-integration` and `gui-journey` projects are present and collect their
  real cases; `gui-browser`/hosted behavior continues to change on the
  integration branch, so counts cached in an earlier run are stale.
- The full integrated gate was not complete for this update
  (`/tmp/oc-final-gates-full.log` was still running); focused `agent-tools` tests
  and lint were run instead.
- Standalone `tests/e2e`, hosted browser scripts, and non-vitest eval manifests
  are file-level only; per-case identity needs each suite's own runner.
- Collection proves module import is safe to collect; it does not prove
  browser, credential, or network availability.
- The output JSON is machine-local and intentionally not committed.
