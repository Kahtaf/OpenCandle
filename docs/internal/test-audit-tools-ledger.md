# Test Trust Audit — tools / providers / infra / analysts / workflows / types / tool-kit / e2e (non-GUI)

- **Date:** 2026-09-24
- **Worker:** audit-tools subagent
- **Status:** Worker evidence pending parent review. This ledger is an audit artifact, **not** a completed human review. The first pass was read-only. After parent review, two approved cleanups were applied under this run: deletion of `tests/unit/types/web-search.test.ts` and replacement of the `compute_dcf` tool-behavior suite with real-provider fixture-HTTP coverage. No production, config, or changelog file was modified.
- **Branch:** `test-trust/audit-tools`
- **Bootstrap:** `npm run bootstrap:agent` run first and exited 0 (`ready: run npm run gates`). Gates were run once after the approved cleanup (see §10).

## 1. Scope and method

Owned surfaces (all files read in full, not sampled):

Counts below are the **true executable collection** from `npx vitest list --project unit --staticParse=false <paths>` (modules imported for collection; test bodies not executed). The initial static-parse pass undercounted and is superseded.

| Surface | Files | Executable cases (`--staticParse=false`) |
| --- | ---: | ---: |
| `tests/unit/tools` (+ `portfolio/`) | 40 | 416 |
| `tests/unit/providers` | 24 | 291 |
| `tests/unit/infra` | 10 | 107 |
| `tests/unit/analysts` | 1 | 11 |
| `tests/unit/workflows` | 4 | 42 |
| `tests/unit/types` | 1 | 4 (pre-cleanup; file deleted, see §3) |
| `tests/unit/tool-kit.test.ts` | 1 | 8 |
| **Unit total (pre-cleanup)** | **81** | **879 collected; 1 is win32-only `skipIf` → 878 executed on darwin** |
| **Unit total (post-cleanup)** | **80** | **875 collected; 874 executed on darwin** |
| `tests/e2e` non-GUI scripts | 8 | not Vitest; scripted checks counted below |

- Method: full read of every scoped test file plus the production functions/callers each purports to exercise; `npx vitest list --project unit --staticParse=false <paths>` for case inventory (collection only, no test run); focused runs of the files changed by the approved cleanup. No live model/provider calls. No credentials read or printed.
- **Count correction (parent-flagged).** The earlier static-parse `vitest list` (default `staticParse`) omitted `tests/unit/infra/config-permissions.test.ts` and undercounted conditional collections: it reported 862 cases / 80 files, versus 879 / 81 with `--staticParse=false` (deltas: tools +2, providers +12, infra +3). The 107 infra cases include the single win32-only `it.skipIf` at `opencandle-paths.test.ts:49`, which is collected but skipped on darwin; runnable-on-darwin is 106. No body execution is needed for these counts.
- **E2E scripts are not part of any Vitest project and are not in `npm run gates`.** `npm run gates` = `check + npm test + relay:test + test:agent-tools`; `gates:full` adds site/gui-smoke/hosted/package-contents. `tests/e2e/tools.test.ts`, `cli.test.ts`, `providers.test.ts`, `harness-dcf.test.ts`, and the four `credential-*.test.ts` run only via explicit `npm run test:e2e*` scripts. This is the single largest trust-boundary caveat in the audited set.
- "Origin" is the first-added commit date from `git log --diff-filter=A`; per-file commit counts are from `git log --oneline`. Dates are given only where relevant to a finding. Where history was not inspected, origin is stated as unknown.

Rating key — **independent assertion quality**:
- **A** — asserts concrete production behavior (exact values, boundaries, error types, sequencing, persistence).
- **B** — mixes behavior assertions with presence/source-text or self-produced expectations.
- **C** — mostly presence/metadata/tautological assertions; detects little beyond "the string exists".

Disposition key: **keep**, **consolidate**, **replace**, **investigate**.

---

## 2. tests/unit/infra (10 files, 107 collected / 106 runnable on darwin)

