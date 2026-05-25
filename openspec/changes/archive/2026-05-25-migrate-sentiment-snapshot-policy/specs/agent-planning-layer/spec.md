## ADDED Requirements

### Requirement: Sentiment Snapshot Slice Migration

The planning layer SHALL support migrating the `sentiment_snapshot` task family from legacy fallback prompt prose into a dedicated policy card and answer contract after parity passes. The slice SHALL preserve existing sentiment routing and SHALL keep source/sample-depth limitations explicit.

#### Scenario: Sentiment prompt selects sentiment planning owners

- **WHEN** the user asks for ticker-specific retail mood, cross-source sentiment, or sentiment versus price action
- **THEN** the resolved planning metadata selects task family `sentiment_snapshot`
- **AND** it selects the `sentiment_snapshot` policy card and answer contract
- **AND** it selects evidence plan `placeholder_sentiment_snapshot`
- **AND** it keeps the `sentiment_sample_depth` capability gap when source coverage is incomplete

#### Scenario: Sentiment policy preserves source-coverage answer shape

- **WHEN** sentiment snapshot is selected
- **THEN** the answer contract requires source coverage and data-gap disclosure
- **AND** the policy card requires direction and strength of the sentiment signal, score scale when available, missing sources, why missing sources matter, source-coverage risk, low sample caveats, and confidence downgrade
- **AND** ticker-specific sentiment answers state whether sentiment diverges from price action

#### Scenario: Sentiment migration has explicit activation states

- **WHEN** the slice is observe-only
- **THEN** the sentiment policy card is not injected and the legacy fallback sentiment-source clause remains authoritative
- **WHEN** the slice is dual-run
- **THEN** the sentiment policy card may be injected while the legacy fallback clause remains present
- **WHEN** the slice is replacement-active or legacy-removed
- **THEN** only the matching fallback sentiment-source clause may be removed for sentiment turns

#### Scenario: Sentiment migration does not promote deferred roadmap items

- **WHEN** sentiment snapshot is implemented
- **THEN** the change does not add providers, persisted workspaces, typed artifacts, semantic validators, active retry, role escalation, hard tool-bundle enforcement, or router-owned planning
