## ADDED Requirements

### Requirement: Asset Compare Slice Migration

The planning layer SHALL support migrating the `asset_compare` task family from placeholder planning metadata into a dedicated policy card and answer contract after parity passes. The slice SHALL preserve existing compare workflow dispatch and SHALL keep exact ETF holdings overlap as an explicit capability gap.

#### Scenario: ETF comparison prompt selects asset-compare planning owners

- **WHEN** the user asks to compare ETFs, dividend-vs-growth ETF choices, holdings overlap, diversification overlap, or similar asset comparison tradeoffs
- **THEN** the resolved planning metadata selects task family `asset_compare`
- **AND** it selects policy card `asset_compare`
- **AND** it selects answer contract `asset_compare_tradeoff`
- **AND** it selects evidence plan `placeholder_asset_compare`

#### Scenario: Asset-compare policy preserves comparison answer shape

- **WHEN** asset comparison is selected
- **THEN** the answer contract requires comparison tradeoffs and data-gap disclosure
- **AND** the policy card requires comparing requested assets before portfolio construction
- **AND** it requires exact holdings overlap by weight to be disclosed as unavailable unless supported by a dedicated holdings provider
- **AND** it allows useful diversification, dividend/income, growth, tax, and horizon tradeoffs from available quote or fund context

#### Scenario: Asset-compare migration does not rewrite compare workflow dispatch

- **WHEN** the slice is replacement-active
- **THEN** existing `compare_assets` workflow dispatch and tool orchestration remain active
- **AND** no compare workflow prompt clause is removed by this slice
- **AND** rollback can restore observe-only or dual-run asset policy behavior without changing workflow routing