| File (cases) | Actual boundary | Assertion quality | Overlap | Disposition | Remaining proof / notes |
| --- | --- | --- | --- | --- | --- |
| `cache.test.ts` (17) | Real `Cache`; fake timers | A | TTL-constant case overlaps `lse-byte-budget`/LSE config | keep | Covers miss/hit/expiry/overwrite/invalidate/clear, `getStale` boundaries, `runWithStaleMetadata` concurrent-scope isolation. Strong. TTL constant pin is a contract pin, not a defect. |
| `rate-limiter.test.ts` (8) | Real `RateLimiter`; fake timers | A | — | keep | Includes strong concurrency case "does not let concurrent waiters spend the same refilled token" (83–111) and shared-bucket probes. |
| `http-client.test.ts` (12) | Real `httpGet/httpPost`; `globalThis.fetch` mock | A | — | keep | Retry counts, 4xx no-retry, 429 Retry-After seconds, cap to default/configured max. **Gap:** no case for an HTTP-date `Retry-After` value (only integer seconds). |
| `config.test.ts` (34) | `src/config.ts`; entire `node:fs` mocked | A | Per-provider env/file/undefined triples (brave 296–346, finnhub 348–398, lse 400–440) are near-duplicates; alphaVantage/fred similar | keep | Broad and behavior-accurate. Candidate **consolidate** into a parameterized provider-key table (currently 12 structurally identical cases). `saveFileConfig` mode/mkdir covered with mocks; real-fs coverage lives in `config-permissions.test.ts`. |
| `config-permissions.test.ts` (2) | Real fs; temp `OPENCANDLE_HOME`; `skipIf win32` | A | — | keep | Owner-only 0600 for new and repaired files. **Missing on umask/win32 path by design (skip).** Omitted by default static-parse `vitest list`; included with `--staticParse=false`. |
| `freshness.test.ts` (17) | Real `freshness` + `market-calendar` | A | — | keep | Session/weekend/holiday/crypto 15-min boundaries; inline snapshots for `formatAsOfLine`. Good boundary coverage. |
| `lse-byte-budget.test.ts` (6) | Real fs temp home; fake timers | A | — | keep | Exact 80% threshold case at 42,949,672,959/960 bytes (54–63); month rollover; fail-open; non-finite/negative ignored. |
| `node-version.test.ts` (4) | Real guards | A | — | keep | Version-range boundaries and native-ABI one-rebuild retry. |
| `open-url.test.ts` (4) | `node:child_process` mocked | A | — | keep | darwin/linux/win32 command shapes + failure propagation. |
| `opencandle-paths.test.ts` (3; 2 runnable) | Real fs; env override | A | — | keep | Default `~/.opencandle`, `OPENCANDLE_HOME`, 0700 repair (win32-skipped). |

**Infra conclusion:** no weak or defect-prone tests. Only minor gaps (HTTP-date Retry-After; win32 permission branch untested by skip design) and one consolidation candidate.

---

## 3. tests/unit/analysts, types, tool-kit, workflows (7 files, 65 cases pre-cleanup; 6 files / 61 cases after the approved types deletion)

| File (cases) | Actual boundary | Assertion quality | Overlap | Disposition | Remaining proof / notes |
| --- | --- | --- | --- | --- | --- |
| `analysts/contracts.test.ts` (11) | Real `parseDebateOutput` / `isAnalystSplit` | A | Shared with `tools/orchestrator` persona-prompt tests but different layer | keep | Bull/bear/rebuttal parsing, three "REBUTTAL SKIPPED" variants, malformed fallback, consensus/split voting. Good. |
| `types/web-search.test.ts` (4) | **None** — imported only `type` declarations and asserted object-literal fields | C | Type contract also exercised at runtime by provider/tool tests | **deleted (parent-approved, done 2026-09-24)** | Every assertion was `result.field === <literal just assigned>`; it could only fail if the type was deleted, and `npm run check` does not typecheck `tests/` (`tsconfig.json` excludes `tests`). No replacement type test was added because no real compilation target currently typechecks test files; the runtime envelope contract is retained at the provider/tool layer (below). Origin 2026-04-11, 2 commits. |
| `tool-kit.test.ts` (8) | Real `createTool`/`registerTools`/`getAddonToolDescriptions`; Pi API fake | A | Tool-name guardrails partially overlap `routing/tool-bundles.test.ts` (outside scope) | keep | snake_case/verb-prefix, empty description, missing parameters, duplicate-registration warn + description dedupe. Good. |
| `workflows/compare-assets.test.ts` (12) | `buildCompareAssetsWorkflowDefinition` prompt strings | B | Overlaps other workflow prompt tests | keep (flag) | Strong negative cases ("does not apply fund-overlap guidance…", 130–152). Heavily source-text (58 `toContain|toMatch`). Prompt is a product artifact, so regression value exists, but assertion specificity is brittle. Origin 2026-03-29. |
| `workflows/options-screener.test.ts` (15) | Prompt strings | B | Overlaps `orchestrator` and other workflow prompt tests | **consolidate (investigate)** | `follow-up prompt gives a covered-call fallback when quotes are unusable` (135–172) is one test with ~28 `toContain` assertions over a single prompt blob — a change to any wording fails it, and no single assertion isolates a defect. Recommend splitting by contract behavior or asserting on structured step metadata. Regression comments (94–110) show origin in live-run failures. Origin 2026-03-29, 14 commits. |
| `workflows/portfolio-builder.test.ts` (11) | Prompt strings + step metadata | B | Overlaps `portfolio-output-validation` | keep (flag) | Mixes real step-type/skippable/`outputValidation` assertions (good) with prompt-string presence. |
| `workflows/portfolio-output-validation.test.ts` (4) | Real parser/validator | A | Complements `portfolio-builder` | keep | Exact failure-list equality, duplicate/composite holdings, bounded repair prompt. Best-quality workflow test. |

**Retained runtime envelope coverage after deleting `types/web-search.test.ts`** (recorded per parent request): the `WebSearchResult`/`WebSearchEnvelope` fields are asserted through real parsing in `tests/unit/providers/web-search.test.ts` — `:157` "maps general search results to WebSearchResult" (exact `title`/`url`/`snippet`/`source`/`published`/`category` equality), `:176` "maps news results to WebSearchResult with ISO dates", `:193` "extracts domain from URL for general results", `:207` "returns empty envelope when DDG returns noResults" (`resultCount`), plus `provider` assertions at `:100`/`:115`. The tool-layer `search_web` envelope is asserted at `tests/unit/tools/web-search.test.ts:214` "returns details as WebSearchEnvelope". These cover the same observable contract with runtime parsing.

