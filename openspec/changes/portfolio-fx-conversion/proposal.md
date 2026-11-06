## Why

Issue #282 exposes the absence of FX valuation: EUR holdings cannot contribute to USD totals. The separately owned base-currency selection work fixes reporting-currency choice, but mixed-currency portfolios still need explicitly sourced conversion.

## What Changes

- Convert current market values between USD, EUR, and GBP using validated Yahoo FX observations; reuse existing provider infrastructure. Same-currency valuation remains available for other recognized major-unit currencies without FX support.
- Share deterministic valuation across TUI, local GUI, and hosted GUI, preserving quote units, cost currency, reporting currency, source timestamps, and conversion provenance.
- Show partial valuation and exclusions explicitly. Keep historical reporting-currency cost basis and P&L unavailable when acquisition FX is unknown; retain meaningful native-currency price P&L.
- **BREAKING** internal snapshot contract: add partial status and separate native/reporting money fields; nullable aggregate cost/P&L require coordinated consumer updates.
- Preserve lots and persisted portfolio data; normalize quote subunits before conversion, never by uppercasing ambiguous currency codes.

## Capabilities

### New Capabilities

- `portfolio-fx-valuation`: bounded FX resolution, freshness, provenance, valuation completeness, and accounting limitations.

### Modified Capabilities

- `market-state-user-experience`: portfolio rows and summaries distinguish native values, converted values, partial coverage, and unavailable accounting metrics.

## Impact

The implementation affects `src/providers/yahoo-finance.ts`, shared quote types, a runtime-neutral valuation module, `src/tools/portfolio/portfolio-view.ts`, tracker dependencies, `gui/shared/market-quote-snapshot.ts`, local/hosted adapters, and frontend portfolio/symbol consumers. No new provider, SQLite migration, prompt change, or lot rewrite is proposed. Builds on the merged base-currency foundation (#287).

## Non-goals and readiness

No historical acquisition FX, realized gains, tax accounting, brokerage spreads, executable rates, FX-adjusted daily returns, or arbitrary currency coverage. Implementation and the full USD/EUR/GBP scope are authorized. Deployment is outside this task. Technical feasibility is demonstrated by bounded live probes recorded in `research.md`; permission for automated access and hosted redistribution remains an external release question. If rights cannot be established, return for a separately authorized provider proposal rather than silently substituting a source.
