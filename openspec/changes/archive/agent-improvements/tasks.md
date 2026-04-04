## 1. Debate Types and Parsing (eval/test infrastructure)

- [x] 1.1 Add `DebateSide` type (`"bull" | "bear"`) to `src/runtime/workflow-types.ts`
- [x] 1.2 Add `DebateOutput` interface to `src/runtime/workflow-types.ts` — `{ side: DebateSide, thesis: string, keyRisk: string, concessions: string[], remainingConviction: number, evidence: EvidenceRecord[], rawText: string }`
- [x] 1.3 Implement `parseDebateOutput(side: DebateSide, responseText: string): DebateOutput` in `src/analysts/contracts.ts` — pattern-match BULL THESIS / BEAR THESIS, KEY RISK / KEY RISK TO THIS THESIS, WHAT WOULD CHANGE MY MIND, CONCESSIONS, REMAINING CONVICTION. Detect skipped rebuttal via case-insensitive `/^rebuttal skipped/i` prefix match (any trailing text/punctuation).
- [x] 1.4 Implement `isAnalystSplit(outputs: AnalystOutput[]): boolean` in `src/analysts/contracts.ts` — returns `tallyVotes(outputs).buy > 0 && tallyVotes(outputs).sell > 0`. Eval/test helper only.
- [x] 1.5 Write unit tests for `parseDebateOutput` — well-formed bull, well-formed bear, rebuttal with concessions, rebuttal skipped (test punctuation variants: "REBUTTAL SKIPPED — consensus reached.", "Rebuttal skipped.", "REBUTTAL SKIPPED - consensus"), malformed fallback
- [x] 1.6 Write unit tests for `isAnalystSplit` — consensus (all BUY), consensus (BUY+HOLD), split (BUY+SELL), edge case (all HOLD)

## 2. Debate Prompts

- [x] 2.1 Add `buildBullPrompt(symbol: string): string` to `src/analysts/orchestrator.ts` — references analyst perspectives above, allows ≤2 tool calls for gap-filling, requires "BULL THESIS:" and "KEY RISK TO THIS THESIS:" ending, includes EXECUTION_GUARDRAILS
- [x] 2.2 Add `buildBearPrompt(symbol: string): string` to `src/analysts/orchestrator.ts` — references analysts + bull case above, attacks weakest assumptions, allows ≤2 tool calls, requires "BEAR THESIS:" and "WHAT WOULD CHANGE MY MIND:" ending, includes EXECUTION_GUARDRAILS
- [x] 2.3 Add `buildRebuttalPrompt(symbol: string): string` to `src/analysts/orchestrator.ts` — self-gating: instructs LLM to check the five analyst `SIGNAL:` lines specifically (not BUY/SELL mentions in bull/bear prose); if no BUY+SELL disagreement, respond with a line starting "REBUTTAL SKIPPED"; otherwise full rebuttal with CONCESSIONS and REMAINING CONVICTION. No tool calls allowed. Includes EXECUTION_GUARDRAILS.
- [x] 2.4 Write unit tests for prompt generation — verify each prompt contains required markers, guardrails, tool constraints, self-gating instructions in rebuttal

## 3. Debate-Aware Synthesis and Validation

- [x] 3.1 Replace `SYNTHESIS_PROMPT` with `buildSynthesisPrompt(symbol: string): string` — self-adapting: references debate above, handles both rebuttal-present and REBUTTAL SKIPPED cases. Requires VERDICT, CONFIDENCE, DEBATE WINNER, REVERSAL CONDITION markers. Keeps vote tally, key levels, position sizing.
- [x] 3.2 Update `VALIDATION_PROMPT` to include debate-specific checks — verify bull/bear number citations, verify concessions are genuine (if rebuttal not skipped), verify reversal condition is testable
- [x] 3.3 Write unit tests for `buildSynthesisPrompt` — verify debate references, self-adapting language, required output markers
- [x] 3.4 Write unit tests for updated validation prompt — verify debate checks included

## 4. Orchestrator Integration

- [x] 4.1 Update `buildComprehensiveAnalysisDefinition(symbol)` to insert 3 debate steps between analysts and synthesis: `debate_bull` (skippable: false), `debate_bear` (skippable: false), `debate_rebuttal` (skippable: false). Total: 11 steps.
- [x] 4.2 Update `buildComprehensiveAnalysisDefinition` to use `buildSynthesisPrompt(symbol)` and updated `VALIDATION_PROMPT`
- [x] 4.3 Update `getComprehensiveAnalysisPrompts(symbol)` for backward compat — include debate prompts in returned array between analysts and synthesis
- [x] 4.4 Update `runComprehensiveAnalysis()` for backward compat — enqueue debate prompts after analysts
- [x] 4.5 Write unit tests for updated step sequence — verify 11 steps, correct order, step types, skippable flags
- [x] 4.6 Update existing unit tests in `tests/unit/tools/orchestrator.test.ts` — adjust step count and prompt count assertions

