# structured-provenance Specification

## Purpose
Defines provenance metadata for slot values, fetched data, computed metrics, and unavailable evidence.
## Requirements
### Requirement: Provenance type covers all data sources
The runtime SHALL define a `Provenance` type that covers all value sources: `user`, `preference`, `default`, `fetched`, `computed`, `unavailable`, and `stale_cache`. Each provenance record SHALL include the source type and MAY include `timestamp`, `provider`, `confidence`, and `reason`.

#### Scenario: Fetched data carries provider and timestamp
- **WHEN** a tool fetches a stock quote from Yahoo Finance
- **THEN** the resulting data carries provenance `{ source: "fetched", provider: "yahoo-finance", timestamp: "2026-04-02T14:30:00Z" }`

#### Scenario: Unavailable data carries reason
- **WHEN** a provider fails to return fundamentals data
- **THEN** the resulting value carries provenance `{ source: "unavailable", reason: "provider_error", provider: "alpha-vantage" }`

### Requirement: Slot provenance complements runtime-wide provenance
Slot resolution SHALL record a `SlotSource` for each resolved slot: `"user" | "preference" | "default" | "prior_context" | "memory"`. The slot sources `user`, `preference`, and `default` map directly onto the equivalent `Provenance` sources. `prior_context` (value carried from prior conversation turns) and `memory` (value from retrieved non-profile memory) are slot-resolution-only sources surfaced in workflow prompt assumption blocks; they do not appear in the runtime-wide `Provenance` source set.

#### Scenario: Portfolio slot resolution records slot sources
- **WHEN** `resolvePortfolioSlots` resolves a risk profile from saved preferences
- **THEN** the resolution records `sources.riskProfile = "preference"`

#### Scenario: Slot resolved from prior conversation context
- **WHEN** the router resolves a symbol slot from a prior conversation turn
- **THEN** the resolution records the slot source as `"prior_context"` and the workflow prompt surfaces the value under prior-context assumptions

### Requirement: Evidence records carry provenance
Every data point flowing through the workflow pipeline — fetched metrics, computed values, memory recalls — SHALL be wrapped in an `EvidenceRecord` that includes the value, its provenance, and a human-readable label.

#### Scenario: Evidence record for a fetched P/E ratio
- **WHEN** the valuation analyst step fetches a P/E ratio of 25.3 from company overview
- **THEN** the evidence record contains `{ label: "P/E Ratio", value: 25.3, provenance: { source: "fetched", provider: "alpha-vantage", timestamp: "..." } }`

#### Scenario: Evidence record for an unavailable metric
- **WHEN** free cash flow data is not available from the provider
- **THEN** the evidence record contains `{ label: "Free Cash Flow", value: null, provenance: { source: "unavailable", reason: "not_covered", provider: "alpha-vantage" } }`

### Requirement: Synthesis consumes provenance for disclosure
The synthesis step SHALL receive evidence records with provenance and SHALL use provenance metadata to generate the assumptions/disclosure block. Values with `source: "default"` SHALL be explicitly labeled. Values with `source: "unavailable"` SHALL be labeled as missing data.

#### Scenario: Default values are disclosed in synthesis output
- **WHEN** synthesis receives a risk profile with `source: "default"`
- **THEN** the output assumptions block labels it as "default: moderate"

#### Scenario: Unavailable data is disclosed in synthesis output
- **WHEN** synthesis receives an evidence record with `source: "unavailable"`
- **THEN** the output explicitly states the metric is unavailable rather than omitting it silently
