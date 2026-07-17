## ADDED Requirements

### Requirement: LSE provider module authenticates, maps errors, and follows provider conventions

The system SHALL provide an LSE provider module at `src/providers/lse.ts` (re-exported from `src/providers/index.ts`) exposing `getLseCandles` and `getLseFinancialReports` over `GET /candles` and `GET /ref/financial_reports` at base `https://api.londonstrategicedge.com/vault`. All requests go through an internal `lseGet<T>(path, params)` that injects the configured API key as the `x-api-key` header, parses LSE's JSON `{"detail": "..."}` error bodies into thrown errors carrying status and detail, and mirrors the shared http-client's retry norms (up to 2 retries on retryable failures, honoring `Retry-After` capped at 5 seconds). The module SHALL throw `ProviderCredentialError("lse", "missing")` when no key is configured, and `ProviderCredentialError("lse", "stale", status)` on HTTP 401 or 403, before any stale-cache fallback (the `throwIfAuthError` pattern from `src/providers/alpha-vantage.ts:19-23`). Calls SHALL use the shared `cache`/`rateLimiter` idiom: `cache.get` → `rateLimiter.acquire("lse")` → fetch → `cache.set` with the new `TTL.CANDLES`/`TTL.FINANCIAL_REPORTS` domains; on fetch error, `cache.getStale` with the matching `STALE_LIMIT` domain before rethrowing. The module SHALL NOT use `src/infra/http-client.ts` (it cannot expose the `X-Data-Bytes` response header) and SHALL NOT modify it.

#### Scenario: Successful candles fetch is cached

- **WHEN** `getLseCandles("AAPL", "1d", ...)` is called twice within `TTL.CANDLES` and the first fetch returns candle rows
- **THEN** the second call returns the cached rows without a second HTTP request, and the first request carried the `x-api-key` header and acquired the `"lse"` rate bucket

#### Scenario: 401 becomes a credential error, not stale cache

- **WHEN** LSE responds 401 with `{"detail": "Invalid API key"}` and a stale cached value exists
- **THEN** the call throws `ProviderCredentialError("lse", "stale", 401)` and does not return the stale value

#### Scenario: Missing key fails fast

- **WHEN** no LSE API key is resolvable from `LSE_API_KEY` or file config
- **THEN** the provider throws `ProviderCredentialError("lse", "missing")` without making an HTTP request

#### Scenario: Transient failure serves stale cache

- **WHEN** LSE responds with a 5xx after retries and a cached value exists within `STALE_LIMIT.CANDLES`
- **THEN** the stale value is returned

#### Scenario: Unknown symbol maps the detail body

- **WHEN** LSE responds 404 with `{"detail": "Unknown symbol"}`
- **THEN** the thrown error exposes status 404 and the detail message so tools can report an invalid-symbol reason

### Requirement: LSE rate bucket is configured for the free tier

