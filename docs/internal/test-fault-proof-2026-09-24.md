# Targeted fault proof — critical contract mutations (2026-09-24)

Bounded mutation/fault proof that the existing critical owner tests actually fail when
the production contract they guard is broken. One credible mutation per contract, applied
in isolation to production source in this worktree, then fully restored. No production or
GUI source change remains.

- Scope: 8 named contracts — price freshness, option units, financial formula, GUI
  authorization, duplicate action handling, session targeting, persistence, cancellation.
- Test scope: existing owner tests only. No tests were added or modified.
- Harness: `validation-output/fault-proof/run.mjs` (git-ignored) with
  `manifest.json`, `results.json`, per-mutation JSON/stdout logs under
  `validation-output/fault-proof/logs/`.
- Branch: `test-trust/fault-proof`; commit policy: leave uncommitted.

## Baseline and restore (green)

Baseline command (before any mutation):

```
npx vitest run \
  tests/unit/infra/freshness.test.ts \
  tests/unit/tools/option-chain.test.ts \
  tests/unit/tools/dcf.test.ts \
  tests/unit/gui-server/private-api-access.test.ts \
  tests/unit/pi/session-action-dedupe.test.ts \
  tests/unit/gui-server/session-actions.test.ts \
  tests/unit/memory/storage.test.ts \
  tests/unit/runtime/session-coordinator.test.ts
```

Baseline result: `8 files passed, 145 tests passed`.

Restore is verified by `git checkout -- <file>` after every mutation, then re-running the
same command: `8 files passed, 145 tests passed` (`validation-output/fault-proof/restore-green.txt`).
`git diff -- src gui` is empty and every mutation record has `restoredClean: true`
(the only tracked-tree addition from this run is this documentation file). Each mutation must also match its anchor exactly once;
the runner marks a non-unique anchor `unreachable` instead of mutating the wrong site.

## Manifest and outcomes

| Contract | Source site | Mutation applied (summarized) | Owner test | Outcome |
|---|---|---|---|---|
| price freshness | `src/infra/freshness.ts` `isCryptoStale` | crypto window `> 15 * 60_000` → `> 150 * 60_000` | `tests/unit/infra/freshness.test.ts` › "uses a 15-minute freshness rule for crypto" | **killed** |
| option units | `src/tools/options/option-chain.ts` emitted unit line | "multiply by 100 for one standard contract" → "multiply by 10…" | `tests/unit/tools/option-chain.test.ts` › "labels option premiums as per-share quotes with standard-contract total math" | **killed** |
| financial formula | `src/tools/fundamentals/dcf.ts` `computeDCF` projected PV | mid-year `** (y - 0.5)` → full-year `** y` | `tests/unit/tools/dcf.test.ts` › "present values use mid-year convention discounting" | **killed** |
| GUI authorization | `gui/server/private-api-access.ts` `isTrustedPrivateApiRequest` | removed default loopback-only guard | `tests/unit/gui-server/private-api-access.test.ts` › "requires loopback callers by default even with the server-issued GUI cookie" | **killed** |
| duplicate action handling | `src/pi/session-action-dedupe.ts` `requireMatchingFingerprint` | removed the id/fingerprint mismatch throw | `tests/unit/pi/session-action-dedupe.test.ts` › "rejects reuse of an action id with a different input fingerprint" | **killed** |
| session targeting | `gui/server/session-actions.ts` `resolveActionSessionManager` | unknown target: throw → `return current` fallback | `tests/unit/gui-server/session-actions.test.ts` › "rejects ask_user actions for unknown non-current sessions instead of falling back" | **killed** |
| persistence | `src/memory/storage.ts` `upsertPreference` conflict clause | on conflict keep old `value_json` instead of `excluded.value_json` | `tests/unit/memory/storage.test.ts` › "upserts existing preference" | **killed** |
| cancellation | `src/runtime/session-coordinator.ts` `markWorkflowInterrupted` | suppressed `this.runner.cancel()` (durable terminal event) | `tests/unit/runtime/session-coordinator.test.ts` › "records an interrupted workflow when the session is disposed without a shutdown handoff" | **killed** |

Result: **8 killed, 0 survived, 0 equivalent, 0 unreachable.**

## Exact assertion failures observed

All failures are real assertion failures (no timeouts, no import/parse errors). The
`-t`-filtered owner test is the only test run per mutation, so each reported failure is
the owner test for that contract.

- price freshness: `AssertionError: expected false to be true // Object.is equality`
  (`stale.isStaleForSession` was `false` under the widened window).
- option units: `AssertionError: expected '**AAPL Options Chain** — Expiry: 2027…' to contain 'multiply by 100 for one standard cont…'`.
- financial formula: `AssertionError: expected 999999999.9999999 to be close to 1048808848.1701515, received difference is 48808848.17015159, but expected 0.5`.
- GUI authorization: `AssertionError: expected true to be false // Object.is equality`
  (a remote cookie-bearing caller was accepted without `allowRemote`).
- duplicate action handling: `AssertionError: expected [Function] to throw an error`
  (fingerprint mismatch no longer rejected).
- session targeting: `Error: expected [Function] to throw error including 'Unknown saved session' but got 'OpenCandle is reconnecting to this se…'`
  (the fallback path was exercised instead of rejecting the unknown target).
- persistence: `AssertionError: expected 'balanced' to be 'conservative' // Object.is equality`
  (stale value survived the second upsert).
- cancellation: `AssertionError: expected [ 'workflow_started', …(3) ] to include 'workflow_cancelled'`
  (the durable terminal event was never written).

Full messages per mutation are in `validation-output/fault-proof/results.json` and the
JSON reporter output in `validation-output/fault-proof/logs/`.

## Classification definitions

- **killed** — mutated production code causes an assertion failure in the owner test.
- **survived** — owner test still passes; the contract is unprotected (none here).
- **equivalent** — mutation does not change observable behavior (none here).
- **unreachable** — mutation anchor not uniquely applicable or owner test not exercised (none here).

## Survivors and missing protection

None. All 8 contracts are killed by existing tests, so no tests-only fixture or
caller-boundary assertion was added.

## Boundary honesty

- All eight owner tests are **unit-level**. None is end-to-end; a passing mutation kill
  here proves the unit contract, not live GUI/agent behavior.
- GUI authorization is guarded by a pure-function unit test on
  `isTrustedPrivateApiRequest` plus separate source-inspection guards in
  `tests/unit/gui-server/server-route-guards.test.ts`. The mutation here targets the
  functional auth predicate, not the route wiring.
- session targeting opens a real `SessionManager` over temp directories (unit-integration
  in-process), and cancellation runs an in-memory SQLite `workflow_events` log; neither
  exercises a live server or network.
- The option-units mutation is killed by an output-text contract assertion
  ("multiply by 100 for one standard contract"), not by a computed premium total. The tool
  emits the unit instruction rather than a contract total, so this is the strongest
  existing owner assertion for that contract; a numeric total-premium kill is not
  available without adding a new implementation-shaped test, which was out of scope.
- No live network, model, or credential-dependent path was used.

## Deviations

- No `CHANGELOG` `[Unreleased]` entry was added. This run changes no user-visible product
  behavior (docs/validation only); `AGENTS.md` scopes CHANGELOG entries to user-visible
  features and fixes. Declared here rather than adding a non-user-visible entry.
- `npm run gates` is run once at final handoff (see `/tmp/oc-fault-proof-final.md`).
- No PR was opened; branch is `test-trust/fault-proof` and the work is left uncommitted.
