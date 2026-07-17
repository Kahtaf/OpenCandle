# Design: LSE Data Provider (Phase 1)

## Context

**The LSE API (verified live 2026-07-16 from https://londonstrategicedge.com/api-documentation/):**

- Base URL: `https://api.londonstrategicedge.com/vault`
- Auth: `x-api-key` request header carrying an `lse_live_`-prefixed key.
- Free tier: 100 calls/min; 5,000 rows/page; ~50 GiB/month byte allowance (every response carries an `X-Data-Bytes` header; `GET /usage` reports current usage and is free); 2 exports/hour (exports unused here).
- `GET /candles` — params `symbol`, `timeframe` (`1s|5s|15s|30s|1m|3m|5m|15m|30m|1h|4h|1d|1w|1mo`), `start`/`end` (ISO), `order` (`asc|desc`), `limit`. US stocks back to 2003, split-adjusted. Rows look like:
  `{"ts":"2026-07-02 00:00:00.000000","symbol":"AAPL","open":296.02,"high":309.28,"low":293.7,"close":308.48,"volume":25934709}`
- `GET /ref/financial_reports` — params `symbol`, `report_type` (`income|balance|cashflow`), `period` (`FY|Q1|Q2|Q3|Q4`), `start`/`end`/`order`/`limit`.
- Free discovery endpoints (not wired into tools, useful for debugging): `/catalog`, `/meta`, `/reference`.
- Errors: JSON `{"detail": "..."}` with 401 (missing/invalid key), 403 (inactive/expired key), 429 (rate limit **or** monthly allowance exhausted), 404 (unknown symbol/dataset).
- A Python client exists (`pip install lse-data`) — not used; we call HTTP directly like every other provider in this repo.

**Current repo state (all references verified against the checkout):**

- Providers are single flat kebab-case files with verb-prefixed async exports (src/providers/alpha-vantage.ts, fred.ts, tradingview.ts), re-exported from src/providers/index.ts.
- Credential failures throw `ProviderCredentialError` (src/providers/provider-credential-error.ts); the pattern to copy is `throwIfAuthError` at src/providers/alpha-vantage.ts:19-23.
- The shared HTTP client (src/infra/http-client.ts: `httpGet`/`httpPost`, `HttpError` with `status`/`body`/`retryAfterMs`, built-in 2x retry honoring Retry-After capped at 5s) returns parsed JSON and **does not expose response headers**.
- Cache idiom (see alpha-vantage.ts throughout): `cache.get` → `rateLimiter.acquire("<bucket>")` → fetch → `cache.set(key, val, TTL.X)`; on error, `cache.getStale(key, STALE_LIMIT.X)` then rethrow. `TTL` at src/infra/cache.ts:101-113, `STALE_LIMIT` at cache.ts:116-127.
- All rate buckets are configured at the bottom of src/infra/rate-limiter.ts (~lines 57-77).
- Config: `Config` interface at src/config.ts:21-46, `OpenCandleFileConfig.providers` at config.ts:48-65, env-or-file resolution in `resolveConfig` at config.ts:190-198.
- Provider registry: `ApiKeyProviderId` union at src/onboarding/providers.ts:13; `PROVIDERS` descriptor array; exhaustiveness checks at providers.ts:270-275; `CONFIG_FIELD_BY_ID` at providers.ts:359-365. Doctor/GUI readiness iterates `listAllProviders()` automatically (src/onboarding/provider-status.ts:150-159).
- Fallback machinery: `withFallback([{provider, fn}, ...])` (src/providers/with-fallback.ts) and `wrapProvider` (src/providers/wrap-provider.ts) with a circuit breaker (src/runtime/provider-tracker.ts) that opens after 2 failures.
- Tool pain points this change fixes: `get_financials` is AV-only (src/tools/fundamentals/financials.ts:23-28) while AV is throttled at 5 req/min and `getFinancials` (alpha-vantage.ts:129) makes 3 sequential calls (alpha-vantage.ts:136-150); `compute_dcf` chains AV → Yahoo (src/tools/fundamentals/dcf.ts:272); `get_stock_history` has **no** intraday fallback (chain logic at src/tools/market/stock-history.ts:60-69, "No alternate source" message at :72-74, `DAILY_INTERVALS` = {1d,1wk,1mo} at :11) and Yahoo caps 1m ≈ 7 days / hourly ≈ 730 days.

**Constraint:** AGENTS.md marks new providers ask-first — the proposal is the authorization request. TDD is mandatory; unit tests mock `globalThis.fetch` with fixtures; no live calls in unit tests.

## Goals / Non-Goals

**Goals:**

- An LSE provider module following every existing provider convention (file shape, credential errors, cache, rate limiter, fixtures).
- Byte-allowance safety: a persisted monthly byte budget that removes LSE from fallback chains before the allowance 429 hits, so the free tier never becomes an outage vector.
- Strictly additive tool improvements: `get_financials` gains a primary with AV demoted to fallback; `compute_dcf` gains a third source; `get_stock_history` gains its first intraday fallback and a deep-history path.
- Registry/doctor visibility, drift-canary coverage, and a human ToS gate before merge.

**Non-Goals:**

- Phase 2 (`get_economic_calendar` over `/ref/economic_calendar`, `/series` bond yields), Phase 3 (options flow, insider trades), WebSocket streaming, bulk Parquet exports — each deferred to its own future change.
- No changes to the shared http-client, no prompt changes, no SQLite schema changes, no new GUI surface.

## Decisions

### D1: Dedicated thin fetch inside lse.ts instead of the shared http-client

The shared client returns parsed JSON only; LSE requires reading the `X-Data-Bytes` response header on every call to feed the byte budget. Options: (a) extend http-client to expose headers — rejected, it would ripple through every existing provider and its retry contract for one consumer; (b) dedicated `lseGet<T>(path, params)` using `globalThis.fetch` directly inside lse.ts — chosen. `lseGet` mirrors the shared client's norms (2 retries on 5xx/429-rate-limit, honor `Retry-After` capped at 5s, typed error with status + body) so behavior stays uniform, and is the single place that injects `x-api-key`, parses `{"detail"}` error bodies, throws `ProviderCredentialError("lse", "missing")` when no key is configured and `ProviderCredentialError("lse", "stale", status)` on 401/403 (copying alpha-vantage.ts:19-23), and reports `X-Data-Bytes` to the budget.

### D2: 429 disambiguation — rate limit vs. monthly allowance

LSE uses 429 for both per-minute rate limiting and monthly allowance exhaustion, distinguished only by the `detail` text. A rate-limit 429 is retryable (and largely prevented by our own token bucket); an allowance 429 is unrecoverable until the month resets. `lseGet` inspects `detail`: if it indicates the monthly allowance (fixture `tests/fixtures/lse/error-429-allowance.json` pins the shape), it marks the byte budget exhausted for the current month (jump `bytesUsed` to the cap) and throws without retrying; otherwise it follows normal retry rules.

### D3: Persisted monthly byte budget as a small standalone module

Nothing in the repo tracks bytes or spans sessions — the ProviderTracker circuit breaker and token buckets are in-memory and per-process. New module `src/infra/lse-byte-budget.ts` persisting `{ month: "YYYY-MM", bytesUsed: number }` as JSON under the OpenCandle home (via `src/infra/opencandle-paths.ts`, following the persistence precedent of src/onboarding/state.ts). API: `recordBytes(n)`, `isOverSoftThreshold(): boolean`, `markExhausted()`. Threshold: 80% of 50 GiB (`42_949_672_960` bytes soft cap of `53_687_091_200`). A new month resets the counter lazily on first read/write. Corrupt or missing file → start at zero (fail-open; the hard 429 backstop still exists). Alternatives considered: SQLite table (rejected — schema changes are ask-first and overkill for one counter); polling `GET /usage` (rejected for Phase 1 — the per-response header is authoritative, works offline-deterministically in tests, and a `/usage` reconciliation pass is deferred to a future change if counter drift proves real).

### D4: Budget gating happens at chain assembly, not inside lseGet

Each tool's fallback chain includes its LSE entry only when `!isOverSoftThreshold()`. This keeps `withFallback`/`wrapProvider` semantics untouched (freshness/source labeling still flows through `wrapProvider`), makes the skip silently revert tools to today's Yahoo/AV behavior, and keeps lse.ts callable directly (e.g. by the drift canary) even over threshold. In-band enforcement inside `lseGet` was rejected because a skipped chain entry produces a clean fallback while an in-band throw produces a logged provider failure and needlessly trips the circuit breaker.

### D5: Chain order — LSE primary for financials, last for history

- `get_financials`: **LSE → Alpha Vantage.** One LSE call replaces three sequential AV calls against a 5 req/min bucket; LSE at 100 calls/min is strictly less contended. LSE `/ref/financial_reports` rows are mapped into the existing typed `FinancialStatement[]` shape (`FinancialStatement`, src/types/fundamentals.ts:32-47) so the tool body stays shape-identical.
- `compute_dcf`: **LSE → Alpha Vantage → Yahoo**, preserving dcf.ts's existing stale-data refusal from every source.
- `get_stock_history`: **Yahoo primary is unchanged**; LSE is appended as fallback — for daily+ the chain becomes Yahoo → AV → LSE, and for intraday Yahoo → LSE (today: nothing). LSE additionally serves deep ranges beyond Yahoo's caps (1m ≈ 7 days, hourly ≈ 730 days; LSE reaches 2003). Yahoo stays primary because it is keyless, proven, and real-time; LSE is a new unproven vendor (fallback-first posture, per proposal risks). Integration lives entirely at tool chain assembly in stock-history.ts — Yahoo's `getHistory` provider function is untouched, so the parallel `market-chart` GUI endpoint (which calls `getHistory` directly) does not gain LSE automatically; hoisting the fallback into the provider layer stays the soft, optional follow-up market-chart's design anticipates (market-chart/design.md:93). No `gui/` file changes here.
- Timeframe mapping is a pure exported total function over the tool's `HISTORY_INTERVALS`; the complete table:

  | OpenCandle interval | LSE `timeframe` |
  |---|---|
  | `1m` | `1m` |
  | `5m` | `5m` |
  | `15m` | `15m` |
  | `1h` | `1h` |
  | `1d` | `1d` |
  | `1wk` | `1w` |
  | `1mo` | `1mo` |
  | anything else | `undefined` (LSE chain entry ineligible; never an error) |

  `1wk→1w` is the only rename. LSE's finer timeframes (`1s/5s/15s/30s/3m/30m/4h`) are deliberately unmapped — OpenCandle exposes no such intervals.
- **Candle row → `OHLCV` mapping and timestamp semantics.** An LSE row's `ts` is a *naive* datetime string, `YYYY-MM-DD HH:MM:SS.ffffff` (no timezone designator). Mapping into `OHLCV` (src/types/market.ts:26-33): `date` = the first 10 characters of `ts` (`YYYY-MM-DD`); `open/high/low/close/volume` copy through as numbers. If the additive optional epoch-seconds `timestamp` field from the parallel `market-chart` change (market-chart spec, `OHLCV` D2) exists on the type at implementation time, populate it by parsing `ts` **as UTC** (append `Z` after normalizing the space to `T`) and dividing by 1000. **Assumption to verify at implementation (task 9.3): LSE timestamps are UTC** — confirm against `GET /meta` or the vendor docs during live capture; if they turn out to be exchange-local (US/Eastern), adjust the parse accordingly before shipping the `timestamp` population.

### D6: Registry descriptor — soft tier

`"lse"` joins `ApiKeyProviderId` with kind `"api-key"`, `displayName: "London Strategic Edge"` (the descriptor's required `displayName` field, providers.ts:31 — see "User-facing surface" below for why not "LSE"), `envVar: "LSE_API_KEY"`, `configPath: ["providers", "lse", "apiKey"]`, `signupUrl: "https://londonstrategicedge.com/databank"`, `freeTier: true`, tier `"soft"` (every integration has a fallback), `category: "market"`, `aliases: ["lse", "london strategic edge", "londonstrategicedge"]`, `unlocks` naming financial statements + deep intraday history, a `fallbackDescription` naming the Yahoo/Alpha Vantage fallbacks, `snoozeDurationDays` and `instructionsHint` matching the other soft api-key descriptors. The exhaustiveness checks (providers.ts:270-275 and the `CONFIG_FIELD_BY_ID` record type at :359-365) force the descriptor, the union member, and the `lse: "lseApiKey"` config-field entry to land together — the compiler is the checklist. No doctor code for readiness: `probeAllProviderStatuses` picks the descriptor up automatically.

### D7: Caching — new TTL/STALE_LIMIT domains

New `TTL.CANDLES` / `STALE_LIMIT.CANDLES` and `TTL.FINANCIAL_REPORTS` / `STALE_LIMIT.FINANCIAL_REPORTS` constants rather than reusing `HISTORY`/`FUNDAMENTALS`, so LSE cache lifetimes can be tuned independently of Yahoo/AV without cross-provider blast radius. Values start aligned with the existing domains (`CANDLES` = `HISTORY`'s 1h/24h; `FINANCIAL_REPORTS` = `FUNDAMENTALS`' 24h/7d). Caching also directly conserves the byte allowance.

## User-facing surface

This change is almost entirely backend; the provider is user-visible in exactly three places, all existing surfaces — no new GUI code.

- **Display name.** Everywhere a human-readable name renders (doctor/Diagnostics rows, onboarding//`connect` copy, source/freshness labels), the provider is **"London Strategic Edge"** — never "LSE" alone, which reads as the London Stock Exchange. The registry descriptor's `displayName` field (providers.ts:31) carries this; every status/label path already renders `displayName` (e.g. `formatProviderStatus`, src/onboarding/provider-status.ts:161-170). "LSE" is acceptable in prose only after the full name has appeared, and remains the internal id/env-var stem (`LSE_API_KEY`).
- **Diagnostics / doctor.** LSE is OPTIONAL (soft tier). Copy follows the 0.12.0 plain-language conventions: an unconfigured key reports as skipped/not-configured — never "Degraded", which is reserved for real warnings/failures — and unverified state uses "Not verified yet" style wording, all inherited from the shared provider-status path. One net-new line: when a key IS configured and the byte budget passes its soft threshold, doctor/Diagnostics surface a single warn-status advisory (exact wording in the spec) in the Providers section, following the existing one-line `Fix: …` remediation rendering (src/doctor/render.ts:26).
- **Source/freshness labels in answers.** LSE-sourced data flows through the existing `wrapProvider` provenance and freshness-ledger paths exactly like other providers — "Source: London Strategic Edge · as of …" — with no new labeling mechanism. Nearing the byte cap is user-visible only as source labels quietly reverting to Yahoo/Alpha Vantage (the D4 silent chain skip); the doctor advisory above is the one explicit signal.

## Risks / Trade-offs

- **[Single unproven vendor]** → LSE is never a sole source; every chain retains Yahoo/AV; the `wrapProvider` circuit breaker (2 failures) plus the byte budget bound the blast radius; the nightly drift canary (live provider e2e suite) detects response-shape drift.
- **[Free tier paywalled or killed without notice]** → budget skip + circuit breaker + fallback chains mean tools degrade to exactly today's behavior; no user-facing outage.
- **[ToS may prohibit caching/persistence]** → hard STOP gate in tasks milestone 0: a human reads the rendered ToS before any merge; if caching or local persistence is disallowed, stop and report — do not implement around it.
- **[429 `detail` text is not a stable contract]** → the allowance/rate-limit disambiguation is string-matching on `detail`; pin the observed body in a fixture, and default unknown 429s to the safer rate-limit interpretation (retry/back off) — the byte counter still provides the primary allowance protection.
- **[Byte counter drift vs. server truth]** → the counter is client-side and resets fail-open on corruption; the free `GET /usage` endpoint is available as an opportunistic reconciliation, and the 80% soft threshold leaves a 20% error margin before the hard 429.
- **[Dedicated fetch bypasses shared-client retry hardening]** → `lseGet` deliberately copies the shared client's retry/Retry-After norms and is unit-tested against them; scope is one module.

## Migration Plan

Purely additive; no data migration. Rollout: land provider + budget + registry first (inert without a key), then tool-chain integrations. Rollback = removing LSE chain entries; nothing else depends on the module. Users without `LSE_API_KEY` see zero behavior change (registry probe reports "not configured", chains skip LSE exactly as the budget gate does).

## Open Questions

- ToS verdict (milestone 0) — the only blocking unknown.
- Exact `detail` strings for allowance vs. rate-limit 429s must be captured from live responses when recording fixtures; until then the fixture encodes the documented shape.
- **RESOLVED (2026-07-16 live capture):** LSE `ts` values are UTC. AAPL 1h bars for 2026-07-14 ran from naive 08:00 through 23:00, matching the 04:00–19:00 ET extended session.
- **RESOLVED (2026-07-16 live fixtures):** the exact `/ref/financial_reports` row schema was captured for income, balance, and cashflow; the mapper is fixture-first against those verbatim responses.