**Conclusion:** `types/web-search.test.ts` was the clearest low-value unit file in scope and has been deleted. Workflow tests are valuable prompt-contract tests but are the highest-brittleness cluster; `options-screener.test.ts:135–172` is the worst offender.

---

## 4. tests/unit/providers (24 files, 291 executable cases)

This directory was prioritized per the brief: source assertions and provider-internal mocks were inspected.

| File (cases) | Boundary / mock | Assertion quality | Internal-mock concern | Disposition | Remaining proof / notes |
| --- | --- | --- | --- | --- | --- |
| `wrap-provider.test.ts` (7) | Real `wrapProvider`; real `Cache` | A | none | keep | ok/unavailable/non-Error throw/credential re-throw/cache-hit. Owner of the contract other tests fake. |
| `with-fallback.test.ts` (7) | Real `withFallback` + `ProviderTracker` + run-context | A | none | keep | Primary/fallback/all-fail reason preservation/circuit-open skip. |
| `provider-credential-error.test.ts` (5) | Real class | A | none | keep | provider/reason/status/message/name. |
| `yahoo-finance.test.ts` (17) | `yahoo-finance2` module mocked; `globalThis.fetch` mocked | A | `yahoo-finance2` is an external lib, mocked at dependency boundary — acceptable, but the post-market enrichment case (92–107) relies on a mocked external module that returns the claim ("self-produced" signal). Real chart fetch is exercised separately. | keep (flag) | Strong: change math, asOf/fetch-timestamp split, sparse-response `InvalidSymbolError`, penny-quote preservation, 429 Retry-After then stale serve, intraday epoch timestamps, annual-prefixed mapping, stale statements. **Gap:** `getYahooCompanyOverview` (defined `src/providers/yahoo-finance.ts:126`) has **no direct provider test in scope**; it is only mocked in `tools/comps.test.ts` and exercised in out-of-scope GUI tests. |
| `yahoo-holdings.test.ts` (6) | fetch mock; real crumb flow | A | none | keep | Normalization, malformed-weight filtering, raw/fmt wrappers, crumb retry, stale fallback. |
| `yahoo-options.test.ts` (22) | fetch mock; `yahoo-finance2` mocked | A | yahoo-finance2 fallback mocked as external boundary | keep | `computeTimeToExpiry` boundary cases, crumb extraction/404-cookie/timeouts, Greeks signs, closed-market stale labeling, fallback precedence, all-paths-fail message. Stale-chain case uses a self-inserted cache object, but the assertion is about fallback ordering. |
| `alpha-vantage.test.ts` (21) | fetch mock; fixtures | A | none | keep | Statement merge by fiscal date, FCF math, rate-limit/information payloads, date-only asOf, credential 401/403 vs 500. |
| `lse.test.ts` (18) | fetch/`Response` mock; `config` + `lse-byte-budget` mocked | A | `config` and `lse-byte-budget` are sibling modules; byte-budget behavior is separately covered in infra. Mocking here is a boundary, not self-produced. | keep | Strongest provider file: `it.each` malformed candle families (4), 401/403 stale-credential-before-cache (2), 5xx retry counts, empty payload rejection, X-Data-Bytes, allowance-429 no-retry, timeframe mapping (9), sparse/blank financials rejection. |
| `finnhub.test.ts` (16) | `src/infra/http-client` module mocked | B | Mocks the HTTP layer, so retry/`Retry-After` from `http-client` is bypassed; those paths are covered in `infra/http-client.test.ts`. Acceptable. | keep | Date-range families, relevance filter, cap-at-20, credential 401/403, stale-cache-on-failure. |
| `fred.test.ts` (5) | fetch mock | A | none | keep | Dot-value filtering, caching, 401 stale credential, 400 must **not** be a credential error. |
| `coingecko.test.ts` (4) | fetch mock | A | none | keep | Price/history mapping, volume=0 for OHLC, caching, header assertions. |
| `fear-greed.test.ts` (5) | fetch mock | A | none | keep | Label mapping incl. extremes, null week/month, caching. |
| `polymarket.test.ts` (10) | fetch mock; fake timers | A | none | keep | Outcome/close-date/asOf mapping, closed/inactive filtering, flagless stale-date rules, malformed-price position preservation, out-of-bounds drop, cache, rate-limit bucket, stale fallback via `wrapProvider`. Strong. |
| `sec-edgar.test.ts` (9) | fetch/`Response` mock | A | none | keep | Query params, typed filings, archive URL, snippet extraction + `AbortSignal` + rate-limit spy, dedupe, ticker| |
| `tradingview.test.ts` (8) | fetch mock; real rate limiter | A | none | keep | `buildTvSymbol`, exact POST body, bare-symbol name lookup, two-POST mixed resolution, canonical cache key, shuffled-field backfill, finite-close resolution, stale scanner serve. Strong. |
| `reddit-cli.test.ts` (7) | **Explicit runner seam** `setRdtCommandRunnerForTests` | A | Seam is an intentional test injection point in production; not a self-produced expectation. | keep | Command argv, adaptation, typed ENOENT, credential/redaction, malformed + structured JSON errors. |
| `twitter-cli.test.ts` (8) | **Explicit runner seam** | A | Same as above | keep | argv, nested metrics, ENOENT, two Cookie-redaction cases, malformed/unsuccessful envelope, non-zero structured error. |
| `reddit.test.ts` (11) | runner seam; fixtures | A | none | keep | Post mapping, mentions, caching, sentiment sign/range/mixed, top-N comments. |
| `twitter.test.ts` (12) | `src/providers/twitter-cli` module `vi.mock`ed | B | Stubs its sibling provider; that sibling is separately tested, so this is layering, but sentiment scoring is now asserted only through the mocked input. | keep (flag) | `normalizeQuery`, engagement weighting, empty/neutral, lookback filter, failure surface, cache. Origin 2026-04-04. |
| `web-search.test.ts` (39) | `ddg-kit`, `http-client`, `config`, `exa-search` mocked | B | Multiple sibling/external mocks. Cascade behavior asserted by configuring the mocks, which is expected for a cascade unit test, but no real provider parse runs here. | keep (flag) | Broad DDG/Brave mapping + cascade/override/allowedProviders. **Defect:** stale-cache case (254–282) writes `cache.store.set(...)` directly at line 262, reaching a `private store` (`src/infra/cache.ts:40`). Tests are excluded from `tsc`, so this only breaks when `Cache` internals change. Replace with `cache.set(key, value, -1)` + timer advance (the pattern used elsewhere, e.g. `crypto-price.test.ts:68`). |
| `exa-search.test.ts` (38) | fetch/SSE mocks; `config` mocked; `(cache as any).store` seam | B | MCP parsing is exercised against real SSE/JSON fixtures (good). Stale fallback (375–397) reaches into `(cache as any).store` at line 381. | keep (flag) | Same private-store fragility as above. Otherwise strong MCP/API branch coverage. |
| `external-cli-utils.test.ts` (2) | Real parsers | A | none | keep | Error-envelope parsing rejects ok:true; timestamp normalization incl. NaN/invalid. |
| `external-tool-command.test.ts` (4) | Real spawn; real temp shims; env stub | A | none | keep | uv shim discovery incl. `uv tool dir --bin`; ENOENT. |
| `social-mentions.test.ts` (1) | Real aggregation | A | none | keep | Single focused behavior. |

