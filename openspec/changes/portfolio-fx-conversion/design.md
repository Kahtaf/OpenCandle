## Context

Research dated 2026-11-06 is in `research.md`. The current tracker and GUI independently require quote currency = lot currency = base currency to include a holding. Both can label a subset as `ok` when foreign holdings are excluded. GUI adapters reject stale data; the tracker price resolver drops most provenance. These are different composition paths, not a single valuation implementation.

`MarketStateService` already stores portfolio base currency, lot cost currency, instrument currency, optional `openedAt`, and record `createdAt`. Neither date supplies an acquisition exchange rate. The parallel currency-selection work is a dependency, not part of this proposal.

## Goals / Non-Goals

**Goals:** sourced current market value in the reporting currency, explicit completeness and provenance, one deterministic contract across runtimes, honest accounting limitations.

**Non-Goals:** historical cost conversion, realized/tax returns, executable FX quotes, currency selection UI, database migrations, prompts, or additional providers.

## Decisions

### 1. Separate fetching from pure valuation

Introduce a runtime-neutral module under `src/portfolio/` with no SQLite, Node-only, GUI, or provider imports. It receives immutable lots, reporting currency, security observations, resolved FX observations, and an explicit clock. Return typed native/reporting money fields and completeness. Keep async acquisition outside it and inject resolvers into tracker and shared GUI composition. Both local (`gui/server/market-state-api.ts`) and hosted (`gui/hosted/runtime/hosted-market-data-api.ts`) paths use the same acquisition policy and pure engine. Do not reuse equity-session freshness heuristics for FX.

Replace duplicated arithmetic in `portfolio-view.ts` and `market-quote-snapshot.ts`. Update unavailable-snapshot constructors as well as successful paths. Quote fetches remain server-side; frontend only formats and groups the contract. This avoids divergent totals and browser networking dependencies.

### 2. Currency identity and units

Quote currency describes price units; lot currency describes saved average-cost units; base currency describes presentation. No currency is inferred from another merely because metadata is missing. An instrument-currency fallback is acceptable only with explicit provenance and unambiguous units; otherwise exclude with `missing_quote_currency`.

Preserve Yahoo raw currency before normalization. `GBp` and `GBX` normalize to major-unit GBP with scale 0.01; `GBP` has scale 1. This is a unit conversion, not an FX rate. Current `getQuote()` uppercases `GBp` to `GBP`, destroying this distinction, so provider/type repair is a prerequisite. Stored explicit GBP costs are interpreted as pounds. There are no legacy users requiring a repair flow; no historical lots are rewritten. Current quote units come from fresh provider metadata. Do not guess from `.L` alone. Other subunits (including ZAc/ILA) are unsupported initially and must fail explicitly. Lot cost units are independently normalized only when explicit; never reinterpret saved GBP lots as pence or rewrite lots.

Initial FX allowlist: USD, EUR, GBP. Other recognized major-unit currencies can still value identical-currency holdings; differing currencies outside the allowlist return `unsupported_currency`. Reporting-currency selection may support a broader list without promising FX coverage. No synthesized symbol for arbitrary three-letter input.

### 3. Canonical USD legs and orientation

Use explicit registry entries EUR→USD = `EURUSD=X` and GBP→USD = `GBPUSD=X`. Define r(A,B) as units of B per unit A. Set r(USD,USD)=1; reverse by reciprocal; EUR→GBP = r(EUR,USD)/r(GBP,USD), and reverse symmetrically. Identity needs no network call. Choose this bounded two-leg strategy over scanning direct and inverse tickers: at most two distinct FX observations per snapshot, consistent reciprocals, predictable failure handling. Do not fall back to another ticker after rate limiting.

Validate finite positive rate, recognized returned symbol/explicit alias, expected target currency, valid observation time, and finite conversion arithmetic. Never infer orientation from price magnitude. The `USDEUR=X` probe returning `EUR=X` informs future registry extensions but is not a v1 acquisition route. EUR/GBP is a derived cross, not an independently observed quote; expose both legs and their timestamps.

Use existing `wrapProvider`, cache, HTTP client, and Yahoo limiter. Quote TTL currently 60 seconds, stale cache retention 15 minutes, limiter 5 requests/second. These are application policy, not a Yahoo allowance. Add per-process single-flight per canonical FX symbol, dedup across lots and portfolios, bounded concurrency (two FX legs), and snapshot-local memoization of failures. Cancel/deadline through existing infrastructure. No persistent negative cache or retry cascade. Extended-hours equity enrichment is unnecessary for FX; implementation should avoid it while retaining provider metadata needed by the FX adapter.

### 4. Freshness is observable, not inferred from fetch success

Carry `provider`, requested/returned symbols, raw unit, normalized source/target, rate, `observedAt`, `fetchedAt`, cache status, market state, and conversion method (`identity`, `direct`, `inverse`, `usd_cross`). Keep each leg; derived `observedAt` is the oldest leg. Preserve security timestamps separately; a converted value is an indicative combination of observations, not a simultaneous execution price.