## 5. Integration and Verification

- [x] 5.1 Run full test suite (`npm test`) and verify all existing tests pass with updated step counts
- [x] 5.2 Update e2e test in `tests/e2e/tools.test.ts` — adjust `runComprehensiveAnalysis` assertion from 7 to 10 follow-ups
- [x] 5.3 Add eval case for comprehensive analysis with debate — verify debate steps appear in trace, synthesis references debate, reversal condition present
- [x] 5.4 Manual test via harness: `npx tsx tests/harness/manual-run.ts <dir> "analyze AAPL"` — verify debate steps execute, synthesis resolves tension, output quality improved

## 6. Error Recovery Level A: Provider Circuit Wiring

- [x] 6.1 Create `src/runtime/provider-ids.ts` — export `PROVIDER_ID` const object with canonical IDs: `yahoo`, `alphavantage`, `coingecko`, `fred`, `sec-edgar`, `reddit`, `feargreed`. Export `ProviderId` type. These match existing rate-limiter keys in `src/infra/rate-limiter.ts:54-57`.
- [x] 6.2 Create `src/runtime/run-context.ts` — module-level run context bridge. Export `setRunContext(ctx)`, `clearRunContext()`, `getProviderTracker(): ProviderTracker | undefined`. The context holds the active run's `ProviderTracker` instance.
- [x] 6.3 Update `src/runtime/session-coordinator.ts` — in `executeWorkflow()`, call `setRunContext({ providerTracker })` before the first prompt and `clearRunContext()` on completion/cancel. The providerTracker should be the same instance passed to the WorkflowRunner.
- [x] 6.4 Update `src/providers/wrap-provider.ts` — import `getProviderTracker` from run-context. Before calling `fn()`, check `tracker?.isCircuitOpen(providerId)` → return `ProviderResultUnavailable` with reason `"provider_circuit_open"`. On catch, call `tracker?.recordFailure(providerId)`. Signature changes: first param becomes `providerId: string`.
- [x] 6.5 Update `src/runtime/evidence.ts` — add `"stale_cache"` to `ProvenanceSource` union type. Add optional `stale?: boolean` to `ProviderResultOk<T>`. Update `toEvidenceRecord` to accept optional `providerId` param, set `provenance.provider` on success path (currently `undefined`), and set `provenance.source: "stale_cache"` when `result.stale === true`.
- [x] 6.6 Write unit tests for run-context — set/get/clear lifecycle, getProviderTracker returns undefined when no context active, context cleared between runs.
- [x] 6.7 Write unit tests for updated wrapProvider — circuit-open returns unavailable without calling fn, failure records on tracker, no tracker present behaves as before.
- [x] 6.8 Write unit tests for updated toEvidenceRecord — stale result produces `source: "stale_cache"`, fresh result still `"fetched"`, providerId passed through.
- [x] 6.9 Update `src/tools/fundamentals/company-overview.ts` — wrap `getOverview` call with `wrapProvider("alphavantage", ...)`. On `status: "unavailable"`, return degraded text: `"⚠ Company overview unavailable (${result.reason}). Analysis will proceed without fundamentals."`. Return `details: null as any` for unavailable.
- [x] 6.10 Update `src/tools/fundamentals/earnings.ts` — wrap `getEarnings` with `wrapProvider("alphavantage", ...)`, return degraded text on unavailable.
- [x] 6.11 Update `src/tools/fundamentals/financials.ts` — wrap `getFinancials` with `wrapProvider("alphavantage", ...)`, return degraded text on unavailable.
- [x] 6.12 Update `src/tools/fundamentals/comps.ts` — wrap `getOverview` calls (multiple symbols) with `wrapProvider("alphavantage", ...)`. Collect available + unavailable separately, format partial comparison if some succeeded.
- [x] 6.13 Update `src/tools/fundamentals/dcf.ts` — wraps both `getOverview` (alphavantage) and `getQuote` (yahoo). If either unavailable, return degraded text explaining which input is missing for DCF.
- [x] 6.14 Update `src/tools/fundamentals/sec-filings.ts` — wrap `searchFilings` with `wrapProvider("sec-edgar", ...)`, return degraded text on unavailable.
- [x] 6.15 Update `src/tools/market/stock-quote.ts` — wrap `getQuote` with `wrapProvider("yahoo", ...)`, return degraded text on unavailable.
- [x] 6.16 Update `src/tools/market/stock-history.ts` — wrap `getHistory` with `wrapProvider("yahoo", ...)`, return degraded text on unavailable.
- [x] 6.17 Update `src/tools/market/crypto-price.ts` — wrap `getCryptoPrice` with `wrapProvider("coingecko", ...)`, return degraded text on unavailable.
- [x] 6.18 Update `src/tools/market/crypto-history.ts` — wrap `getCryptoHistory` with `wrapProvider("coingecko", ...)`, return degraded text on unavailable.
- [x] 6.19 Update `src/tools/options/option-chain.ts` — wrap `getOptionsChain` with `wrapProvider("yahoo", ...)`, return degraded text on unavailable.
- [x] 6.20 Update `src/tools/macro/fred-data.ts` — wrap `getSeries` with `wrapProvider("fred", ...)`, return degraded text on unavailable.
- [x] 6.21 Update `src/tools/macro/fear-greed.ts` — wrap `getFearGreedIndex` with `wrapProvider("feargreed", ...)`, return degraded text on unavailable.
- [x] 6.22 Update `src/tools/sentiment/reddit-sentiment.ts` — wrap `getSubredditPosts` with `wrapProvider("reddit", ...)`, return degraded text on unavailable.
- [x] 6.23 Update `src/tools/sentiment/news-sentiment.ts` — wrap `getSubredditPosts` with `wrapProvider("reddit", ...)`, return degraded text on unavailable.
- [x] 6.24 Update `src/tools/portfolio/tracker.ts`, `watchlist.ts`, `predictions.ts` — wrap `getQuote` calls with `wrapProvider("yahoo", ...)`, return degraded text on unavailable.
- [x] 6.25 Update `src/tools/portfolio/risk-analysis.ts`, `correlation.ts` — wrap `getHistory` calls with `wrapProvider("yahoo", ...)`, return degraded text on unavailable.
- [x] 6.26 Update `src/tools/technical/indicators.ts`, `backtest.ts` — wrap `getHistory` calls with `wrapProvider("yahoo", ...)`, return degraded text on unavailable.
- [x] 6.27 Run `npm test` — verify all existing tests still pass. Fix any that break from the wrapProvider signature change.
- [x] 6.28 Export new modules from `src/runtime/index.ts` — run-context, provider-ids.