### Provider cross-file findings

- **No test stubs a provider and then asserts the stub's own value as proof of provider behavior.** The internal mocks that exist are either (a) explicit production test seams (`setRdtCommandRunnerForTests`, `setTwitterCliCommandRunnerForTests`), or (b) sibling/external module mocks whose real behavior is covered in another file. No deceptive self-produced expectations were found in this directory.
- **A mock being explicit does not prove the integration is valid.** The prior `tests/unit/tools/dcf.test.ts` mocked `wrapProvider` with a *reimplementation* (its own `staleProviders` set and `timestamps` map) and asserted stale/freshness outcomes against that fake. A divergence between the reimplementation and the real `wrapProvider`/`cache` stale propagation would not have failed any test. That suite has been replaced with real-provider fixture-HTTP coverage (see §5), which now consumes the real `wrapProvider`, `cache`, and `rateLimiter`.
- **Fragile private-store seam (2 files):** `providers/web-search.test.ts:262`, `providers/exa-search.test.ts:381`. Because `tsconfig.json` excludes `tests/` from `tsc`, `npm run typecheck` cannot catch this coupling.
- **Missing direct provider journey:** `getYahooCompanyOverview` (`src/providers/yahoo-finance.ts:126`) has no direct unit test; it is only mocked where consumed.

---

## 5. tests/unit/tools (40 files, 416 executable cases)

The tools directory is generally the strongest cluster: most files mock `globalThis.fetch` with fixtures and assert concrete tool output/details, while stateful tools (`watchlist`, `alerts`, `portfolio-tracker`, `daily-report`, `notifications`) use real SQLite via `MarketStateService`, which is the correct boundary.

### 5.1 Strong keepers (behavior-level, A)

