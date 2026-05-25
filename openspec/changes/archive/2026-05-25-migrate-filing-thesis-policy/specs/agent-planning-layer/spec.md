## ADDED Requirements

### Requirement: Filing Thesis Review Slice Migration

The planning layer SHALL support migrating the `filing_thesis_review` task family from legacy fallback prompt prose into a dedicated policy card and answer contract after parity passes. The slice SHALL preserve existing SEC routing and SHALL keep filing-source boundaries explicit.

#### Scenario: Filing prompt selects filing planning owners

- **WHEN** the user asks for recent SEC filings, 10-Q/10-K changes, or thesis-changing filing evidence
- **THEN** the resolved planning metadata selects task family `filing_thesis_review`
- **AND** it selects the `filing_thesis_review` policy card and answer contract
- **AND** it selects evidence plan `placeholder_filing_thesis_review`

#### Scenario: Filing policy preserves source separation

- **WHEN** filing thesis review is selected
- **THEN** the answer contract requires source coverage and data-gap disclosure
- **AND** the policy card requires separation between filing metadata, filing-section summaries or filing-body gaps, news or management commentary, and market data
- **AND** unsupported claims about Item changes, management changes, risk-factor changes, or thesis-changing events are prohibited unless supported by SEC filing output

#### Scenario: Filing migration has explicit activation states

- **WHEN** the slice is observe-only
- **THEN** the filing policy card is not injected and the legacy fallback SEC filing clause remains authoritative
- **WHEN** the slice is dual-run
- **THEN** the filing policy card may be injected while the legacy fallback clause remains present
- **WHEN** the slice is replacement-active or legacy-removed
- **THEN** only the matching fallback SEC filing clause may be removed for filing turns

#### Scenario: Filing migration does not promote deferred roadmap items

- **WHEN** filing thesis review is implemented
- **THEN** the change does not add providers, filing-body parsing, persisted workspaces, typed artifacts, semantic validators, active retry, role escalation, hard tool-bundle enforcement, or router-owned planning
