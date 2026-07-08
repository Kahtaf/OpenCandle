## ADDED Requirements

### Requirement: Keyless Polymarket provider through standard infra

The system SHALL provide a keyless Polymarket provider (`src/providers/polymarket.ts`) that searches prediction markets by free text via the Gamma API and maps results to a typed `PredictionMarketQuote` carrying: `source: "polymarket"`, market id, title/question, outcome label, `probability` normalized to 0–1 (from `outcomePrices`), USD volume and liquidity when present, close/end date, the market's resolution-criteria text, a canonical market URL, and an as-of timestamp. All requests SHALL go through the shared `cache` (domain `PREDICTION_MARKETS`, TTL 5 minutes, stale limit 1 hour) and `rateLimiter` (bucket `polymarket`, 5 req/s). Provider failures follow the standard stale-cache-then-unavailable degradation path; no fabricated probabilities.

#### Scenario: Search maps probabilities from outcome prices

- **WHEN** `searchPredictionMarkets("fed rate cut september")` runs against the search fixture
- **THEN** each returned quote's `probability` equals the corresponding fixture `outcomePrices` value as a 0–1 number
- **AND** the resolution-criteria text and market URL are populated

#### Scenario: Rate limit and cache are exercised

- **WHEN** two identical searches run within the TTL window
- **THEN** the second is served from cache without a network request

### Requirement: Event-probabilities tool with mandatory caveats

The system SHALL provide a `get_event_probabilities` tool (params: `query` string, optional `limit`) that fetches and formats prediction-market quotes without analyzing them. Its text output SHALL include, for every result: the probability as a percentage, volume/liquidity, close date, and the market's exact resolution-criteria text (or an explicit note that criteria text was unavailable). The output SHALL always include these caveat lines: (1) these are market-implied probabilities from trader positioning, not calibrated forecasts; (2) thin markets can show noisy or stale prices — results with volume under $10,000 are explicitly flagged low-liquidity; (3) Polymarket is a crypto-settled venue with platform and settlement risks distinct from regulated exchanges. Markets whose resolution wording does not plainly match the user's question MUST NOT be silently substituted — the tool reports what each market actually resolves on.

#### Scenario: Fed-cut query returns disclosed probabilities

- **WHEN** the tool runs with `query: "fed rate cut september"` against fixtures
- **THEN** the text shows each market's probability, volume, close date, and resolution criteria
- **AND** all three caveat lines are present

#### Scenario: Thin market is flagged

- **WHEN** a returned market has volume under $10,000
- **THEN** its row carries an explicit low-liquidity flag

#### Scenario: No matching market is an honest empty result

- **WHEN** the search returns no markets for the query
- **THEN** the tool reports that no prediction market covers the question, without substituting a loosely related market as if it answered it

### Requirement: Kalshi integration is blocked pending written ToS clearance

The provider documentation SHALL record that Kalshi's Data Terms prohibit AI-system ingestion and cached data sets without written consent, and that a Kalshi provider MUST NOT be added until the maintainer records written clearance. Any future Kalshi change references this requirement.

#### Scenario: Docs carry the Kalshi block

- **WHEN** the data-sources documentation is inspected after this change
- **THEN** it lists Polymarket as integrated and Kalshi as deferred with the ToS reason
