## ADDED Requirements

### Requirement: Current Event Explanation Slice Migration

The planning layer SHALL support migrating the `current_event_explanation` task family from legacy fallback prompt prose into a dedicated policy card, answer contract, and structured checks after parity passes. The slice SHALL reuse the existing `market_status` evidence plan ID and existing `tool_result` evidence records for quote, news, filing, or event evidence.

#### Scenario: Current-event prompt selects current-event planning owners

- **WHEN** the user asks why a ticker moved today, this morning, right now, after close, or on the most recent trading day
- **THEN** the resolved planning metadata selects task family `current_event_explanation`
- **AND** it selects the `current_event_explanation` policy card and answer contract
- **AND** it selects evidence plan `market_status`

#### Scenario: Current-event evidence requires temporal grounding

- **WHEN** current-event explanation is selected
- **THEN** the evidence plan requires market-status evidence before causal claims
- **AND** quote freshness and fetched news, filing, or event evidence are represented as existing `tool_result` evidence records with raw trace pointers when available
- **AND** it records a market-calendar capability gap when exact holiday/session data is unavailable

#### Scenario: Current-event contract requires source coverage

- **WHEN** current-event explanation is selected
- **THEN** the answer contract requires freshness disclosure, source coverage metadata, data-gap disclosure, and market-calendar capability-gap disclosure
- **AND** structured checks record failures observe-only until the parity gate permits active behavior

#### Scenario: Market-closed prompts avoid invented intraday catalysts

- **WHEN** the user asks why a security moved today and the market is closed, the day is a weekend, or exact market status is unavailable
- **THEN** the answer contract requires the final answer to distinguish the current date from the most recent trading day
- **AND** it must not invent an intraday move or causal catalyst without supporting evidence

#### Scenario: Current-event migration has explicit activation states

- **WHEN** the slice is observe-only
- **THEN** the current-event policy card is not injected and the legacy fallback clause remains authoritative
- **WHEN** the slice is dual-run
- **THEN** the current-event policy card may be injected while the legacy fallback clause remains present
- **WHEN** the slice is replacement-active or legacy-removed
- **THEN** only the matching today-move legacy fallback clause may be removed

#### Scenario: Legacy current-event prompt clause remains until parity passes

- **WHEN** the `market-closed-today-move` parity gate has not passed for the replacement path
- **THEN** the legacy fallback prompt clause remains active or equivalent legacy behavior remains authoritative
- **AND** current-event policy-card behavior is observe-only or dual-run

#### Scenario: Current-event migration does not promote deferred roadmap items

- **WHEN** current-event explanation is implemented
- **THEN** the change does not add new providers, meta-tools, evidence types, persisted workspaces, typed artifacts, semantic validators, active retry, role escalation, hard tool-bundle enforcement, or router-owned planning
