# Test contract inventory — Phase 1 (inventory only, unreviewed)

Status: **inventory only**. No case has an individual review. `boundary` is
`unknown` and `reviewedDisposition` is `pending-review` for every case until a
human records a classification. Route `boundaryHint` values are triage aids,
not review results.

- Collected: 2026-09-24 at commit `70475315` (`test-trust/inventory`), Node v22.23.0.
- Generator: `scripts/test-inventory.mjs` (process/collection half) and
  `scripts/test-inventory-lib.mjs` (pure, tested parsing/route/identity logic).
- Output: `validation-output/test-inventory.json` (machine-local, gitignored).
- Tests: `tests/agent-tools/test-inventory.test.ts` against the independent
  fixture `tests/agent-tools/fixtures/test-inventory-sample.json`.

## Run it

```bash
node scripts/test-inventory.mjs                                   # collect + write
node scripts/test-inventory.mjs --stdout                          # collect + print, write nothing
node scripts/test-inventory.mjs --routes                          # list route registry, write nothing
node scripts/test-inventory.mjs --check validation-output/test-inventory.json
node scripts/test-inventory.mjs --from <dir>                      # reparse captured per-route JSON
node scripts/test-inventory.mjs --timeout-ms 600000               # per-spawn bound (default 10 min)
```

Read-only modes (`--routes`, `--check`, `--stdout`) never write. The default
write path is restricted to `validation-output/*.json`; the CLI refuses paths
outside it, refuses symlinks/non-inventory files (unless `--force`), and scans
the serialized document for secret-like values before writing.

Every Vitest collection spawn is bounded by `--timeout-ms` (default 600000,
SIGKILL on expiry). The ambient `EVAL_TIER`, `OPENCANDLE_LIVE_MULTI_TURN_EVAL`,
`OPENCANDLE_RUN_KNOWN_FAIL_EVALS`, `OPENCANDLE_EVAL_KNOWN_FAIL_E2`,
`OPENCANDLE_GUI_BROWSER`, and `OPENCANDLE_GUI_RELEASE_SMOKE` flags are stripped
from the inherited environment before each spawn, so only the route/variant env
decides what registers. If any route fails to collect or times out, the partial
JSON is still written for diagnosis but the command exits non-zero (and
`--check` reports `collection-error:<route>`); an incomplete collection is never
reported as a successful inventory.

No `package.json`, `vitest.*`, or CI edits were made in this task. Suggested
parent follow-up (not done here): add
`"test:inventory": "node scripts/test-inventory.mjs"` to `package.json`.

## Actual collection

The table below is a **dated snapshot**, not a contract. Regenerate it with the
command above; do not edit counts by hand and do not assert these numbers in
tests. The route registry is the source of truth: adding a project (for example
the incoming `gui-integration` browser project) means adding one entry to
`VITEST_ROUTES`/`STATIC_ROUTES`, and the generator, validation, and `--routes`
output all pick it up automatically. A registered route validates with zero
cases until its first collection.

Counts are `vitest list --staticParse=false` collection of executable cases
(not pass/fail, not coverage). Runtime collection is required for accuracy:
vitest's static parser undercounts this repo (unit 3550 vs 3741 collected;
relay 47 vs 76) because it cannot expand dynamically registered or
`.each`-generated cases. For `evals`, `gui-browser`, and `gui-release` it also
reports "No test suite found" because their `it()` calls are registered
dynamically or behind env gates.

Runtime collection imports test modules but never executes a test body:
collection here did not call a model, provider, browser, or live API. Runtime
collection still runs each file's module-level code, which is the same import
phase `vitest run` performs; `vitest run` passed on this tree.

| Route | Mode | Files | Cases | Runs in `npm run gates`? |
| --- | --- | ---: | ---: | --- |
| `unit` | runtime | 350 | 3741 | yes (`npm test`) |
| `site` | runtime | 1 | 30 | no (`gates:full` / `test:site`) |
| `agent-tools` | runtime | 3 | 45 | yes (`test:agent-tools`) |
| `evals` | runtime | 8 | 26 | no (eval front door) |
| `gui-browser` | runtime | 1 | 28 | no (`test:gui:browser`, env-gated) |
| `gui-release` | runtime | 1 | 8 | no (`gates:full`, env-gated) |
| `relay` | runtime | 2 | 76 | yes (`relay:test`) |
| `e2e` | static (file-level) | 8 | — | no (`test:e2e*`, live) |
| `hosted` | static (file-level) | 3 | — | no (`test:gui:hosted`, env-gated/live) |
| `eval-manifests` | static (file-level) | 3 | — | no (`eval -- product/competitive/router-live`) |

