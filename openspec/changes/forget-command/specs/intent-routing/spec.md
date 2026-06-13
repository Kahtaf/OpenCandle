## ADDED Requirements

### Requirement: Forget Command Scrubs Router Prior-Turn Context

OpenCandle SHALL provide a local `/forget <topic>` command that prevents future router invocations from receiving prior user or assistant turns matching the forgotten topic.

#### Scenario: Forgotten text is excluded from priorTurns

- **WHEN** a session contains a prior user turn mentioning "ASTS"
- **AND** the user runs `/forget ASTS`
- **THEN** subsequent router input SHALL NOT include matching prior-turn text in `priorTurns`

#### Scenario: Unrelated prior turns remain available

- **WHEN** the user runs `/forget ASTS`
- **THEN** prior turns that do not match ASTS SHALL remain eligible for router context

### Requirement: Forget Command Scrubs Matching Structured Memory

The `/forget` command SHALL also remove or mask matching OpenCandle structured memory rows so future prompt context and router context do not reintroduce the forgotten topic.

#### Scenario: Matching preference removed

- **WHEN** a saved preference or memory row matches the forgotten topic
- **THEN** future prompt context SHALL NOT include that row