| File (cases) | Boundary | Notes |
| --- | --- | --- |
| `alerts.test.ts` (27) | Real SQLite; fetch/module mocks | Canonical condition JSON, seed-before-trigger, cooldown suppression, zero/stale data unavailable, unsupported version, integer/limit validation, runner status. Strong. |
| `portfolio-tracker.test.ts` (24) | Real SQLite; quote mock | Lot update/remove scoping, missing lot_id, zero-cost legacy lot, mixed/unknown currency, zero/stale exclusion, needs_selection. Strong. |
| `watchlist.test.ts` (23) | Real SQLite; TradingView/Yahoo mocks | Named lists, rename/delete/select, 100+ batch, stale/zero unavailable, candidate matches. Strong. |
| `dcf.test.ts` (34) | **Replaced (parent-approved, done 2026-09-24):** pure `computeDCF`/`computeNetDebt` unchanged; the 16 `compute_dcf` tool-behavior cases now run the registered `dcfTool` through the real Alpha Vantage / LSE / Yahoo providers, `wrapProvider`, `cache`, and `rateLimiter` against fixture HTTP (`globalThis.fetch`), with a new `tests/fixtures/yahoo-finance2/fundamentals-timeseries-AAPL.json`. | Mid-year convention, TV-warning boundaries, terminal-spread rejection, signed net cash, provider chain order, LSE/AV stale fallback/refusal, Yahoo stale refusal, shares derivation from statement and market cap, zero-price and no-share refusals. The old `vi.mock` of `wrapProvider` with a reimplementation and of the three provider modules was removed. |
| `daily-report.test.ts` (8) | Real SQLite; quote mock | Zero/stale gap handling, template upsert, run linkage, notification recording. |
| `holdings-overlap.test.ts` (2) | Real `computeHoldingsOverlap`; fixture fetch | Exact pairwise min-weight math + tool details. |
| `backtest.test.ts` (17) | Real `runBacktest` | Next-open fills, phantom-trade prevention, cost model, zero-close finiteness, mark-to-market drawdown. Strong math boundaries. |
| `risk-analysis.test.ts` (13) | Real functions | Drawdown/VaR/zero handling. **Minor flake risk:** `computeRiskMetrics` case (64–81) seeds with `Math.random()` but only asserts loose ranges; deterministic would be better. |
| `indicators.test.ts` (20) | Real functions | SMA/EMA/RSI/MACD/BB/OBV/VWAP exact values. |
| `correlation.test.ts` (11) | Real functions + `alignReturnsByDate`; history mocked | Alignment/gap/threshold, dropped-symbol reporting. |
| `price-comparison.test.ts` (13) | Real tool; `Response` mock | Alignment/indexing, intraday timestamp intersection, zero-base drop + realign, partial series, >30% window-loss note, stale per-series disclosure, bundle registration. Strong. |
| `event-probabilities.test.ts` (5) | Real tool; fetch mock | Mandatory caveats, low-liquidity flag, untrusted-text escaping, honest empty, stale disclosure. |
| `option-chain.test.ts` (9) | Real tool; crumb/options fetch mock | Premium units, invalid date pre-fetch, long-dated expirations, stale quote warning. |
| `sentiment-query-match.test.ts` (14) | Real matcher | Ticker/topic/class-share/S&P/punctuation/phrase/plural family — high-quality boundary tests. |
| `financials.test.ts` (8) | Real tool; provider modules mocked | LSE-first, AV fallback, stale preference, credential flow, `it.each` fallback family (3). |
| `stock-history.test.ts` (7) | Real tool; provider modules mocked | Intraday LSE fallback, weekly rename, budget removal, date-only start, stale disclosure, chain order. |
| `stock-history-provider-failures.test.ts` (1) | Real tool; real provider hosts + `lse-byte-budget` mock | Asserts unavailable + `lse:` reason on LSE 401. |
| `web-search.test.ts` (20) | Real tool; `searchWeb` + `hasCredential` mocked | Defaults, clamping, empty query, untrusted escaping, Fed source-gap, soft-degraded tags (brave/exa/both), unavailable. |
| `web-sentiment.test.ts` (4) | Real tool; searchWeb mock; in-memory sentiment singleton | Scored output + injection escaping. |
| `reddit-sentiment.test.ts` (12) | Real tool; runner seam; in-memory store | Query filtering, comment consistency, multi-subreddit aggregation, injection, setup tags/retry. |
| `twitter-sentiment.test.ts` (12) | Real tool; provider/wrap mocks; temp home | Setup tags, retry, persistent skip, clamp, stale, injection. |
| `sentiment-summary.test.ts` (13) | Real tool; many provider mocks; in-memory store | Skip preferences, setup prompts, price context incl. weekend, Finnhub soft-degradation. |
| `hosted-sentiment-summary.test.ts` (10) | Real tool; provider mocks | Negotiated providers, stale provenance, URL safety, zero-quote rejection, round-robin budget. |
| `ask-user.test.ts` (15) | Real registered tool; fake Pi ctx/handler | select/text/confirm, cancelled/empty, handler priority. |
| `search-ticker.test.ts` (6) | Real tool; fetch mock; fake timers | Yahoo→TradingView fallback, Retry-After cap, company-name fallback, double-failure. |
| `stock-quote.test.ts` (7) | Real tool; fetch mock | Formatting, stale wording, sparse invalid response. |
| `crypto-price.test.ts` (5) | Real tool; fetch mock | Details, lowercase, stale disclosure. |
| `crypto-history.test.ts` (1) | Real tool; fetch mock | Risk metrics section when ≥45 bars. |
| `fred-data.test.ts` (2) | Real tool; fetch mock; temp config | Derived YoY, limit expansion. |
| `comps.test.ts` (2) | Real tool; provider mocks | Partial-results + per-symbol failure reasons. |
| `sec-filings.test.ts` (2) | Real tool; provider/wrap mocked | Evidence warning rendering + untrusted snippet escaping. |
| `tool-schema-guardrails.test.ts` (7) | Real tool schemas via TypeBox | **Only 8 of 33 registered tools** covered (stock-history, correlation, risk, backtest, option-chain, fred, portfolio-tracker, alerts). |
| `notifications.test.ts` (1) | Real SQLite service + tool | list/acknowledge durable events. |
| `sentiment-trend.test.ts` (3) | Real `SentimentStore(":memory:")` | **Weak:** `has correct tool name` (16–18) is tautological. Empty/populated behavior cases are fine. |
| `insight-format.test.ts` (1) | Real formatter | Exact preview count sentence. |
| `formatting.test.ts` (1) | Real formatter | Magnitude suffixes. |
| `untrusted-text.test.ts` (3) | Real sanitizer | Markdown escape, delimiter forgery, control strip, URL credential/CRLF rejection. Strong security contract. |
| `greeks.test.ts` (16) | Real Black-Scholes | Moneyness boundaries, zero-time intrinsic, put/call parity. |
| `orchestrator.test.ts` (27) | Real builders/parsers | See 5.3. |

