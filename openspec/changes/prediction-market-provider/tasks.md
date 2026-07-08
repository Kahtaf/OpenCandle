# Tasks

Follow AGENTS.md (TDD, fixtures for new API responses, cache/rateLimiter for all external calls, no live calls in unit tests, CHANGELOG, `graphify update .`). Tools fetch + format; never analyze.

## 1. Fixtures first

- [x] 1.1 Capture real Gamma responses once (manually, outside tests) for: `/public-search?q=fed rate cut`, a `/markets` page filtered by a tag, and one market object with `outcomes`/`outcomePrices`/resolution text. Commit sanitized copies under `tests/fixtures/polymarket/` (search.json, markets.json, market-detail.json). Include one market with volume < $10,000 and one with missing resolution text.

## 2. Types + provider (TDD)

- [x] 2.1 `src/types/prediction-markets.ts`: `PredictionMarketQuote` per spec.
- [x] 2.2 Failing unit tests (mock `globalThis.fetch` with fixtures): probability mapping from `outcomePrices`, resolution text + URL population, volume/liquidity/close-date mapping, cache hit on second call, rate-limiter bucket used, stale-cache fallback on fetch failure, unavailable result when no cache.
- [x] 2.3 Implement `src/providers/polymarket.ts` (`searchPredictionMarkets(query, limit=8)`); add the `PREDICTION_MARKETS` cache domain (TTL 5m / stale 1h) to `src/infra/cache.ts` and the `polymarket` bucket (5 req/s) to the rate-limiter config.

## 3. Tool (TDD)

- [x] 3.1 Failing unit tests: caveat lines always present; low-liquidity flag under $10k; missing-resolution-text note; empty-result honesty; per-share formatting of probabilities as percentages; `details` carries the typed quotes.
- [x] 3.2 Implement `src/tools/macro/event-probabilities.ts` (`get_event_probabilities`, Typebox params, named `AgentTool` export per conventions); register in `src/tools/index.ts`.
- [x] 3.3 Add the tool to the macro and general-finance tool bundles where macro data tools are enumerated (follow how existing FRED tools are bundled); unit test bundle membership.

## 4. Docs + doctor

- [x] 4.1 Data-sources docs page: add Polymarket (keyless) with first-mention link; add the Kalshi-deferred note with the ToS reason.
- [x] 4.2 `opencandle doctor`: Polymarket appears in keyless/public-HTTP provider readiness (follow the TradingView pattern).

## 5. Verification

- [x] 5.1 `npm test`, `npx tsc --noEmit`, `npx biome ci .` green.
- [x] 5.2 Live evidence: one `test:e2e:providers`-style live call of `searchPredictionMarkets` and one harness run with a Fed-odds prompt showing the tool selected and its caveats in the trace; excerpts in the PR.
- [x] 5.3 CHANGELOG `[Unreleased]` entry.
- [x] 5.4 `graphify update .`; `npx openspec validate prediction-market-provider --strict`.
