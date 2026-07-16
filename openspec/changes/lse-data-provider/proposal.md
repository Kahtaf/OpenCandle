# LSE Data Provider (Phase 1): Candles + Financial Reports

## Why

OpenCandle's fundamentals and deep-history paths have thin provider coverage: `get_financials` (src/tools/fundamentals/financials.ts) is Alpha Vantage–only with no fallback — and AV's free tier is throttled to 5 req/min while a single `getFinancials` call burns three sequential requests (income/balance/cashflow, src/providers/alpha-vantage.ts:136-150 inside `getFinancials` at :129); intraday `get_stock_history` is Yahoo-only with **no** alternate source (src/tools/market/stock-history.ts:60-69 falls back to AV only for daily+ intervals, and Yahoo caps 1m history at ~7 days and hourly at ~730 days). London Strategic Edge (LSE, https://londonstrategicedge.com) offers a free-tier HTTP API (base `https://api.londonstrategicedge.com/vault`, `x-api-key` auth) with split-adjusted US stock candles back to 2003 at timeframes from 1s to 1mo, plus standardized financial reports — at 100 calls/min, far looser than AV.

**AGENTS.md marks "adding a new provider" as ask-first. This proposal IS the authorization request** (as the answer-receipts proposal was for its scoped `src/pi/` change): approval of this change authorizes the LSE provider, its rate-limit config, its fixture strategy, and the scoped tool-chain edits below — nothing more.

## What Changes

- **New provider module `src/providers/lse.ts`** (single flat file, matching alpha-vantage.ts/fred.ts/tradingview.ts): verb-prefixed exports `getLseCandles` and `getLseFinancialReports` over `GET /candles` and `GET /ref/financial_reports`; internal `lseGet<T>` wrapper injecting `x-api-key`, mapping LSE's JSON `{"detail": "..."}` error bodies, and throwing `ProviderCredentialError("lse", ...)` on 401/403. Uses a thin dedicated fetch (not `src/infra/http-client.ts`, which does not expose response headers) because LSE returns a per-response `X-Data-Bytes` usage header we must read. Re-exported from `src/providers/index.ts`.
- **New persisted monthly byte-allowance budget** (net-new subsystem — nothing in the repo tracks bytes or spans sessions today): a small `{month, bytesUsed}` counter on disk under the OpenCandle home, incremented from each response's `X-Data-Bytes`. When usage crosses a conservative soft threshold (80% of LSE's ~50 GiB/month free allowance), LSE entries in fallback chains are skipped so tools silently revert to Yahoo/Alpha Vantage — an allowance 429 is unrecoverable until the month resets.
- **Infra wiring**: `rateLimiter.configure("lse", 100, 1.66)` (100 calls/min free tier) in src/infra/rate-limiter.ts; new `CANDLES` and `FINANCIAL_REPORTS` TTL/STALE_LIMIT domains in src/infra/cache.ts; `lseApiKey` in `Config` + `providers.lse.apiKey` in `OpenCandleFileConfig` + `LSE_API_KEY` env resolution in src/config.ts; `"lse"` registered as an `ApiKeyProviderId` with a full descriptor and `CONFIG_FIELD_BY_ID` entry in src/onboarding/providers.ts (doctor/GUI readiness is then automatic via `probeAllProviderStatuses`).
- **`get_financials` gains a fallback chain**: LSE `/ref/financial_reports` primary → Alpha Vantage secondary (today it is AV-only at src/tools/fundamentals/financials.ts:23-28 and degrades straight to a warning). LSE rows are mapped into the existing typed `FinancialStatement[]` shape (`FinancialStatement`, src/types/fundamentals.ts:32-47).
- **`compute_dcf` chain extends**: LSE → Alpha Vantage → Yahoo (today AV → Yahoo at src/tools/fundamentals/dcf.ts:272). Stale-data refusal semantics are preserved.
- **`get_stock_history` gains an intraday fallback and deep-range source**: LSE `/candles` is added as fallback for intraday intervals (today "No alternate source for {interval} data") and as the deep-history source beyond Yahoo's range caps, with an OpenCandle→LSE timeframe mapping (`1m/5m/15m/1h/1d/1wk/1mo` → `1m/5m/15m/1h/1d/1w/1mo`).
- **Fixtures + tests**: `tests/fixtures/lse/` JSON per endpoint response plus a 429 allowance error body; unit tests mock `globalThis.fetch` (no live calls); LSE added to the live provider e2e suite so the nightly drift canary monitors vendor drift.
- **ToS STOP gate**: LSE's Terms of Service could not be machine-read (JS-rendered). A human must read the rendered ToS/fair-use terms and record the verdict before any merge; if caching or local persistence is disallowed, the change stops.