### 5.2 Tools with low-value metadata cases (C), flagged not deleted

Many tool suites open with a "has correct tool name / metadata" case: `crypto-price.test.ts:19–22`, `stock-quote.test.ts:23–27`, `option-chain.test.ts:44–48`, `web-sentiment.test.ts:60–62`, `twitter-sentiment.test.ts:51–55`, `reddit-sentiment.test.ts:58–60`, `sentiment-summary.test.ts:107–109`, `ask-user.test.ts:32–37`, `sentiment-trend.test.ts:16–18`, `web-search.test.ts:76–80`, `watchlist.test.ts:49–53`, `screen-stocks.test.ts:21–26`. These assert only `name`/`label`/`description` truthiness. They are cheap but detect nothing a reader cannot see; candidate **consolidate** into one registry-level test (the registration/name-uniqueness journey is partly owned by `tests/unit/routing/tool-bundles.test.ts`, outside this audit scope).

### 5.3 Tools source-text / overlap findings

| Location | Finding | Disposition |
| --- | --- | --- |
| `orchestrator.test.ts:240–248` | Duplicate `describe("comprehensive analysis follow-up prompts")` block repeating `79–81` ("queues 10 follow-ups"). Straight overlap. | consolidate |
| `orchestrator.test.ts:92–97` | "includes symbol in every analyst prompt" asserts all 11 prompts contain the symbol; low specificity but valid. | keep (flag) |
| `orchestrator.test.ts` (55 `toContain`) | Prompt-contract assertions for personas/debate/synthesis. Valuable but source-text. | keep (flag) |
| `screen-stocks.test.ts:54–60` | Asserts the tool forwards args verbatim to the mocked provider and then asserts the mock's returned row appears — the provider parse itself is not exercised here (covered in `providers/tradingview.test.ts`). Acceptable layering. | keep |
| `financials.test.ts` / `stock-history.test.ts` | Two files re-test the LSE→AlphaVantage→Yahoo fallback chain with self-mocked providers. Each targets a different consumer tool, so value is distinct, but the fallback ordering assertions are structurally repeated. `dcf.test.ts` now covers the same chain against real providers and could later become the shared reference. | keep (flag consolidate) |
| `web-search.test.ts` (tool) vs `providers/web-search.test.ts` | Normalization/cascade asserted at both layers. Different boundaries; acceptable. | keep |

### 5.4 Tool missing journeys

- **`tool-schema-guardrails.test.ts` covers 8 of 33 registered tools.** The other 25 tools have no negative TypeBox schema assertions (only positive `Value.Check` in a few files such as `price-comparison.test.ts:152–168` and `screen-stocks.test.ts:89`).
- **No scoped test asserts global registry invariants** (unique snake_case names, non-empty descriptions, every bundle tool exists). `price-comparison.test.ts:354–357` checks one tool's bundle membership only. `tests/unit/routing/tool-bundles.test.ts` and `tests/unit/pi/tool-adapter.test.ts` (outside scope) partly own this; parent should confirm they are sufficient.
- **`getYahooCompanyOverview`** has no direct provider-level test anywhere in scope (see §4).

### 5.5 DCF replacement evidence (parent-approved)

- **Transport trace (required because `getYahooFinancials` does not use `httpGet`).** `getYahooFinancials` calls the `yahoo-finance2` client's `fundamentalsTimeSeries`. That package resolves its transport to `globalThis.fetch` (`node_modules/yahoo-finance2/esm/src/lib/yahooFinanceFetch.js:58`) and requests `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/<symbol>` (`.../src/modules/fundamentalsTimeSeries.js:212`). It is therefore drivable through the same fixture-HTTP seam as the other providers; no extra transport shim was needed. yahoo-finance2's optional version notice (npm registry) and extended-hours `quote` call are also routed by the test's fetch stub.
- **Fixture added:** `tests/fixtures/yahoo-finance2/fundamentals-timeseries-AAPL.json` (two annual periods; raw `reportedValue` shape yahoo-finance2 transforms with `validateResult: false`).
- **Branch preservation:** the 16 tool-behavior cases map 1:1 onto the previous 16 mocked-provider cases. One previous case ("falls through an empty LSE statement set") is not reachable as a literal `[]` from the real LSE provider, which throws when it builds zero complete statements (`src/providers/lse.ts:311`); the replacement case feeds incomplete LSE reports and asserts the same downstream fall-through to Alpha Vantage, with the provider's own empty-set rejection retained in `tests/unit/providers/lse.test.ts:305–330`. No distinct failure/freshness/provider-order branch was dropped.
- **Red/green demonstration:** after the suite was green (34/34), `src/providers/wrap-provider.ts` was temporarily changed to drop `stale` propagation (`stale: cache?.status === "stale" ? true : undefined,` → `stale: undefined,`). Focused run: **4 failed / 30 passed** — the three stale-refusal/fallback cases plus the all-stale chain case — proving the new tests exercise real wrapper integration rather than a fake. The production file was then restored (`git diff -- src/` empty) and the suite re-ran green (34/34). No production edit remains.