The system SHALL configure a dedicated token bucket `rateLimiter.configure("lse", 100, 1.66)` — 100-token burst, 1.66 tokens/second refill (≈100 calls/min, under the free tier's 100 calls/min) — alongside the existing bucket configs at the bottom of `src/infra/rate-limiter.ts` (lines 57-77), and every LSE HTTP call SHALL acquire from it.

#### Scenario: LSE calls are paced by their own bucket

- **WHEN** LSE and Alpha Vantage calls run in the same process
- **THEN** LSE calls consume only the `"lse"` bucket and are not throttled by the 5 req/min `"alphavantage"` bucket

### Requirement: Monthly byte budget accounts usage and gates fallback participation

The system SHALL maintain a persisted monthly byte counter for LSE (module `src/infra/lse-byte-budget.ts`) storing `{ month: "YYYY-MM", bytesUsed: number }` as the JSON file `lse-byte-budget.json` under the OpenCandle home directory (resolved via `src/infra/opencandle-paths.ts`). Every LSE response's `X-Data-Bytes` header value SHALL be added to the counter. When the month changes, the counter SHALL reset lazily on first read/write. The monthly cap is `53_687_091_200` bytes (50 GiB) and the soft threshold is exactly 80% of it, `42_949_672_960` bytes; `isOverSoftThreshold()` SHALL return true when `bytesUsed >= 42_949_672_960`. While over the soft threshold, LSE entries SHALL be omitted from tool fallback chains (gating at chain assembly, not inside `lseGet`), so tools silently revert to Yahoo/Alpha Vantage behavior. A 429 whose `detail` indicates monthly-allowance exhaustion SHALL mark the month exhausted (counter jumps to `53_687_091_200`) and SHALL NOT be retried; other 429s follow normal retry/backoff. A missing or corrupt budget file SHALL reset to zero (fail-open). Direct provider calls (outside tool chains) SHALL remain callable over threshold. When an LSE key is configured and `isOverSoftThreshold()` is true, the doctor/GUI Diagnostics Providers section SHALL include exactly one warn-status advisory line whose message is `London Strategic Edge monthly data allowance is <percent>% used; answers use Yahoo/Alpha Vantage until the month resets.` (`<percent>` = `bytesUsed / 53_687_091_200 * 100` rounded to a whole number), following the existing one-line doctor check + `Fix:` remediation rendering; when the key is missing or usage is under threshold, no such line SHALL appear.

#### Scenario: Bytes accumulate from response headers

- **WHEN** two LSE responses carry `X-Data-Bytes: 1024` and `X-Data-Bytes: 2048`
- **THEN** the persisted counter for the current month increases by 3072

#### Scenario: Threshold crossing removes LSE from chains

- **WHEN** the counter is at or above 80% of 50 GiB and `get_stock_history` assembles its fallback chain
- **THEN** the chain contains no LSE entry and the tool behaves exactly as it does today with Yahoo/Alpha Vantage

#### Scenario: Allowance 429 is terminal for the month

- **WHEN** LSE responds 429 with a `detail` indicating the monthly allowance is exhausted
- **THEN** the call is not retried, the budget is marked exhausted, and subsequent chain assemblies skip LSE until the month rolls over

#### Scenario: New month resets the budget

- **WHEN** the stored month is `"2026-07"` and the current month is `"2026-08"`
- **THEN** the counter reads as zero and LSE re-enters fallback chains

#### Scenario: Corrupt budget file fails open

- **WHEN** the budget file contains invalid JSON
- **THEN** the counter resets to zero for the current month instead of throwing

#### Scenario: Doctor surfaces a soft-threshold advisory

- **WHEN** an LSE key is configured and `bytesUsed` is at or above `42_949_672_960`
- **THEN** `opencandle doctor` and GUI Diagnostics show one warn-status line reading `London Strategic Edge monthly data allowance is <percent>% used; answers use Yahoo/Alpha Vantage until the month resets.`, and no such line appears when usage is under the threshold or no key is configured

### Requirement: get_financials chains LSE primary then Alpha Vantage

The `get_financials` tool (`src/tools/fundamentals/financials.ts`, today AV-only at lines 23-28) SHALL fetch financial statements through a fallback chain of LSE `/ref/financial_reports` first, then Alpha Vantage `getFinancials`, using the existing `withFallback` machinery (`src/providers/with-fallback.ts`) so provider/freshness labeling flows through `wrapProvider`. LSE report rows (`report_type` `income|balance|cashflow`) SHALL be mapped into the existing typed `FinancialStatement[]` shape (`FinancialStatement`, `src/types/fundamentals.ts:32-47`) consumed by the tool today; the mapper SHALL be written against a fixture saved from a real API response (fixture-first — the row schema is not documented), and missing line items SHALL map to the same absent/undefined convention the Alpha Vantage mapping uses, never fabricated values. When both providers fail, the tool SHALL degrade with the existing warning behavior, naming both providers' failure reasons.

#### Scenario: LSE serves financials without touching Alpha Vantage

- **WHEN** `get_financials` runs for AAPL with an LSE key configured and LSE returns income, balance, and cashflow reports
- **THEN** the result is mapped into `FinancialStatement[]`, labeled with London Strategic Edge as the source, and no Alpha Vantage request is made

#### Scenario: LSE failure falls back to Alpha Vantage

- **WHEN** LSE is unavailable (error, no key, or byte budget over threshold)
- **THEN** the chain proceeds to Alpha Vantage and the result is labeled accordingly

#### Scenario: Both sources failing degrades with reasons

- **WHEN** LSE and Alpha Vantage both fail
- **THEN** the tool returns its existing unavailable warning naming each provider's failure reason

### Requirement: compute_dcf chains LSE then Alpha Vantage then Yahoo with stale refusal preserved

The `compute_dcf` tool (`src/tools/fundamentals/dcf.ts`) SHALL source financial statements through the chain LSE → Alpha Vantage → Yahoo (extending today's AV → Yahoo fallback at dcf.ts:272). The tool's existing refusal to compute from stale data SHALL apply to LSE-sourced statements exactly as it does to Alpha Vantage and Yahoo ones.

#### Scenario: LSE statements feed the DCF

- **WHEN** `compute_dcf` runs and LSE returns fresh financial reports
- **THEN** the DCF computes from the LSE-derived `FinancialStatement[]` without calling Alpha Vantage or Yahoo for statements

#### Scenario: Stale LSE data is refused, not silently used

- **WHEN** the only available LSE data is stale cache and the downstream providers also fail fresh
- **THEN** the tool refuses with its existing explicit unavailable message rather than computing from stale statements

### Requirement: get_stock_history gains LSE intraday fallback and deep-range coverage with timeframe mapping

The `get_stock_history` tool (`src/tools/market/stock-history.ts`) SHALL keep Yahoo as primary and add LSE `/candles` as a fallback: for daily+ intervals the chain becomes Yahoo → Alpha Vantage → LSE; for intraday intervals (`1m`, `5m`, `15m`, `1h`) the chain becomes Yahoo → LSE, replacing today's no-fallback behavior (chain logic at stock-history.ts:60-69; "No alternate source for {interval} data" message at :72-74). LSE SHALL also serve requested ranges that exceed Yahoo's observed caps (1m ≈ 7 days, hourly ≈ 730 days; LSE reaches 2003). A pure exported mapping function SHALL translate every OpenCandle interval to its LSE timeframe per the complete table in design D5 (`1m→1m`, `5m→5m`, `15m→15m`, `1h→1h`, `1d→1d`, `1wk→1w`, `1mo→1mo`, anything else → `undefined`); an interval mapping to `undefined` SHALL make the LSE chain entry ineligible rather than erroring. LSE candle rows (`ts`/`open`/`high`/`low`/`close`/`volume`) SHALL be mapped into the tool's existing `OHLCV` shape (`src/types/market.ts:26-33`) with these timestamp semantics: `ts` is a naive `YYYY-MM-DD HH:MM:SS.ffffff` datetime string; `OHLCV.date` SHALL be its first 10 characters (`YYYY-MM-DD`); if the additive optional epoch-seconds `timestamp` field from the parallel `market-chart` change exists on `OHLCV` at implementation time, it SHALL be populated by parsing `ts` as UTC (this UTC assumption SHALL be verified against LSE's `/meta` endpoint or vendor docs before release, per design D5). The changes SHALL be confined to the tool/provider layer: no `gui/` file is modified. LSE-sourced history SHALL flow through the existing `wrapProvider` provenance and freshness-ledger labeling exactly like other providers, with the source rendered as "London Strategic Edge" (e.g. "Source: London Strategic Edge · as of …").

#### Scenario: Intraday Yahoo outage falls back to LSE

- **WHEN** a 5m history request fails at Yahoo and an LSE key is configured under budget
- **THEN** the tool returns LSE candles mapped to `OHLCV`, labeled with London Strategic Edge as the source, instead of "No alternate source for 5m data"

#### Scenario: Weekly interval is renamed for LSE

- **WHEN** the chain reaches LSE for a `1wk` request
- **THEN** the LSE request uses `timeframe=1w`

#### Scenario: Deep range beyond Yahoo caps uses LSE

- **WHEN** the user requests hourly history for a range older than Yahoo's ~730-day hourly cap
- **THEN** the LSE `/candles` path can serve the full requested range

#### Scenario: No key means today's behavior exactly

- **WHEN** no LSE key is configured and an intraday Yahoo fetch fails
- **THEN** the tool reports "No alternate source for {interval} data" exactly as it does today

### Requirement: LSE is registered as an api-key provider with automatic doctor visibility

The system SHALL register `"lse"` in the provider registry (`src/onboarding/providers.ts`): added to the `ApiKeyProviderId` union (line 13), given a `PROVIDERS` descriptor with kind `"api-key"`, `displayName: "London Strategic Edge"`, `envVar: "LSE_API_KEY"`, `configPath: ["providers", "lse", "apiKey"]`, `signupUrl: "https://londonstrategicedge.com/databank"`, `freeTier: true`, tier `"soft"`, `category: "market"`, `aliases: ["lse", "london strategic edge", "londonstrategicedge"]`, `unlocks`, `snoozeDurationDays`, `instructionsHint`, and a `fallbackDescription` naming the Yahoo/Alpha Vantage fallbacks; and mapped as `lse: "lseApiKey"` in `CONFIG_FIELD_BY_ID` (providers.ts:359-365). Config resolution SHALL follow `process.env.LSE_API_KEY ?? fileConfig.providers?.lse?.apiKey` with `lseApiKey?` on `Config` (src/config.ts:21-46) and `providers.lse.apiKey` on `OpenCandleFileConfig` (config.ts:48-65), resolved in `resolveConfig` (config.ts:190-198). The registry's exhaustiveness checks (providers.ts:270-275) SHALL compile, and `opencandle doctor` / GUI Diagnostics SHALL report LSE readiness with no doctor-specific code (via `probeAllProviderStatuses`, `src/onboarding/provider-status.ts:150-159`). Every surface that renders a human-readable provider name (doctor rows, onboarding/`/connect` copy, source labels) SHALL show "London Strategic Edge" via the descriptor's `displayName`, never "LSE" alone. An unconfigured LSE key SHALL NOT degrade doctor/Diagnostics overall health: it reports as skipped/not-configured like other never-configured optional providers, per the 0.12.0 plain-language conventions.

#### Scenario: Env key resolves

- **WHEN** `LSE_API_KEY` is set in the environment
- **THEN** `getConfig().lseApiKey` returns it, overriding any file-config value

#### Scenario: Doctor lists LSE

- **WHEN** `opencandle doctor` runs with no LSE key configured
- **THEN** the report includes "London Strategic Edge" as a not-configured optional (soft-tier) provider with its signup URL, treated as skipped rather than degraded, and the overall doctor status is not downgraded by the missing key

### Requirement: LSE behavior is verified with fixtures and covered by the drift canary

Unit tests for the LSE provider and its tool integrations SHALL mock `globalThis.fetch` with fixture JSON under `tests/fixtures/lse/` — at minimum `candles-AAPL-1d.json`, `financial-reports-AAPL-income.json`, and `error-429-allowance.json` — and SHALL make no live API calls. The live provider e2e suite (used by the nightly drift canary) SHALL gain an LSE check so vendor drift in response shapes is detected nightly; the check follows the suite's existing environment-limitation skip semantics when no key is available.

#### Scenario: Unit tests run offline

- **WHEN** the LSE unit tests run
- **THEN** every LSE response is served from `tests/fixtures/lse/` via a mocked `globalThis.fetch` and no network request occurs

#### Scenario: Nightly canary exercises LSE live

- **WHEN** the nightly drift canary runs with an LSE key available
- **THEN** the live provider suite calls a real LSE endpoint and fails (not skips) on response-shape drift

### Requirement: A human ToS review gates the merge

Because LSE's Terms of Service could not be machine-read (JS-rendered pages), the implementation SHALL NOT merge until a human has read the rendered ToS/fair-use terms — specifically caching, redistribution, and commercial-use clauses — and recorded the verdict in the PR description. If the ToS disallows caching or local persistence of LSE data, the change SHALL stop and report rather than implement around the restriction.

#### Scenario: ToS forbids caching

- **WHEN** the human review finds that LSE's ToS disallows local caching or persistence
- **THEN** implementation stops, the finding is recorded in the PR, and no LSE code merges

#### Scenario: ToS verdict recorded

- **WHEN** the human review finds caching and internal use permitted
- **THEN** the PR description records the verdict (with date and source) before any merge