## Capabilities

### New Capabilities

- `lse-data-provider`: the LSE provider module (auth, error mapping, credential errors, rate bucket, caching), the persisted monthly byte budget with threshold-skip behavior, the three tool fallback-chain integrations (`get_financials`, `compute_dcf`, `get_stock_history` incl. timeframe mapping), provider registry/doctor visibility, fixture-based testing, and the ToS stop gate.

### Modified Capabilities

- None. The fallback-chain changes are additive provider entries behind the existing `withFallback`/`wrapProvider` machinery; no existing spec's requirements change. (Checked `openspec/specs/`: `graceful-degradation`, `provider-registry`, and `quant-tool-integrity` describe mechanisms this change reuses, not chains it rewrites.)

## Non-Goals

- **Phase 2 (own future change)**: a new `get_economic_calendar` tool over LSE `/ref/economic_calendar`, and `/series` bond yields complementing FRED.
- **Phase 3 (own future change)**: options-flow and insider-trades analyst tools.
- No WebSocket streaming; no bulk Parquet exports (LSE caps exports at 2/hour — out of scope entirely).
- No use of the `lse-data` Python client; we call HTTP directly per repo convention.
- LSE is never a sole source: every integration is fallback-first, so a paywalled or dead free tier degrades to today's behavior, not to an outage.

## Dependencies / Sequencing

This change has **no dependencies on other in-flight changes**. The parallel `market-chart` change (openspec/changes/market-chart/design.md:93) anticipates LSE `/candles` as a soft, non-blocking deep-intraday enhancement via the provider layer; this change places the LSE fallback at `get_stock_history`'s tool-level chain assembly (design D4/D5), so the chart endpoint — which calls Yahoo's `getHistory` directly — does not pick up LSE automatically. That stays a soft, optional follow-up (hoisting the fallback into the provider layer), exactly as market-chart frames it; neither change blocks the other, and **this change touches no `gui/` file**. **Safe to implement first or in parallel with `market-chart`.**

## Impact

- **New files**: `src/providers/lse.ts`, the byte-budget module, `tests/fixtures/lse/*`, unit tests.
- **Edited files**: `src/providers/index.ts`, `src/infra/rate-limiter.ts`, `src/infra/cache.ts`, `src/config.ts`, `src/onboarding/providers.ts`, `src/tools/fundamentals/financials.ts`, `src/tools/fundamentals/dcf.ts`, `src/tools/market/stock-history.ts`, live provider e2e suite, CHANGELOG.md.
- **Risk — single unproven vendor**: LSE has no track record; mitigated by fallback-first posture (Yahoo/AV always remain in every chain), the byte budget + circuit-skip posture (survives a surprise paywall), the existing `wrapProvider` circuit breaker (opens after 2 failures, src/runtime/provider-tracker.ts), and nightly drift-canary coverage.
- **Risk — ToS unknown**: gated by the human-read STOP gate above (tasks milestone 0).
- No schema changes to memory SQLite tables; no prompt changes; no GUI code changes — the only user-facing surfaces are automatic doctor/Diagnostics visibility (via the registry descriptor), onboarding/`/connect` copy, source/freshness labels in answers, and a one-line doctor advisory when the byte budget passes its soft threshold (see design "User-facing surface").