---

## 6. tests/e2e (8 non-GUI scripts)

These are `tsx` scripts with hand-rolled `test()`/`record()` harnesses, not Vitest. They are opt-in and **not gated**.

| File | Cases / shape | Live dependency | Assertion quality | Disposition | Findings |
| --- | --- | --- | --- | --- | --- |
| `tools.test.ts` | ~27 scripted checks (+ one try/catch store block) | Live Yahoo/SEC/Coingecko/AV (conditional) | B | **investigate** | Credible defect: several checks "pass" by early `return` on environment failure, so a real regression hidden behind an outage is counted as a pass: Reddit 403 (130–137), Alpha Vantage rate-limit/empty (147–172, 312–332), web-search unavailable/zero-results (479–484, 506–518). The summary prints `passed` with no skip bucket. Origin 2026-03-29, 15 commits, last 2026-08-01. |
| `cli.test.ts` | 8 scripted + 1 comprehensive | **Live LLM** (`gemini-2.5-flash`) | B/C | investigate | Requires model credentials; not runnable in this audit (no live model calls allowed). Comprehensive case (198–226) only asserts `allTools.length >= 2` and `allText.length > 100` — it does **not** verify the named personas/voting it claims to. Weak live-LLM value; overlaps the deterministic `orchestrator.test.ts`. |
| `providers.test.ts` | ~90 provider checks over 15 stocks/10 crypto | Live many | B | keep (flag) | `SKIP` on `/HTTP 429|Too Many Requests|rate limited|is not installed/i` (83). A fully rate-limited run records SKIP, prints no failures, and exits 0 (`320–351`). This is a deliberate canary policy but must not be read as provider-drift coverage in that run. Shape-drift checks for LSE candles are genuinely useful. |
| `harness-dcf.test.ts` | 1 TUI journey | Live LLM + AV | A (for the journey) | keep | Correctly `exit(1)` on missing credentials (30–36) — the good pattern. Asserts `compute_dcf` in trace and intrinsic value in final text. |
| `credential-prompt.test.ts` | 6 record() assertions | Live LLM | A | keep | Real session interception, onboarding persistence. **Doc/code contradiction:** header (lines 20–23) says "If none is present, the test exits 0 with a skip notice", but code `process.exit(1)` (58–67). Same contradiction in the other three credential scripts. |
| `credential-snooze.test.ts` | 7 assertions | Live LLM | A | keep | Snooze persistence, same-session dedup, fresh-session re-prompt, expiry fast-forward. Docstring contradiction (21–24 vs 52–61). |
| `credential-soft-fallback.test.ts` | 5 assertions | Live LLM | A | keep | Asserts zero prompts, search_web call, Data-gaps remediation. Docstring contradiction (26–29 vs 58–67). |
| `credential-per-workflow-cap.test.ts` | 5 assertions | Live LLM | A | keep | Exactly-one hard prompt; both providers surfaced. Docstring contradiction (28–31 vs 60–69). |

### E2E trust notes

1. **False-pass-on-outage pattern** in `tools.test.ts` is the most actionable e2e defect. Recommended replacement: a `skipped` counter where environment failures are counted, and `process.exit(1)` if a required assertion never executed.
2. **Stale docstrings** in all four `credential-*.test.ts` headers claim "exits 0 with a skip notice"; code hard-fails with `exit(1)`. Either the docs or the code must change. `harness-dcf.test.ts` is the reference for the intended (fail-closed) behavior.
3. **No gate integration:** none of these scripts run in `gates`/`gates:full`/CI as configured. Their evidence is only as fresh as the last manual run.
4. **Live-LLM scripts cannot substitute for deterministic coverage** of routing/persona behavior; the deterministic `orchestrator.test.ts` is the right owner, and `cli.test.ts`'s comprehensive check is too weak to add signal.

---

## 7. Overlap and duplication summary

- `orchestrator.test.ts:240–248` duplicates `:79–81` verbatim in intent.
- `types/web-search.test.ts` duplicates runtime type contracts already exercised by provider/tool tests, with zero independent assertions.
- Tool metadata `name/label/description` cases are repeated across ~12 tool files.
- Provider-key env/file/undefined triples repeat across 4 providers in `infra/config.test.ts`.
- LSE→AV→Yahoo fallback ordering is asserted from three consumer tools (`financials`, `dcf`, `stock-history`); `dcf` now does so against real providers.
- `web-search` normalization/cascade is asserted at both provider and tool layers.
- Prompt-string assertions are duplicated across the 4 workflow files and `orchestrator.test.ts`.

None of these overlaps are actively harmful (they are fast and stable); the consolidation candidates are for maintenance cost, not correctness.

