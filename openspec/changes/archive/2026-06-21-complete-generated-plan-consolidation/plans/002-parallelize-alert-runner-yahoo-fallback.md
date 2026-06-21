# Plan 002: Fetch alert-runner Yahoo fallback quotes concurrently

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2a508ed..HEAD -- src/market-state/alert-runner.ts tests/unit/market-state/alert-runner.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `2a508ed`, 2026-06-11

## Why this matters

The alert runner checks alert rules on a heartbeat. Quotes are fetched in batch
from TradingView first; any symbols TradingView misses fall back to Yahoo —
fetched **sequentially**, one `await` per symbol inside a `for` loop. With N
fallback symbols an alert check takes N × network latency (10 symbols ≈ 10× a
single fetch). Since the heartbeat runs continuously in the GUI server and the
`opencandle monitor` process, this directly delays alert evaluation.

## Current state

- `src/market-state/alert-runner.ts` — the quote-loading function. The
  sequential loop, lines 358–394 (abridged):

```ts
// src/market-state/alert-runner.ts:358
for (const symbol of yahooSymbols) {
  const budgetReason = providerBudget.unavailableReason("yahoo", now);
  if (budgetReason) {
    // ...records unavailable reasons, continue
    continue;
  }
  try {
    const quote = await providers.getYahooQuote(symbol);
    const normalized = normalizeObservation(quote, now);
    observations.set(quoteObservationKey(symbol, false), normalized);
    if (!observations.has(quoteObservationKey(symbol, true))) {
      observations.set(quoteObservationKey(symbol, true), normalized);
    }
    // ...clears unavailable reasons, providerBudget.recordSuccess("yahoo");
  } catch (error) {
    // ...merges unavailable reasons, providerBudget.recordFailure(...)
  }
}
return { observations, unavailableReasons };
```

Key behaviors that MUST be preserved:
1. `providerBudget.unavailableReason("yahoo", now)` is consulted per symbol —
   when the budget trips mid-loop (after a failure records
   `providerBudget.recordFailure`), later symbols are skipped. Naive
   `Promise.all` changes this: all fetches launch before any failure can trip
   the budget. That is acceptable ONLY for the success path; see Step 1 for the
   required compromise.
2. Both the realtime (`quoteObservationKey(symbol, false)`) and delayed
   (`...true`) keys are populated, and the delayed key is only set when not
   already present from the TradingView pass.
3. Per-symbol error messages are merged into `unavailableReasons` exactly as
   today (prior reason + `"; Yahoo fallback unavailable: <reason>"`).

- Yahoo quote calls go through the shared rate limiter
  (`src/infra/rate-limiter.ts`), so concurrency does not bypass provider
  pacing — the limiter throttles bursts.
- Tests live in `tests/unit/market-state/alert-runner.test.ts` and
  `tests/unit/tools/alerts.test.ts` (the latter mocks TradingView as down so
  the Yahoo fallback path is exercised by default — see its `beforeEach`,
  lines 34–45).

## Commands you will need

| Purpose   | Command                                                       | Expected on success |
|-----------|---------------------------------------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit`                                             | exit 0              |
| Targeted  | `npx vitest run tests/unit/market-state/alert-runner.test.ts`  | all pass            |
| Targeted  | `npx vitest run tests/unit/tools/alerts.test.ts`               | all pass            |
| All tests | `npx vitest run`                                               | all pass            |

## Scope

**In scope**:
- `src/market-state/alert-runner.ts` (the Yahoo fallback loop only)
- `tests/unit/market-state/alert-runner.test.ts` (add a concurrency-behavior test)

**Out of scope**:
- The TradingView batch path earlier in the same function — already batched.
- `src/infra/rate-limiter.ts` — do not change limiter behavior.
- `providerBudget` semantics in `src/market-state/alert-provider-budget.ts` (or
  wherever `defaultAlertProviderBudget` lives) — consume it, don't modify it.

## Git workflow

- Branch: `advisor/002-parallel-yahoo-fallback`.
- Commit style: short imperative subject, e.g. `Fetch Yahoo fallback quotes concurrently`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Replace the sequential loop with a bounded concurrent map

Replace the `for (const symbol of yahooSymbols)` loop with:

1. A single up-front budget check: if
   `providerBudget.unavailableReason("yahoo", now)` is non-null before
   starting, record the reason for every symbol (same strings as today) and
   skip all fetches — this preserves the "budget already tripped" fast path.
2. `await Promise.allSettled(symbols.map(async (symbol) => {...}))` where the
   body does the fetch and returns `{ symbol, quote }` or throws with the
   symbol attached. Apply the observation-map writes and
   `unavailableReasons` merges AFTER allSettled resolves, iterating results in
   the original symbol order so reason-string concatenation stays
   deterministic for tests.
3. Keep `providerBudget.recordSuccess("yahoo")` per fulfilled result and
   `providerBudget.recordFailure("yahoo", reason, now)` per rejected result
   where `isProviderWideFailure(reason)` — same predicates as today.

Behavioral delta to accept (and document in the commit message): a
provider-wide failure no longer short-circuits the *remaining* fetches within
the same check cycle — it trips the budget for the *next* cycle. This is the
intended trade-off; all per-symbol bookkeeping is otherwise identical.

**Verify**: `npx tsc --noEmit` → exit 0; `npx vitest run tests/unit/market-state/alert-runner.test.ts` → all pass.

### Step 2: Add a concurrency test

See Test plan.

**Verify**: `npx vitest run tests/unit/market-state/alert-runner.test.ts tests/unit/tools/alerts.test.ts` → all pass.

## Test plan

- In `tests/unit/market-state/alert-runner.test.ts`, add:
  - **concurrent dispatch**: mock `getYahooQuote` to track in-flight overlap
    (increment a counter on entry, decrement on exit after a `setTimeout(0)`
    tick; assert max concurrent > 1 for 3+ symbols).
  - **mixed results**: 3 symbols where one rejects — assert the two successes
    land in `observations`, the failure lands in `unavailableReasons` with the
    `Yahoo fallback unavailable:` prefix, exactly as the existing
    single-symbol failure tests expect.
  - **pre-tripped budget**: trip the provider budget first; assert zero Yahoo
    calls are made and every symbol gets the budget reason.
- Model mock setup on the existing tests in the same file.
- Verification: `npx vitest run` → all pass.

## Done criteria

- [x] `npx tsc --noEmit` exits 0
- [x] `npx vitest run` exits 0, including 3 new tests
- [x] No sequential `await providers.getYahooQuote` inside a `for` loop remains
      in `src/market-state/alert-runner.ts` (verify by reading the function)
- [x] No files outside the in-scope list modified (`git status`)
- [x] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The loop no longer matches the excerpt (drift).
- Existing alert-runner tests fail because they depend on *ordering of
  provider-budget failure recording within a single cycle* — that means the
  budget contract is stricter than this plan assumes; report rather than
  weakening the tests.
- You find the Yahoo rate limiter serializes to 1 concurrent request anyway
  (check `src/infra/rate-limiter.ts` config for the `yahoo` bucket): the change
  would then be a no-op — report this verdict instead of landing dead code.

## Maintenance notes

- If a second fallback provider is added behind Yahoo, apply the same
  settled-batch pattern; do not reintroduce a sequential chain.
- Reviewer should scrutinize the deterministic ordering of
  `unavailableReasons` string merges (tests depend on exact strings).
