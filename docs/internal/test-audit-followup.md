# Test audit follow-up — route authorization proof + orchestrator duplicate

Date: 2026-09-24
Branch: `test-trust/route-proof-cleanup`
Scope owner: bounded subagent run (parent reviewer owns dispositions and centralized gates)

This document records one bounded cleanup pass derived from the prior fresh
audit. It replaces source-text route-authorization assertions with real
request/response proof and removes one confirmed duplicate orchestrator case.
No production code changed.

## Scope

Owned files only:

- `tests/unit/gui-server/server-route-guards.test.ts` (removed 13 source-string rows)
- `tests/unit/gui-server/route-auth-boundary.test.ts` (new; HTTP integration)
- `tests/unit/tools/orchestrator.test.ts` (removed 1 duplicate case)
- `docs/internal/test-audit-followup.md` (this file)

Not touched: production `gui/server/*`, `src/*`, any lockfile, or any
non-owned test. No commits, no PR, no nested agents.

## What changed and why

### 1. Trusted-GUI route authorization (13 rows)

The first `it.each` in `server-route-guards.test.ts` asserted, for 13 routes,
that a route's source slice contained the literal text
`allowTrustedGuiRequest(req, res, "<label>", options)`. That proves the guard
text exists; a route with correct text but broken runtime authorization still
passed. A prior audit (`/tmp/oc-fresh-unit-audit.md`, read-only reference;
counts there are that audit's static estimates, not re-verified here) flagged
this family as a replace-first candidate.

Replacement: `tests/unit/gui-server/route-auth-boundary.test.ts`. It boots a
real ephemeral `node:http` server around the real `createHttpRequestHandler`
and the real `private-api-access` guard. Only external/heavy collaborators
(doctor report, session listing, model-setup state builder, ticker-line
sparkline, market-state history/overview) are stubbed, each as a sentinel spy.
For every one of the 13 routes the case asserts:

1. missing cookie → HTTP 403 and the first business-handler sentinel is not called;
2. wrong cookie value → HTTP 403 and the sentinel is not called;
3. trusted cookie but untrusted `Origin` (`http://untrusted.example`) → HTTP 403
   and the sentinel is not called;
4. trusted same-origin cookie → HTTP not-404 (and 200) and the sentinel is
   called exactly once, proving the route is wired to the handler.

No live network calls are made (loopback only); no mock-output equality is
asserted. The file is labeled `GUI route authorization HTTP integration` and
carries a header comment stating it is HTTP integration despite living under
`tests/unit/`, per the test-trust boundary policy.

The 13 routes covered by the matrix:

`GET /api/bootstrap`, `POST /api/session/new`, `GET /api/sessions`,
`GET /api/session/events`, `POST /api/model-setup/refresh`,
`POST /api/model-setup/api-key`, `POST /api/model-setup/model`,
`POST /api/provider-setup/api-key`, `GET /api/doctor`,
`GET /api/market-state/indices`, `GET /api/market-state/sparkline`,
`GET /api/instruments/history`, `GET /api/instruments/overview`.

#### Reused exact route-level proof

The following existing, non-owned tests already give real request/response
proof for four of the 13 routes; the new file does not duplicate their
detailed body/argument assertions and only adds the missing denial vectors and
the non-404 wiring control they lacked:

| Route | Existing real proof (retained) |
| --- | --- |
| `GET /api/market-state/indices` | `market-indices-route.test.ts` → "rejects untrusted requests before reading the snapshot store"; "ignores query parameters and returns the fixed snapshot" |
| `GET /api/market-state/sparkline` | `market-indices-route.test.ts` → "rejects untrusted sparkline requests before contacting Ticker Line"; "serves a trusted, same-origin Ticker Line SVG with restrictive headers"; "serves Ticker Line as-of metadata" |
| `GET /api/instruments/history` | `instrument-history-route.test.ts` → "rejects untrusted requests before building a snapshot"; "returns a trusted history snapshot" |
| `GET /api/instruments/overview` | `instrument-overview-route.test.ts` → "rejects untrusted requests before building an overview"; "returns the memoized overview snapshot as JSON" |

#### Retained, not deleted

Everything else in `server-route-guards.test.ts` stayed: the legacy `/api/chat/run`
410 check, session-addressed bootstrap/runs guard checks, local-coordinator
secret checks, session/action-id field checks, ordering and absence guards, and
the behavioral `buildChatRunActionEnvelope` case. No blanket deletion of
security source checks occurred; only the 13-row source-substring `it.each`
was removed, after equivalent request-level denial + wiring proof existed.

### 2. Orchestrator duplicate case

Removed exactly one case: the single-case second
`describe("comprehensive analysis follow-up prompts")` whose case
`queues 10 follow-ups (5 analysts + 3 debate + synthesis + validation)`
(lines 240–249 of the original file). It duplicated three retained proofs in
the first family of the same name:

- length 10 — `queues 10 follow-up messages (5 analysts + 3 debate + synthesis + validation)`;
- `calls[8]` contains `RESOLVE THE DEBATE` — `has synthesis prompt that resolves the debate`;
- `calls[9]` contains `[Validation` — `ends with a validation check as the final follow-up`.

The first 7-case family is fully retained and green. No other orchestrator
case was touched.

## Exact runtime counts

Focused command:
`npx vitest run --project unit tests/unit/gui-server/server-route-guards.test.ts tests/unit/gui-server/route-auth-boundary.test.ts tests/unit/gui-server/market-indices-route.test.ts tests/unit/gui-server/instrument-history-route.test.ts tests/unit/gui-server/instrument-overview-route.test.ts tests/unit/gui-server/session-new-route.test.ts tests/unit/tools/orchestrator.test.ts`

| File | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `tests/unit/gui-server/server-route-guards.test.ts` | 53 | 40 | −13 |
| `tests/unit/gui-server/route-auth-boundary.test.ts` | 0 (absent) | 13 | +13 |
| `tests/unit/gui-server/market-indices-route.test.ts` | 5 | 5 | 0 |
| `tests/unit/gui-server/instrument-history-route.test.ts` | 5 | 5 | 0 |
| `tests/unit/gui-server/instrument-overview-route.test.ts` | 3 | 3 | 0 |
| `tests/unit/gui-server/session-new-route.test.ts` | 2 | 2 | 0 |
| `tests/unit/tools/orchestrator.test.ts` | 27 | 26 | −1 |
| **Focused total** | **95** | **94** | **−1** |

Net −1 executed case is the confirmed orchestrator duplicate; the route
family is a 1:1 replacement (13 → 13), now at the HTTP boundary.

## TDD mutation proof

The new test was run against the real, unmodified handler (13 passed). To prove
it actually pins the guard, one production guard was temporarily bypassed,
the failure observed, and production restored byte-for-byte:

- Temporary edit: removed
  `if (!allowTrustedGuiRequest(req, res, "Bootstrap API", options)) return;`
  from the `GET /api/bootstrap` branch of `gui/server/http-routes.ts`.
- Command: `npx vitest run --project unit tests/unit/gui-server/route-auth-boundary.test.ts -t "GET /api/bootstrap"`
- Observed: `1 failed | 12 skipped`; `AssertionError: expected 200 to be 403`
  at `expectDenied` (an unauthorized request reached the business handler).
- Restore: `git checkout -- gui/server/http-routes.ts`; `git status --short`
  and `git diff --stat` show the file clean and line 150 guard intact.

## Full command results

All run from `/private/tmp/oc-route-proof-cleanup`; commands are unit-project
focused only (no coverage, no `gates:full`, no live/eval runs — the parent
centralizes those).

- `npm run bootstrap:agent` → exit 0 (deps installed, env copied, node 22.23.0).
- Baseline focused run → `Test Files 6 passed (6)`, `Tests 95 passed (95)`.
- New file alone → `Test Files 1 passed (1)`, `Tests 13 passed (13)`.
- Mutation-proof run → `Test Files 1 failed (1)`, `Tests 1 failed | 12 skipped (13)`.
- After-edit focused run → `Test Files 7 passed (7)`, `Tests 94 passed (94)`.
- `npm run typecheck` → exit 0.
- `npx biome check <three owned test files>` → `Checked 3 files`, no fixes, exit 0.

## Honest unreviewed remaining population

This pass reviewed and changed only the three named test files plus this doc.
It did **not** audit the broader unit population. Per the prior fresh audit
`/tmp/oc-fresh-unit-audit.md` (read-only reference; figures are that report's
static estimates and were not independently re-verified here), the unit project
holds 364 test files with roughly 3,768 static-estimated cases, of which only
32 files received evidence reads and 332 remained static-triage only. That
unreviewed population is unchanged by this pass. No coverage measurement was
taken, so this pass makes no coverage claim in either direction.

## Deviations and truth record

- Did not run `npm run gates` / `gates:full` / coverage / live evals; the
  bounded assignment delegates full gates to the parent as a centralized step.
- Did not open a PR or commit (leave-uncommitted policy).
- Added no `CHANGELOG` entry: this is test-only cleanup with no user-visible
  behavior change, and the standing clause targets atomic features/fixes.
- Did not modify production code except the temporary mutation-proof edit,
  which was reverted and verified clean.
- Did not run a full read of every unit test file; unreviewed counts above are
  attributed to the prior audit, not asserted as this run's verification.