## 7. Error Recovery Level B: Stale Cache Degradation

- [x] 7.1 Update `src/infra/cache.ts` `CacheEntry` — add `cachedAt: number` field. Update `set()` to store `cachedAt: Date.now()`.
- [x] 7.2 Update `src/infra/cache.ts` `get()` — stop deleting expired entries (return `undefined` but leave entry in store for stale retrieval).
- [x] 7.3 Add `getStale<T>(key: string, staleLimitMs: number): StaleResult<T> | undefined` to `Cache` — returns `{ value, stale: true, cachedAt }` if entry exists and `cachedAt + staleLimitMs > now`. Deletes entry if beyond stale limit.
- [x] 7.4 Add stale-flag side channel to `Cache` — `lastGetWasStale` + `lastStaleCachedAt` fields, set by `getStale()`, consumed by `consumeStaleFlag(): { stale: boolean; cachedAt: number }` (resets flag after read).
- [x] 7.5 Add `STALE_LIMIT` constants to `src/infra/cache.ts` — `QUOTE: 15min`, `HISTORY: 24h`, `FUNDAMENTALS: 7d`, `MACRO: 24h`, `SENTIMENT: 1h`, `OPTIONS_CHAIN: 30min`.
- [x] 7.6 Write unit tests for `cache.getStale()` — returns stale within limit, returns undefined beyond limit, returns undefined when never cached, does not interfere with `get()` for fresh entries, deletes entry beyond stale limit.
- [x] 7.7 Write unit tests for `consumeStaleFlag()` — flag set after getStale hit, cleared after consume, not set on getStale miss.
- [x] 7.8 Update `src/providers/alpha-vantage.ts` — add try/catch around HTTP call in `getOverview`, `getEarnings`, `getFinancials`. On error, attempt `cache.getStale(cacheKey, STALE_LIMIT.FUNDAMENTALS)`. Return stale value if available, otherwise rethrow.
- [x] 7.9 Update `src/providers/yahoo-finance.ts` — add stale fallback in `getQuote` (`STALE_LIMIT.QUOTE`), `getHistory` (`STALE_LIMIT.HISTORY`), `getOptionsChain` (`STALE_LIMIT.OPTIONS_CHAIN`).
- [x] 7.10 Update `src/providers/coingecko.ts` — add stale fallback in `getCryptoPrice` (`STALE_LIMIT.QUOTE`), `getCryptoHistory` (`STALE_LIMIT.HISTORY`).
- [x] 7.11 Update `src/providers/fred.ts` — add stale fallback in `getSeries` (`STALE_LIMIT.MACRO`).
- [x] 7.12 Update `src/providers/reddit.ts` — add stale fallback in `getSubredditPosts` (`STALE_LIMIT.SENTIMENT`).
- [x] 7.13 Update `src/providers/fear-greed.ts` — add stale fallback in `getFearGreedIndex` (`STALE_LIMIT.SENTIMENT`).
- [x] 7.14 Update `src/providers/wrap-provider.ts` — after successful `fn()` call, check `cache.consumeStaleFlag()`. If stale, set `stale: true` and `timestamp` to `cachedAt` on the `ProviderResultOk`.
- [x] 7.15 Update tool degraded text responses (from Level A) — when `result.status === "ok" && result.stale`, prepend `"⚠ Using cached data from ${timeAgo(result.timestamp)} (provider rate limited). "` to the normal text response. Pick 2-3 representative tools (stock-quote, company-overview, fred-data) and add this pattern; others can follow the same pattern.
- [x] 7.16 Run `npm test` — verify all tests pass, stale cache doesn't break existing cache behavior.