Proposed conservative policy (product decision, not provider promise): during REGULAR or unknown FX state require observation age <=15 minutes; accept future skew only up to 60 seconds. For explicit provider CLOSED, accept last-session observations up to 72 hours with a prominent last-session label. Beyond these bounds or with missing timestamps, mark unavailable. Do not infer closure from the US equity calendar or extend across holidays by guesswork. Cross legs must be within 5 minutes of each other and have compatible open/closed states. Reject cached-stale fallback even when timestamps happen to fit; normal TTL cache is acceptable but never resets `observedAt`. The 72-hour closed-session allowance concerns a newly fetched last-session observation, not retention of expired cache. Security quote eligibility uses one shared security policy across all surfaces; rejected security data is never rescued by fresh FX.

### 5. Market value and cost/P&L have independent completeness

Compute native market value = quantity × normalized quote price, then reporting market value = native market value × r(quote currency, reporting currency). Cost currency does not gate market valuation.

Native price P&L exists only when normalized quote and lot cost currencies match: native value minus quantity × native average cost. It excludes FX performance, dividends, fees, and realized returns; label its currency. Where currencies differ, native P&L is unavailable even if current FX exists. Do not convert cost at today's rate.

Reporting cost is known only for lots whose explicit normalized cost currency is the reporting currency. Reporting unrealized price P&L for such a lot is its converted current value minus that known cost; for foreign-cost lots it is null. Portfolio cost and P&L are null unless every lot has known reporting cost and every value is available. Keep cost subtotals grouped by currency; never subtract a known-cost subset from the whole portfolio value. `createdAt` is an insertion date; even `openedAt` lacks execution FX and cannot fill the gap. Changing reporting currency can legitimately make P&L unavailable without altering any lot.

Disable aggregate reporting-currency day move for portfolios requiring FX. Existing `derivePortfolioDayMove` multiplies security change percentages by value; that omits FX changes and different close times. Keep security-native daily percentages labeled as such; defer historical FX-adjusted daily returns.

### 6. Explicit partial totals and consumers

Return status `empty`, `complete`, `partial`, or `unavailable`; counts and lot IDs for included/excluded rows; reason codes and human explanations. `totalValue` is non-null only for complete/empty snapshots; `valuedSubtotal` carries the included amount for partial snapshots. No available rows means null subtotal, not zero; empty portfolios use zero. Allocation for complete snapshots uses total value. Partial snapshots use explicitly named `valuedAllocationPercent` over valued subtotal with a visible “of valued holdings” label, never “of portfolio”; unavailable/zero denominator yields null. Do not estimate missing percentage coverage from lot counts.

Use separate native price/value, reporting value, native cost/P&L, and reporting cost/P&L fields, each carrying currency. Preserve nulls through renderers; no `?? 0` for unavailable P&L. Update `PortfolioPage.jsx`, `portfolio-view-model.js`, allocation segments, symbol sections, summary formatting, attachments consuming summaries, and tracker text/details. Existing symbol grouping assumes all successful lots have the same cost currency; replace with per-currency cost buckets and null blended cost where currencies differ. Group reporting market values by symbol only after conversion, and retain per-lot failures. Extended-hours prices remain native metadata, not an unlabelled substitute valuation price.

## Risks / Trade-offs

- Undocumented endpoint and Yahoo access/redistribution constraints → deployment requires rights confirmation; no SLA is claimed. Existing provider use does not grant additional rights.
- Limited allowlist and conservative freshness reject some legitimate observations → show explicit exclusions; expand only with evidence and tests.
- Cross timestamps and spread differences → retain provenance and call values indicative; do not compare reciprocal quotes as exact equivalence.
- Lost quote-unit case can produce 100× errors → repair raw unit handling before enabling GBP conversion; audit affected consumers.
- Contract migration can silently coerce nulls to zero → coordinated renderer tests across all surfaces.

## Migration Plan

With implementation accepted, implement test-first as a coordinated contract change on top of base-currency selection. No persisted schema migration. Exercise both browser runtimes and TUI before enabling conversion. Rollback restores explicit no-FX exclusions without rewriting lots; do not retain partially upgraded frontend/server contracts. Historical accounting is a separate proposal.

## Open Questions

1. Can the deployment owner establish Yahoo permission for automated access and, separately, hosted display/redistribution? This blocks release, including claims of production readiness.
2. The 15-minute/72-hour/5-minute age and skew policy and three-currency scope are approved. Runtime fixtures must cover exact boundaries; no market-close or holiday behavior was live-tested here.
3. Resolved: no users and no GBP repair flow. Explicit stored GBP denotes major units. Normalize new explicit GBp/GBX acquisition costs to GBP with scale 0.01; never rewrite historical lots.
4. Confirm frontend vocabulary for partial value and native price P&L with the base-currency implementation owner.
