# E3 Provider-Outage Eval Notes

Branch: `feat/eval-provider-outage`

## Cases And Assertions

- `zero-filled Yahoo quote mid-comparison`
  - Test: `tests/unit/evals/provider-outage-deterministic.test.ts`
  - Fixtures: `tests/fixtures/yahoo/AAPL-quote.json`, `tests/fixtures/yahoo/MSFT-quote.json`, `tests/fixtures/yahoo/XXFAKEXX-quote.json`
  - Assertions: missing symbol is explicitly unavailable, `details` is null for the missing symbol, no `XXFAKEXX: $0.00` price is emitted, and survivor quote prices remain positive.

- `Yahoo 429 mid-correlation`
  - Test: `tests/unit/evals/provider-outage-deterministic.test.ts`
  - Fixtures: `tests/fixtures/yahoo/AAPL-history-e3.json`, `tests/fixtures/yahoo/MSFT-history-e3.json`
  - Assertions: `analyze_correlation` returns a matrix for surviving symbols, excludes `OUTAGE`, reports `OUTAGE: HTTP 429 Too Many Requests`, includes structured `details.dropped` metadata, and therefore proves the dropped-symbol note while the comparison proceeds on survivors.

- `stale weekend quote timestamp`
  - Test: skipped known-fail in `tests/unit/evals/provider-outage-deterministic.test.ts`
  - Fixture: `tests/fixtures/yahoo/weekend-stale-quote.json`
  - FINDING: current quote tooling does not expose Yahoo's provider quote timestamp in text or details, so deterministic stale-weekend disclosure cannot be asserted without a future production freshness-ledger/tool-output change.

- `opencandle-turn-gap trace entry`
  - Test: skipped known-fail in `tests/unit/evals/provider-outage-deterministic.test.ts`
  - FINDING: deterministic tool-level outage cases do not emit `opencandle-turn-gap`; that entry is produced by the live Pi/OpenCandle turn interceptor and needs a credentialed harness eval before promotion to a gating assertion.

## Evidence

- Named E3 test log: `docs/internal/pr-evidence/feat-eval-provider-outage/e3-provider-outage-vitest.log`
