## ADDED Requirements

### Requirement: Route Tool Bundle Policy

The system SHALL define named tool bundles and SHALL select allowed bundles from the resolved route kind, workflow, and manifest policy for each user turn.

#### Scenario: Options clarification keeps ask_user available

- **WHEN** the user asks "build me an options setup" without a symbol
- **THEN** the selected tool bundle includes `ask_user`
- **AND** options market-data tools are not invoked until the missing symbol is collected

#### Scenario: Macro question receives macro tools

- **WHEN** the user asks "what does CPI imply for rates?"
- **THEN** the selected tool bundles include macro data tools
- **AND** unrelated options-chain tools are not active unless another selected bundle requires them

#### Scenario: Simple quote receives core market tools

- **WHEN** the user asks "AAPL quote"
- **THEN** the selected tool bundles include quote or symbol lookup tools needed for the request
- **AND** unrelated provider tools are not active

#### Scenario: Pass-through receives no finance bundle

- **WHEN** the user asks an out-of-scope non-finance request
- **THEN** no finance tool bundle is selected

### Requirement: Pi Active Tools Are Applied Per Turn

When Pi active-tool control is available, the system SHALL snapshot the current active tools, apply the route-selected active tool set for the turn, and restore the previous active tool set after the agent or workflow finishes.

#### Scenario: Active tools are narrowed for agent task

- **WHEN** `routeKind` is `"agent_task"` and selected bundles resolve to a subset of registered tools
- **THEN** `pi.setActiveTools(...)` is called with that subset before the main agent runs

#### Scenario: Active tools are restored

- **WHEN** a routed turn completes or errors
- **THEN** the previously active Pi tool set is restored

#### Scenario: Missing Pi active-tool support degrades visibly

- **WHEN** the runtime cannot apply active tools
- **THEN** the resolved turn context records a diagnostic and the eval report marks tool-scope enforcement as unavailable

### Requirement: Tool Scope Is Observable Before Enforcement

The system SHALL support an observe/report mode for route tool bundles that records selected bundles, active tool names, and attempted out-of-bundle tool calls without blocking execution.

#### Scenario: Out-of-bundle call is reported

- **WHEN** observe/report mode is enabled and the agent calls a tool outside the selected bundle
- **THEN** the trace records the attempted tool name and the bundle that excluded it

#### Scenario: Enforcement can be enabled after eval coverage

- **WHEN** enforcement mode is enabled and the agent attempts an out-of-bundle tool call
- **THEN** the call is blocked or rejected with a diagnostic visible in the trace
