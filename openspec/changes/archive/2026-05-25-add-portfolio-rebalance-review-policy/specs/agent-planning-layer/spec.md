## ADDED Requirements

### Requirement: Portfolio Rebalance Review Policy

The planning layer SHALL support a rebalance-specific policy card under the existing `portfolio_review` task family for prompts that ask how to rebalance, diversify, reduce concentration, or correct allocation drift in an existing portfolio.

#### Scenario: Existing allocation rebalance selects review subtype

- **WHEN** the user provides or references an existing portfolio allocation and asks how to rebalance, diversify, reduce concentration, set target bands, or handle drift
- **THEN** planning selects task family `portfolio_review`
- **AND** it selects a rebalance review policy card
- **AND** it keeps answer contract `portfolio_review`
- **AND** it does not switch to `portfolio_build` unless the user explicitly asks to construct a new portfolio

#### Scenario: Rebalance policy preserves capability honesty

- **WHEN** the rebalance policy card is injected
- **THEN** it requires disclosure of unknown exact holdings, tax lots, account type, cost basis, risk tolerance, and exact ETF overlap when those facts are unavailable
- **AND** it does not imply exact tax optimization or holdings-overlap capability without supporting tools

#### Scenario: Rebalance answer includes actionable structural obligations

- **WHEN** the rebalance policy card is selected
- **THEN** the answer should cover concentration, hidden overlap, geography, sector and factor exposure, fixed-income role, time horizon, risk tolerance uncertainty, staged implementation, tax-aware execution caveats, target ranges or bands, and monitoring triggers
- **AND** it should end with a clear adjustment or monitoring trigger tied to the user's stated or assumed horizon