## 8. Error Recovery Level C: Provider Fallback

- [x] 8.1 Add `getGlobalQuote(symbol: string, apiKey: string): Promise<StockQuote>` to `src/providers/alpha-vantage.ts` — fetch AV `GLOBAL_QUOTE` endpoint. Map response to `StockQuote`: `price`, `change`, `changePercent`, `previousClose`, `volume`, `open`, `high`, `low` from API; `marketCap: 0`, `pe: null`, `week52High: 0`, `week52Low: 0`. Use `rateLimiter.acquire("alphavantage")` + `cache.set()`. Include stale fallback (Level B pattern).
- [x] 8.2 Add `getDailyHistory(symbol: string, apiKey: string, range: string): Promise<OHLCV[]>` to `src/providers/alpha-vantage.ts` — fetch AV `TIME_SERIES_DAILY` endpoint. Map `outputsize` from range (`compact` for ≤100d, `full` for more). Return `OHLCV[]`. Use `rateLimiter.acquire("alphavantage")` + `cache.set()`. Include stale fallback.
- [x] 8.3 Add fixture JSON for `GLOBAL_QUOTE` and `TIME_SERIES_DAILY` responses in `tests/fixtures/alpha-vantage/`.
- [x] 8.4 Write unit tests for `getGlobalQuote` — correct StockQuote mapping, zero-value fields (`marketCap`, `week52High/Low`), cache + rate limiter used.
- [x] 8.5 Write unit tests for `getDailyHistory` — correct OHLCV mapping, outputsize selection, cache + rate limiter used.
- [x] 8.6 Create `src/providers/with-fallback.ts` — export `withFallback<T>(entries: FallbackEntry<T>[]): Promise<ProviderResult<T>>`. Iterates entries, skips circuit-open providers, calls `wrapProvider` for each, returns first success or final `ProviderResultUnavailable` listing all attempted providers. Does NOT manage cache or stale fallback (that's inside each provider fn).
- [x] 8.7 Write unit tests for `withFallback` — primary succeeds (no fallback), primary fails + fallback succeeds, all fail, circuit-open skipped, no tracker present works.
- [x] 8.8 Update `src/tools/market/stock-quote.ts` — replace `wrapProvider` call with `withFallback([{ provider: "yahoo", fn: () => getQuote(symbol) }, { provider: "alphavantage", fn: () => getGlobalQuote(symbol, apiKey) }])`. Guard formatter: `week52High > 0 && week52Low > 0` check, display "N/A" for zero values. Include provenance in text response (which provider served data).
- [x] 8.9 Update `src/tools/market/stock-history.ts` — check `interval`: if daily+ (`1d`, `1wk`, `1mo`), use `withFallback([yahoo, alphavantage])`. If intraday (`1m`, `5m`, `15m`, `1h`), use `wrapProvider("yahoo", ...)` only. On intraday unavailable, text: `"⚠ Intraday history unavailable (Yahoo down). No alternate source for ${interval} data."`.
- [x] 8.10 Run `npm test` — verify all tests pass with fallback changes.
- [x] 8.11 Manual test via harness: `npx tsx tests/harness/manual-run.ts <dir> "analyze AAPL"` — verify analysis completes, error recovery paths are exercisable (simulate by temporarily misconfiguring a provider).
