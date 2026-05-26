## ADDED Requirements

### Requirement: Retail Finance Tradeoff Slice Migration

The planning layer SHALL support migrating the `retail_finance_tradeoff` task family from legacy fallback prompt prose into a dedicated policy card and answer contract after parity passes. The slice SHALL preserve no-tool durable-knowledge retail behavior and SHALL keep capability gaps explicit.

#### Scenario: Retail prompt selects retail planning owners

- **WHEN** the user asks about brokerage/account selection, cash parking products, mortgage-vs-investing, or similar durable retail finance tradeoffs
- **THEN** the resolved planning metadata selects task family `retail_finance_tradeoff`
- **AND** it selects the `retail_finance_tradeoff` policy card
- **AND** it selects answer contract `retail_tradeoff_framework`
- **AND** it selects evidence plan `placeholder_retail_finance_tradeoff`

#### Scenario: Retail policy preserves durable tradeoff answer shape

- **WHEN** retail finance tradeoff is selected
- **THEN** the answer contract requires comparison tradeoffs and data-gap disclosure
- **AND** the policy card prevents punting just because no dedicated live provider exists
- **AND** it requires provider-site facts or current yield facts to be labeled for verification instead of fabricated
- **AND** it covers the relevant durable dimensions for brokerage choice, cash parking, or mortgage-vs-investing prompts

#### Scenario: Retail migration has explicit activation states

- **WHEN** the slice is observe-only
- **THEN** the retail policy card is not injected and the legacy fallback retail clause remains authoritative
- **WHEN** the slice is dual-run
- **THEN** the retail policy card may be injected while the legacy fallback clause remains present
- **WHEN** the slice is replacement-active or legacy-removed
- **THEN** only the matching fallback retail tradeoff clause may be removed for retail turns

#### Scenario: Retail migration does not promote deferred roadmap items

- **WHEN** retail finance tradeoff is implemented
- **THEN** the change does not add providers, persisted workspaces, typed artifacts, semantic validators, active retry, role escalation, hard tool-bundle enforcement, crypto-specific migration, or router-owned planning
