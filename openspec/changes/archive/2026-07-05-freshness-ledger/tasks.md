# Tasks

Follow AGENTS.md: TDD (failing test first), `.js` relative imports, no live API calls in unit tests, CHANGELOG entry, `graphify update .` after code changes. Prompt templates (`src/prompts/`, workflow prompt builders, analyst prompts, policy cards) are a hard no-touch gate for this change; tool result text is in scope.

## 1. Shared market calendar

- [x] 1.1 Grep for external importers of `classifyMarketStatus` / `lastTradingDay` / `isWeekendOrKnownHoliday` before moving; note them in the PR.
- [x] 1.2 Create `src/infra/market-calendar.ts`; move the functions, `KNOWN_US_MARKET_HOLIDAYS`, and the private helpers `dateFromKey`/`addDays`/`dateKey` from `src/runtime/planning-evidence.ts` (behavior verbatim; declare `classifyMarketStatus`'s return as the explicit six-value union — it is `: string` today); add the `classifyMarketStatusAt(now: Date)` wrapper per design §1; export `MarketSession`. `planning-evidence.ts` imports from the new module (keep re-exports if 1.1 found importers).
- [x] 1.3 Existing planning-evidence unit tests pass unmodified (behavior-preservation gate).

## 2. Freshness module (TDD)

- [x] 2.1 Failing unit tests for `buildFreshnessStamp`: Friday-quote-on-Saturday (not session-stale, `closed_weekend`), Thursday-quote-on-Saturday (session-stale), stale-cache fallback, epoch-seconds vs epoch-ms vs ISO vs `Date` `asOf` inputs, date-only Alpha Vantage input, crypto 15-minute rule, and `classifyMarketStatusAt` post-16:00 yielding `closed_after_hours` (never `after_close` — unreachable with empty temporal references, by design). Inject `now`.
- [x] 2.2 Failing snapshot tests for `formatAsOfLine` covering the four template shapes in design.md §2.
- [x] 2.3 Implement `src/infra/freshness.ts` to green.

## 3. Provider asOf mapping (TDD, fixture-based)

- [x] 3.1 Add `asOf?: string` to `StockQuote` and `CryptoPrice` in `src/types/market.ts`.
- [x] 3.2 Yahoo: add `"regularMarketTime": 1711137600` (Friday 2024-03-22 16:00 ET) to `tests/fixtures/yahoo/weekend-stale-quote.json`'s `meta`; failing test asserting mapped `asOf`; implement in `src/providers/yahoo-finance.ts` quote mapping.
- [x] 3.2b Options: add `asOf?: string` to `OptionsChain` in `src/types/options.ts`; map `result.quote.regularMarketTime` in `parseOptionsResponse` and the yahoo-finance2 fallback's quote time (may be a `Date`); fixture-based tests for both paths.
- [x] 3.3 Alpha Vantage: failing test for `"07. latest trading day"` → date-only `asOf`; implement.
- [x] 3.4 CoinGecko: add `market_data.last_updated` to the response type, failing test, implement.
- [x] 3.5 Confirm TradingView mapping is untouched (no fabricated `asOf`).

## 4. Tool integration (TDD)

- [x] 4.1 `stock-quote.ts`: failing tests for (a) live quote as-of final line, (b) weekend-stale disclosure wording, (c) removal of the old stale prefix; implement (build stamp, append line, set `details.freshness`).
- [x] 4.2 Crypto price tool: failing test for stale-cache disclosure; implement.
- [x] 4.3 Option-chain tool: stamp from `OptionsChain.asOf` (task 3.2b); keep the existing closed-market caveat text unchanged (the as-of line is additive); test.
- [x] 4.4 `screen_stocks`: stamp with `dataDelayMs: 15 * 60_000` and no `asOf`; text-only disclosure (its `details` stays the bare rows array — no `details.freshness`); REPLACE its two hand-rolled staleness lines (~:153-154, "⚠ Using cached TradingView screen…" and "Data freshness: … retrieved at …") with the shared line; keep the provider-level `dataCaveat`; test.

## 5. Evidence propagation (TDD)

- [x] 5.1 Failing unit test: mocked tool event whose result details carry `freshness` → evidence record includes stamp, `provenance.timestamp === providerDataAt`. Cover both `toolEvidenceRecord` (session-coordinator path) and `captureToolEvidence` (prompt-step path).
- [x] 5.2 Implement propagation in both paths.

## 6. Eval promotion

- [x] 6.1 Un-skip the E3 stale-weekend-quote assertion in `tests/unit/evals/provider-outage-deterministic.test.ts` and make it a plain gating test (`npm test`). Update its expected-date literal from `2024-03-23` to `2024-03-22` per design §6 (the fixture previously had no market date; asserting the provider's actual Friday date is a strengthening — record this justification in the test comment). Keep the assertion independent of run time (match the session-stale wording + date, not the current-session parenthetical). Do not otherwise weaken assertions. Leave the separate turn-gap E3 finding as-is.
- [x] 6.2 Update the FINDING comment to record the promotion and this change id.

## 7. Verification

- [x] 7.1 `npm test`, `npx tsc --noEmit`, `npx biome ci .` green.
- [x] 7.2 Live runtime evidence: one harness run (`npx tsx tests/harness/cli.ts run --prompt "quote for AAPL" --ipc <dir>`) on a weekend or after hours; trace shows the as-of line in the tool result and `details.freshness`. Keep artifacts machine-local per the pr-evidence policy; paste the load-bearing excerpt into the PR.
- [x] 7.3 CHANGELOG `[Unreleased]` entries (freshness ledger; E3 promotion).
- [x] 7.4 `graphify update .`; `npx openspec validate freshness-ledger --strict`.
