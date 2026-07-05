# Prediction-Market Probabilities Provider (Polymarket)

## Why

For event-driven prompts ("what are the odds the Fed cuts in September?", "recession odds this year?", "how would a rate cut hit my portfolio?"), market-implied event probabilities are a missing evidence class. Today those prompts get FRED history and prose; a prediction market supplies a live, falsifiable probability with volume behind it. TradingAgents' Polymarket integration is the one competitor data source with no OpenCandle equivalent.

This proposal is also the AGENTS.md **ask-first authorization** for adding a new provider (rate-limit config + fixture strategy are specified below).

## Provider decision (researched 2026-07-05; do not relitigate without new evidence)

- **v1 = Polymarket only, keyless.** Read access requires no auth on all three public surfaces; the docs actively promote agent/AI use; no ToS clause restricts AI ingestion, caching, or read redistribution; read data is not the geoblocked surface (trading is). CLOB read uptime ~99.94%/90d.
  - Discovery: Gamma API `https://gamma-api.polymarket.com` — `GET /public-search` (free-text), `GET /markets`, `GET /events` (paginated, tag/order filters). Market objects carry `outcomes`, `outcomePrices` (0–1 = implied probability), `volume`, `liquidity`, `endDate`, resolution description.
  - History (not in v1 scope): CLOB `GET /prices-history`.
- **Kalshi is explicitly deferred.** Its market-data REST API is keyless, and its regulated Fed/CPI/recession series (`KXFED`, `KXRECSSNBER`) would be the better macro source — but the "Kalshi Data" Terms of Service textually prohibit feeding the data to an AI/ML system and providing cached data sets without prior written consent, which collides with OpenCandle's core design (AI ingestion + `cache` infra). **Do not implement Kalshi until the maintainer has written permission from Kalshi or a legal read that clears it.** Record this in the provider docs so nobody "helpfully" adds it.
- Rejected: PredictIt (legacy, politics-only, precarious footing), Manifold (play-money), Adjacent News aggregator (inherits the Kalshi ToS exposure and adds a key requirement).

## What Changes

- New keyless provider `src/providers/polymarket.ts`: `searchPredictionMarkets(query, limit)` mapping Gamma search/market responses to a typed `PredictionMarketQuote[]`; cached and rate-limited through the standard `src/infra/` singletons (new cache domain, new limiter bucket).
- New types `src/types/prediction-markets.ts`.
- New tool `src/tools/macro/event-probabilities.ts` → `get_event_probabilities`: fetch + format only (no analysis, per tool conventions), with mandatory caveat lines (see spec).
- Tool exposure in the routed macro/general-finance tool bundles (no new workflow, no router changes beyond bundle membership).
- Fixtures under `tests/fixtures/polymarket/` for search and market payloads.
- Docs: data-sources page gains Polymarket with the standard first-mention link; provider readiness appears in `opencandle doctor`'s keyless/public-HTTP section.

## Non-Goals

- No Kalshi (deferred as above). No trading, positions, or order data — read-only probabilities.
- No probability history tool in v1 (`prices-history` is a noted follow-up).
- No new workflow or routing intent; existing macro/event routing picks the tool up from its bundle.
- No probability aggregation/averaging across markets — each market is reported as itself with its resolution criteria.

## Rate-limit and cache decisions

- Limiter bucket `polymarket`: 5 requests/second, no burst above 10 (Gamma's soft per-IP limit is ~30 rps; stay far under).
- Cache domain `PREDICTION_MARKETS`: TTL 5 minutes, stale limit 1 hour (matches SENTIMENT-class volatility).
