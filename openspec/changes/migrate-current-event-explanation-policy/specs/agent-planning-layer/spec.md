## ADDED Requirements

### Requirement: Current Event Explanation Slice Migration

The planning layer SHALL support migrating the `current_event_explanation` task family from legacy fallback prompt prose into a dedicated policy card, evidence plan, answer contract, and structured checks after parity passes.

#### Scenario: Current-event prompt selects current-event planning owners

- **WHEN** the user asks why a ticker moved today, this morning, right now, after close, or on the most recent trading day
- **THEN** the resolved planning metadata selects task family `current_event_explanation`
- **AND** it selects the `current_event_explanation` policy card and answer contract

#### Scenario: Current-event evidence requires temporal grounding

- **WHEN** current-event explanation is selected
- **THEN** the evidence plan requires market-status evidence before causal claims
- **AND** it records quote freshness and fetched news, filing, or event evidence when available
- **AND** it records a market-calendar capability gap when exact holiday/session data is unavailable

#### Scenario: Market-closed prompts avoid invented intraday catalysts

- **WHEN** the user asks why a security moved today and the market is closed, the day is a weekend, or exact market status is unavailable
- **THEN** the answer contract requires the final answer to distinguish the current date from the most recent trading day
- **AND** it must not invent an intraday move or causal catalyst without supporting evidence

#### Scenario: Legacy current-event prompt clause remains until parity passes

- **WHEN** the `market-closed-today-move` parity gate has not passed for the replacement path
- **THEN** the legacy fallback prompt clause remains active or equivalent legacy behavior remains authoritative
- **AND** current-event policy-card behavior is observe-only or dual-run
