## MODIFIED Requirements

### Requirement: Memory entries have staleness rules per category
Each memory category SHALL define staleness thresholds. The retrieval system SHALL exclude entries that exceed their category's staleness threshold.

Dated historical prices from the analysis reflection ledger are distinct from remembered current prices: a reflection's `price_at_analysis` MAY appear in prompt context only inside a reflection data block, always paired with its analysis date and never presented as a current price. Undated or current-price memory remains excluded — current prices must always be fetched live.

#### Scenario: Investor profile persists for months
- **WHEN** a risk tolerance was recorded 2 months ago
- **THEN** it is still included in retrieval (investor profile staleness threshold is long)

#### Scenario: Market thesis decays within days
- **WHEN** a stored market thesis ("tech sector is overvalued") was recorded 2 weeks ago
- **THEN** it is excluded from retrieval or flagged as stale

#### Scenario: Specific prices are never trusted from memory
- **WHEN** memory contains a stored price ("AAPL was $185" from 3 days ago)
- **THEN** it is never injected into prompt context — prices must always be fetched live

#### Scenario: Reflection-ledger prices are dated history, not current prices
- **WHEN** a reflection data block for NVDA carries `price_at_analysis: 180.20` from 2026-06-01
- **THEN** it renders only inside the reflection block as "price then: $180.20 (2026-06-01)"
- **AND** the turn's current NVDA price still comes from a live fetch
