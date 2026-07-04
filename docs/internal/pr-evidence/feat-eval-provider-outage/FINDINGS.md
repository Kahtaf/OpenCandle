# E3 Provider-Outage Findings

## FINDING: stale weekend quote freshness is not exposed

The deterministic stale-weekend fixture (`tests/fixtures/yahoo/weekend-stale-quote.json`) includes a weekend-dated Yahoo chart timestamp, but `get_stock_quote` currently reports `Date.now()` in details and does not render provider quote as-of text. The E3 stale timestamp case is therefore a skipped known-fail until a future production freshness ledger or tool-output change exposes provider timestamps.

## FINDING: deterministic tool cases do not emit `opencandle-turn-gap`

The E3 deterministic tests exercise real tool/provider behavior through mocked fetch, but `opencandle-turn-gap` is emitted by the live Pi/OpenCandle turn path rather than by individual tool executions. The turn-gap assertion is kept as a skipped known-fail and should be promoted with a credentialed harness eval once a live E3 scenario is authored.