---

## 8. Explicit pending gaps (not claimed as covered)

1. **Coverage percentages were not computed.** Per the test-audit skill and the run scope, no percentage is inferred from file/case counts; the parent will perform the integrated baseline/final coverage comparison. `vitest.config.ts` instruments `src/**/*.ts` only, with no `gui/` or `workers/` surfaces — but that denominator question is outside this audit.
2. **Default static-parse `vitest list` undercounts.** It omits `tests/unit/infra/config-permissions.test.ts` and conditional collections. Use `--staticParse=false`; the corrected numbers are in §1/§9.
3. **Out-of-scope surfaces** that provide remaining proof for scoped gaps: `tests/unit/routing/tool-bundles.test.ts`, `tests/unit/pi/tool-adapter.test.ts`, `tests/unit/pi/opencandle-extension.test.ts`, `tests/unit/gui-server/*`, `tests/unit/gui-hosted/*`. These were not read in full and are not audited here.
4. **E2E scripts were read but not executed** (no live model/provider calls permitted; credentials not read). Consequently the credential e2e and `cli.test.ts` flows are "reviewed, not verified at runtime".
5. **`getYahooCompanyOverview` provider mapping** lacks direct coverage in the audited surfaces.
6. **HTTP-date `Retry-After`** parsing is untested in `infra/http-client`.
7. **31 of 33 tool schemas** lack negative TypeBox assertions.
8. **No test file is typechecked.** `tsconfig.json` excludes `tests/`, so no replacement type test for the deleted `types/web-search.test.ts` was added (per parent: no replacement unless a real compilation target supports it).

## 9. Scope counts (audited)

- Unit test files accounted for: **81 / 81 pre-cleanup**; **80 / 80 post-cleanup** (each file appears in a table above; `tests/unit/types/` was deleted).
- Unit cases accounted for (true executable collection, `--staticParse=false`): **879 pre-cleanup / 81 files**, of which 1 is a win32-only `skipIf` → 878 executed on darwin; **875 post-cleanup / 80 files**, of which 1 is win32-only → 874 executed on darwin. Per-directory post-cleanup: tools 416, providers 291, infra 107, analysts 11, workflows 42, tool-kit 8.
- E2E scripts accounted for: **8 / 8**, with ~27 + 9 + ~90 + 1 + 6 + 7 + 5 + 5 scripted checks/assertions.
- Unreviewed families: **none within the owned unit surfaces.** Unreviewed *surfaces* are listed in §8 (routing/pi/gui tests and live e2e execution).

## 10. Approved cleanup performed and next batch

Performed this run (parent-approved; all uncommitted):

1. **Deleted** `tests/unit/types/web-search.test.ts` (4 tautological object-literal cases). No replacement type test added because tests are not typechecked; runtime envelope coverage is retained at `providers/web-search.test.ts` and `tools/web-search.test.ts` (recorded in §3).
2. **Replaced** the `compute_dcf` tool-behavior suite in `tests/unit/tools/dcf.test.ts`: removed all `vi.mock` of `wrapProvider` + Alpha Vantage/LSE/Yahoo; the registered `dcfTool` now runs the real providers, `wrapProvider`, `cache`, and `rateLimiter` over fixture HTTP. Added `tests/fixtures/yahoo-finance2/fundamentals-timeseries-AAPL.json`. Pure `computeDCF`/`computeNetDebt` tests unchanged; all 16 distinct tool branches preserved (see §5.5). Red/green demonstrated via a temporary `wrap-provider.ts` stale-propagation fault (4 failures) and restored.
3. **Gates run once** after the changes: `npm run gates` exit 0 — unit 349 files / 3737 passed, 1 skipped; relay 76 passed; agent-tools 28 passed; `check` (typecheck + scripts typecheck + relay typecheck + `biome ci`) clean.

Remaining recommended batch (parent decides):

1. Replace the private-store stale-cache seams (`providers/web-search.test.ts:262`, `providers/exa-search.test.ts:381`) with the public `cache.set(..., -1)` + timer-advance pattern.
2. Fix the `tools.test.ts` false-pass-on-outage pattern (introduce a skip bucket and fail when a required check never ran) and reconcile the credential-script docstrings with their `exit(1)` behavior.
3. Consolidate the repeated tool-metadata cases and the `orchestrator.test.ts:240–248` duplicate describe block.
4. Split `options-screener.test.ts:135–172` into per-contract assertions.
5. Consider a single registry-level schema guardrail test to cover the 25 tools with no negative schema assertions (coordinate with the routing/pi test owners).

## 11. Deviations / truthfulness notes

- First pass was read-only. After parent review, the two approved test cleanups in §10 were applied. No production, config, or changelog file was modified; `git diff -- src/` is empty.
- The contract's read-only ledger rule was superseded by explicit parent review authorizing these test cleanup actions.
- No gates were run during the first pass; gates were run once after the approved cleanup (§10). One focused unit file (`config-permissions.test.ts`) was executed to explain the collection omission.
- No live model/provider calls were made. The new DCF tests use fixture HTTP only.
- Individual per-file git origins were only inspected for files with findings; other origins are honestly marked by aggregate span. Full per-file first-added history remains available in git if the parent needs it.
