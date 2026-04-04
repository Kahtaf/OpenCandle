## ADDED Requirements

### Requirement: Cache supports stale-while-error retrieval

The `Cache` class SHALL add a `getStale()` method that returns expired entries (that `get()` would delete) as a fallback. Stale entries are tagged so consumers know the data is not fresh. A stale limit prevents returning data that's too old to be useful.

#### Scenario: getStale returns expired entry within stale limit

- **GIVEN** AAPL overview was cached at `T` with `TTL.FUNDAMENTALS` (24h)
- **AND** current time is `T + 30h` (TTL expired, within 7-day stale limit)
- **WHEN** `cache.getStale<CompanyOverview>("av:overview:AAPL", STALE_LIMIT.FUNDAMENTALS)` is called
- **THEN** it returns `{ value: <the cached overview>, stale: true, cachedAt: T }`
- **AND** the entry is NOT deleted from the store

#### Scenario: getStale returns undefined beyond stale limit

- **GIVEN** AAPL quote was cached at `T` with `TTL.QUOTE` (1 min)
- **AND** current time is `T + 20min` (beyond 15-min stale limit for quotes)
- **WHEN** `cache.getStale<StockQuote>("yf:quote:AAPL", STALE_LIMIT.QUOTE)` is called
- **THEN** it returns `undefined`
- **AND** the entry is deleted from the store

#### Scenario: getStale returns undefined when no entry ever existed

- **GIVEN** no cache entry for `"av:overview:TSLA"` has ever been written
- **WHEN** `cache.getStale<CompanyOverview>("av:overview:TSLA", STALE_LIMIT.FUNDAMENTALS)` is called
- **THEN** it returns `undefined`

#### Scenario: get() behavior is unchanged

- **GIVEN** AAPL quote was cached 30 seconds ago (within TTL)
- **WHEN** `cache.get("yf:quote:AAPL")` is called
- **THEN** behavior is identical to today — returns the fresh value, no stale flag

### Requirement: Stale limits are domain-specific

Different data domains have different staleness tolerances. The stale limit defines how long past TTL expiry a cached value remains useful as a fallback.

#### Scenario: Domain stale limits

- **WHEN** stale fallback is configured
- **THEN** the following stale limits apply:

| Domain | Normal TTL | Stale Limit | Rationale |
|--------|-----------|-------------|-----------|
| QUOTE | 1 min | 15 min | Price moves fast; 15-min-old quote still directionally useful |
| HISTORY | 1 hour | 24 hours | Historical data doesn't change retroactively |
| FUNDAMENTALS | 24 hours | 7 days | Financials update quarterly |
| MACRO | 1 hour | 24 hours | FRED data updates daily at most |
| SENTIMENT | 5 min | 1 hour | Sentiment shifts but 1h is directionally useful |
| OPTIONS_CHAIN | 2 min | 30 min | Greeks and IV change but structure is useful for analysis |

### Requirement: Stale fallback is used in provider functions, not tools

Cache reads currently live inside providers (e.g., `alpha-vantage.ts:20`, `yahoo-finance.ts`). Stale fallback SHALL also live in the provider layer so that cache knowledge is not duplicated in tools. When a provider's fresh fetch fails, it falls back to stale cache before throwing.

#### Scenario: Provider falls back to stale cache on HTTP error

- **GIVEN** `getOverview("AAPL", apiKey)` in `alpha-vantage.ts`
- **AND** `cache.get("av:overview:AAPL")` returns `undefined` (TTL expired)
- **AND** the HTTP call to Alpha Vantage throws `HttpError(429)`
- **WHEN** the provider catches the error
- **THEN** it calls `cache.getStale("av:overview:AAPL", STALE_LIMIT.FUNDAMENTALS)`
- **AND** if stale data exists, returns it (the provider succeeds with stale data)
- **AND** if no stale data exists, throws the original error (same as today)

#### Scenario: Provider returns stale data transparently to caller

- **GIVEN** `getOverview` fell back to stale cache
- **WHEN** it returns to the tool (`get_company_overview`)
- **THEN** the returned `CompanyOverview` is the stale value — structurally identical to fresh data
- **AND** the tool formats it normally (no null field crashes)

### Requirement: Stale data is surfaced via provider wrapper metadata

When `wrapProvider()` is used (see provider-circuit-wiring spec), stale data SHALL be distinguishable from fresh data so that tools can add freshness warnings to their text responses.

#### Scenario: wrapProvider signals stale data

- **GIVEN** a provider returned stale cached data (the stale fallback path)
- **WHEN** `wrapProvider("alphavantage", fn)` wraps the call
- **THEN** the result includes metadata indicating staleness: `{ status: "ok", data, timestamp: <original cache time>, stale: true }`
- **AND** the tool can check this flag and prepend a warning like `"⚠ Using cached fundamentals from 2h ago (Alpha Vantage rate limited)"`

### Requirement: ProvenanceSource includes "stale_cache"

The `ProvenanceSource` union type in `src/runtime/evidence.ts` SHALL be extended with `"stale_cache"` so that evidence records can express degraded freshness. Today the type is: `"user" | "preference" | "default" | "fetched" | "computed" | "unavailable"`.

#### Scenario: Evidence from stale data carries stale provenance

- **GIVEN** a tool used stale cached data to build its response
- **WHEN** an `EvidenceRecord` is created (for eval/test purposes)
- **THEN** `provenance.source` is `"stale_cache"`
- **AND** `provenance.timestamp` is the original cache time
- **AND** `provenance.provider` is the canonical provider ID (e.g., `"alphavantage"`)
- **AND** `provenance.confidence` is reduced (e.g., 0.5 for stale vs implicit 1.0 for fresh)

#### Scenario: toEvidenceRecord handles stale ProviderResult

- **GIVEN** `toEvidenceRecord()` in `evidence.ts` currently handles `status: "ok"` and `status: "unavailable"`
- **WHEN** a stale result is converted (an "ok" result with `stale: true`)
- **THEN** `toEvidenceRecord` sets `provenance.source: "stale_cache"` instead of `"fetched"`
- **AND** sets `provenance.provider` to the canonical ID (today it's `undefined` for successful fetches — that's a gap)

## NOT Changed

- `cache.get()` behavior — still returns `undefined` on expiry and deletes the entry
- `cache.set()` behavior — sets value with TTL, same as today
- TTL values — fresh-cache TTLs remain unchanged
- `httpGet` retry logic — HTTP retries are orthogonal to stale fallback
- Tool execution signatures — tools still call providers, providers handle stale internally
- `wrapProvider()` catch path — still returns `ProviderResultUnavailable` when provider throws AND no stale data exists