Totals for the dated snapshot: **3954 cases across 366 files**, **14 static
entries**, **10 routes** (see `totals` in the JSON; do not treat as a contract).
The `agent-tools` count includes this task's 17 inventory tests. `vitest list`
omits skipped tests, so skip gating is recorded from the env matrix below
rather than from collection output.

Static inventory is deliberately file-level for the three non-vitest surfaces:
their case identities require that suite's own runner, so the JSON marks them
`caseIdentity: "file-level"` and does not invent per-case names.

## Eval gate routing and skip flags

Eval cases register conditionally. The inventory unions four env configurations
and records the minimal activation env per case in `skipFlags`:

| Tier | Cases | Activation |
| --- | ---: | --- |
| always | 18 | default `npm run eval -- cases` |
| usually | 5 | `EVAL_TIER=usually` |
| known-fail E2 | 2 | `EVAL_TIER=usually` + `OPENCANDLE_EVAL_KNOWN_FAIL_E2=1` (`--known-fail e2`) |
| known-fail E1 | 1 | `EVAL_TIER=usually` + `OPENCANDLE_LIVE_MULTI_TURN_EVAL=1` + `OPENCANDLE_RUN_KNOWN_FAIL_EVALS=1` (`--known-fail e1`) |

`knownFail: true` marks the three opt-in tracked-failure cases. No eval case is
part of `npm test` or `npm run gates`.

## Boundary, mocks, and disposition

- **Boundary:** every collected case is `boundary: "unknown"`,
  `boundarySource: "unreviewed"`, `needsHumanReview: true`. A reviewed override
  map is implemented and unit-tested; the map is empty, so nothing is declared
  reviewed. Route `boundaryHint` (unit / browser / live-service) is stored only
  as triage metadata.
- **Mocks heuristic (`mocksHeuristic`):** text signals for `vi.mock`, `vi.fn`,
  `globalThis.fetch =`, `nock`, `msw`, etc. Signals are common in `unit`,
  `relay`, and `agent-tools`; read current counts from the JSON rather than
  from this doc. This is a search heuristic over test source, not a reviewed
  judgement and not a reason to delete, move, or trust a case.
- **Reviewed disposition (`reviewedDisposition`):** `pending-review` for every
  collected case. `reviewStatus.reviewedCases` is 0.

## Explicit pending review by area

Review focus per area (counts live in the JSON, not here):

- `unit`: separate pure math/parser units from SQLite/process/HTTP integration
  and from fixture-mocked provider behavior.
- `site`: confirm the public-site build contract runs a real build versus
  inspecting artifacts.
- `agent-tools`: confirm maintainer-helper scope; includes the new inventory
  tests.
- `evals`: confirm tier and known-fail routing; confirm no mocked substitute is
  ever presented as live evidence.
- `gui-browser`: confirm which cases stub model/provider traffic while keeping
  internal HTTP/SSE/WebSocket/storage real.
- `gui-release`: confirm credential blanking, cold-home, and local probe stub
  behavior.
- `gui-integration` (arriving during integration): register one `VITEST_ROUTES`
  entry; collect it runtime-first, then classify its browser/process boundary.
- `relay`: separate static privacy/source audits from worker request
  integration; runtime collection materially expands this route versus the
  static parse.
- `e2e` (file-level): case identities and live-API boundaries still need a
  per-suite pass.
- `hosted` (file-level): hosted browser/WebContainer and relay browser
  live-smoke boundaries still need review.
- `eval-manifests` (file-level): product, competitive, and router-live manifest
  boundaries still need review.

## Limitations

- Collection counts, not outcomes: the inventory does not record pass/fail,
  duration, or coverage, and no coverage provider was invoked.
- The counts in this doc are a dated snapshot. Regenerate with the command
  above; the JSON `totals` and route `caseCount` are authoritative for a run.
- `vitest list` does not report skipped tests, so a skipped placeholder is not
  counted as an executable case.
- Standalone `tests/e2e`, hosted browser scripts, and non-vitest eval manifests
  are file-level only.
- Runtime collection proves module import is safe to collect; it does not prove
  each suite's runtime dependencies (browser binary, credentials, network) are
  available.
- The generated JSON is machine-local and intentionally not committed; only
  this doc and the scripts/tests are tracked.
