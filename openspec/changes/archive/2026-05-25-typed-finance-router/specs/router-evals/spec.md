## ADDED Requirements

### Requirement: Typed Route Eval Coverage

Router evals SHALL include deterministic and live cases for each canonical route kind: `workflow_dispatch`, `agent_task`, `clarification`, and `pass_through`.

#### Scenario: Workflow dispatch eval passes

- **WHEN** an eval prompt clearly maps to a known workflow
- **THEN** the expected output asserts `routeKind: "workflow_dispatch"` and the workflow name

#### Scenario: Agent task eval passes

- **WHEN** an eval prompt is an in-scope finance analysis request without a matching workflow
- **THEN** the expected output asserts `routeKind: "agent_task"` and relevant entities

#### Scenario: Clarification eval passes

- **WHEN** an eval prompt is missing a required slot and no reliable memory fills it
- **THEN** the expected output asserts `routeKind: "clarification"` and the missing slot names

#### Scenario: Pass-through eval passes

- **WHEN** an eval prompt is outside OpenCandle's finance task surface
- **THEN** the expected output asserts `routeKind: "pass_through"`

### Requirement: Tool Scope Eval Reporting

Router and competitive eval reports SHALL include selected tool bundles, active tool names when available, and any attempted out-of-bundle tool calls.

#### Scenario: Eval reports selected bundles

- **WHEN** a harness run completes
- **THEN** the report includes the route-selected tool bundles for each prompt

#### Scenario: Eval reports unnecessary exposure

- **WHEN** a prompt expected to need only core market tools exposes options tools
- **THEN** the report marks unnecessary tool exposure for that prompt

### Requirement: Memory Use Eval Reporting

Router and competitive eval reports SHALL include memory categories retrieved, memory items used for slot filling, and filtered stale or low-trust memory counts when those data are available.

#### Scenario: Eval reports preference memory source

- **WHEN** a prompt relies on a saved investor preference
- **THEN** the report shows the preference memory category and slot source provenance

#### Scenario: Eval reports stale memory filtering

- **WHEN** candidate memory is filtered out by staleness or trust rules
- **THEN** the report includes a filtered-memory count or diagnostic

### Requirement: Clarification Quality Eval

Router evals SHALL measure whether clarification is requested only when required and whether the missing slots are specific enough for the main agent to ask a useful question.

#### Scenario: Missing symbol clarification is specific

- **WHEN** the user asks "build me an options setup" without a symbol
- **THEN** the eval expects `missing_required` to include `"symbol"` rather than a generic `"details"` field

#### Scenario: Clarification is not over-used

- **WHEN** prior context reliably supplies the missing symbol
- **THEN** the eval expects no clarification route for that symbol
