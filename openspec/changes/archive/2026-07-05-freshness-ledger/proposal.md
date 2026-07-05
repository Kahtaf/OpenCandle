# Freshness Ledger (Answer-Receipts Phase 2)

## Why

Every provider currently stamps results with `timestamp: Date.now()` — the fetch wall-clock — and discards the provider's own market/as-of time at the mapping boundary (`src/providers/yahoo-finance.ts:119`, `src/providers/alpha-vantage.ts:236`, `src/providers/coingecko.ts:54`). Staleness is every tool's individual problem: `get_stock_quote` has a one-off stale prefix, `crypto-price` discloses nothing, the alert runner has its own richer `AlertQuoteObservation`, and the daily report formats its own "as of" line. The stale-data failure class recurs precisely because freshness has no single owner.

The E3 provider-outage eval recorded the acceptance criterion as a known-fail: `tests/unit/evals/provider-outage-deterministic.test.ts:113` — "current quote tooling does not expose Yahoo's weekend-dated quote timestamp in the tool text or details… Keep this known-fail skipped until the runtime exposes provider quote as-of timestamps." This change is the production fix that promotes that case to gating, and it is the prerequisite for answer receipts (`answer-receipts` change): a receipt without an as-of time cannot express freshness.

## What Changes

- Extract the existing market-calendar logic from `src/runtime/planning-evidence.ts` into a shared `src/infra/market-calendar.ts` module (no behavior change).
- Add a `FreshnessStamp` type and a single `buildFreshnessStamp()` + `formatAsOfLine()` implementation in a new `src/infra/freshness.ts`, generalizing the alert runner's proven `AlertQuoteObservation` shape.
- Preserve provider market time at each provider's mapping boundary: `StockQuote.asOf` and `CryptoPrice.asOf` (new optional fields), mapped from Yahoo `meta.regularMarketTime`, Alpha Vantage `"07. latest trading day"`, and CoinGecko `market_data.last_updated`. FRED already preserves `lastUpdated`. TradingView has no market time and instead carries its known 15-minute delay.
- Quote-family tools (`get_stock_quote`, crypto price, option chain, `screen_stocks`) attach the stamp to `details.freshness` and append the deterministic `formatAsOfLine()` output to their text — the single user-visible as-of line.
- Stale disclosure rule: data whose `asOf` predates the last completed trading session is presented as "last available … as of <date>", never as a live price.
- Tool evidence records (`toolEvidenceRecord` / `captureToolEvidence`) propagate `freshness` so downstream validation and future receipts inherit as-of metadata.
- Promote the E3 stale-weekend-quote known-fail assertion to a gating deterministic test.

## Non-Goals

- No live exchange-calendar provider; the existing deterministic weekday/known-holiday classifier is reused as-is (its `market_calendar` capability-gap label stays).
- No change to alert-runner behavior (`AlertQuoteObservation` keeps working unchanged; converging it on `FreshnessStamp` is a noted follow-up, not part of this change).
- No prompt template edits (`src/prompts/`, workflow prompt builders, policy cards). Tool result text is not a prompt template and is in scope.
- No answer binding or enforcement — that is the `answer-receipts` change.
- No freshness stamping for fundamentals, sentiment, or web-search tools in v1 (macro tools reuse FRED's existing `lastUpdated` only where trivially available; anything more is follow-up).

## Relationship to Other Changes

- Prerequisite for `answer-receipts` (phase 3): receipts consume `FreshnessStamp` from evidence records.
- Unblocks the E3 promotion in `tests/unit/evals/provider-outage-deterministic.test.ts` (the `// PROMOTE`-style known-fail path).
- Independent of `cashtag-entity-layer`, `eval-entrypoint-consolidation`, and the GUI changes; file-disjoint from all of them.
