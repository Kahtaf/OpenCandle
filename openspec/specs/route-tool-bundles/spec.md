# route-tool-bundles Specification

## Purpose
Name the finance tool bundles OpenCandle recognises and define how each turn's
resolved route selects them. Bundle selection is advisory: it shapes the
system prompt the main agent sees. It does not gate tool execution.

## Requirements
### Requirement: Route Tool Bundle Policy

The system SHALL define named tool bundles and SHALL select allowed bundles from the resolved route kind, workflow, and manifest policy for each user turn.

#### Scenario: Options clarification keeps ask_user available

- **WHEN** the user asks "build me an options setup" without a symbol
- **THEN** the selected tool bundle includes `ask_user`

#### Scenario: Macro question receives macro tools

- **WHEN** the user asks "what does CPI imply for rates?"
- **THEN** the selected tool bundles include macro data tools

#### Scenario: Simple quote receives core market tools

- **WHEN** the user asks "AAPL quote"
- **THEN** the selected tool bundles include quote or symbol lookup tools needed for the request

#### Scenario: Pass-through receives no finance bundle

- **WHEN** the user asks an out-of-scope non-finance request
- **THEN** no finance tool bundle is selected

### Requirement: Selected Bundles Shape the Prompt, Not Tool Execution

Selected bundles SHALL be recorded on the resolved turn context and rendered into the assembled system prompt. The system SHALL NOT narrow Pi's active tool set, block out-of-bundle tool calls, or otherwise prevent the main agent from calling any registered tool.

#### Scenario: A turn with no finance bundle says so in the prompt

- **WHEN** the resolved turn context resolves to an empty active tool set
- **THEN** the assembled prompt tells the agent no finance tools are needed for the turn instead of listing the tool catalog

#### Scenario: An out-of-bundle tool call still runs

- **WHEN** the agent calls a tool that no selected bundle contains
- **THEN** the call executes normally and nothing is blocked
