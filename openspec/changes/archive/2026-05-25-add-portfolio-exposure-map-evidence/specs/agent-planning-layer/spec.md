## ADDED Requirements

### Requirement: Portfolio Exposure Map Evidence

The planning layer SHALL expose deterministic portfolio exposure-map evidence for portfolio rebalance review prompts without inventing exact provider-backed holdings.

#### Scenario: User allocation percentages become structured exposure evidence

- **WHEN** a portfolio rebalance review prompt includes allocation percentages
- **THEN** planning evidence includes a `portfolio_exposure_map` record with normalized user-stated sleeves and percentages
- **AND** the record distinguishes direct user-stated exposure from inferred overlap caveats

#### Scenario: Broad-index overlap remains honest

- **WHEN** the prompt combines broad-index exposure with sector or concentrated sleeves
- **THEN** the evidence record includes a broad-index overlap caveat
- **AND** exact holdings overlap remains represented by the `etf_holdings_overlap` capability gap

#### Scenario: Exposure evidence is trace-only in V1

- **WHEN** exposure-map evidence is emitted
- **THEN** it appears in planning telemetry and eval traces
- **AND** it does not require live ETF holdings providers, persisted portfolio storage, or rendered artifacts
