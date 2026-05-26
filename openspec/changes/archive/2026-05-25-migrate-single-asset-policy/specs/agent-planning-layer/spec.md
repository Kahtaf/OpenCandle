## ADDED Requirements

### Requirement: Single Asset Decision Slice Migration

The planning layer SHALL support migrating the `single_asset_decision` task family from legacy fallback freshness guidance into a dedicated policy card and answer contract after parity passes. The slice SHALL preserve clear recommendation behavior, quote/tool-output freshness, downside framing, and data-gap disclosure.

#### Scenario: Single-asset recommendation prompt selects single-asset owners

- **WHEN** the user asks whether to buy, wait, avoid, trim, add, or size a named single security
- **THEN** the resolved planning metadata selects task family `single_asset_decision`
- **AND** it selects policy card `single_asset_decision`
- **AND** it selects answer contract `single_asset_decision`
- **AND** it selects evidence plan `placeholder_single_asset_decision`

#### Scenario: Single-asset policy preserves recommendation answer shape

- **WHEN** single-asset decision is selected
- **THEN** the answer contract requires a clear commitment, risk downside, freshness disclosure, and data-gap disclosure
- **AND** the policy card requires quote or tool-output date disclosure when current data is used
- **AND** it preserves market-closed, delayed, or last-available quote caveats
- **AND** it prevents unavailable DCF or fundamentals from becoming the main thesis

#### Scenario: Single-asset replacement removes only the matching fallback clause

- **WHEN** the slice is replacement-active
- **THEN** only the legacy single-asset recommendation fallback clause may be omitted for single-asset turns
- **AND** unrelated fallback clauses for macro, retail, crypto, current-event, sentiment, filing, and concept turns remain governed by their own ledger rows
