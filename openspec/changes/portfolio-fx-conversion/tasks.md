## 1. Prerequisites

- [x] 1.1 Accept USD/EUR/GBP scope and freshness/coverage policy; resolve stored GBP as pounds with no repair flow, migration, flags, or lot rewrites.
- [x] 1.2 Integrate the merged base-currency foundation and inventory snapshot/summary consumers.
- [ ] 1.3 Before deployment, establish permitted Yahoo automated access and hosted display/redistribution scope; separately authorize another source if required.

## 2. Provider and contract tests first

- [x] 2.1 Add explicitly synthetic Yahoo-shaped FX fixtures, retain sanitized live observations separately, and observe regression reds for GBp/GBP/GBX units and persisted costs.
- [x] 2.2 Observe failing orientation, metadata, numeric/freshness, unsupported-pair and overflow tests; implement identity/direct/inverse/two-leg cross resolution with existing provider infrastructure.
- [x] 2.3 Test age/skew/session boundaries, stale rejection, cache provenance, single-flight, subscriber cancellation, 429/unavailable and internal timeout isolation.

## 3. Shared valuation

- [x] 3.1 Implement explicit native/reporting money with test-first currency, subunit, repeated-lot and immutable reporting-currency-change contracts.
- [x] 3.2 Implement empty/complete/partial/unavailable totals, honest partial allocations, independent native P&L and null unknown reporting cost/P&L.
- [x] 3.3 Replace tracker and GUI arithmetic with the shared engine; verify local/hosted/tracker parity and unavailable snapshots.

## 4. Consumers and user proof

- [x] 4.1 Update portfolio, symbol, home and card consumers, mixed-cost grouping, allocation, refresh behavior and TUI text; preserve unknown values and currency context. Existing attachment cost summaries require no change.
- [x] 4.2 Disable reporting daily moves requiring historical FX; preserve native security changes.
- [x] 4.3 Exercise live local desktop/mobile GUI and actual TUI: USD/EUR/GBP reporting, current sourced rates, provenance, unsupported CHF partial coverage and unchanged stored lots. Capture final desktop/mobile screenshots and verify 320/360/390px geometry.
- [ ] 4.4 Verify hosted provider-backed portfolio flows through a configured relay before deployment. Local hosted runtime boots, but plain Vite preview returns 404 for /v1/runtime-token; adapter parity and hosted automated checks pass.
- [x] 4.5 Add the user-visible CHANGELOG entry and meaningful regression coverage. Explicitly reconcile measured coverage for shared-code replacement; retain the audit and parent disposition.
- [x] 4.6 Pass full gates, mandatory Node/relay/browser coverage, and the authorized local review:pr equivalent with gpt-6.1-sol and React Doctor. Final commands use VITEST_MAX_WORKERS=1 to reduce host contention; no test timeout, assertion, threshold or exclusion changes.

Completion evidence and earlier failed/interrupted attempts are recorded chronologically in validation.md. Deployment is outside the implementation task; 1.3 and 4.4 remain explicit release prerequisites. Market-close/holiday behavior is covered by deterministic boundary tests, not claimed as live proof. Sparkline provider failures and the preexisting model omission of portfolio_name are separate follow-ups.
