## ADDED Requirements

### Requirement: Workflow steps capture scoped tool evidence
Comprehensive-analysis workflow steps SHALL capture tool executions that occur during the step as structured evidence records without storing full tool results.

#### Scenario: Tool evidence is scoped to the active step
- **WHEN** two workflow steps each execute tools
- **THEN** each step output includes only the evidence records for tools executed during that step
- **AND** prior evidence passed to the next step includes the earlier step's captured evidence

#### Scenario: Tool evidence stores a readable digest
- **WHEN** a tool execution completes during a workflow step
- **THEN** the evidence value includes the tool name, serialized arguments truncated to 500 characters, started/completed timestamps, and a result digest with a 500-character preview plus total serialized length

### Requirement: Analyst and debate steps emit structured parse entries
Comprehensive-analysis analyst and debate steps SHALL parse their final assistant text with the existing structured analyst/debate contracts, store the parsed structure on the step output when valid, and append an `opencandle-analyst-step` custom entry.

#### Scenario: Analyst parse succeeds
- **WHEN** an `analyst_*` step ends with the required signal, conviction, and thesis labels
- **THEN** the step output stores the parsed analyst structure
- **AND** an `opencandle-analyst-step` entry is appended with stage, signal, conviction, and `parsed: true`

#### Scenario: Analyst parse fails after one retry
- **WHEN** an `analyst_*` or `debate_*` step does not include its required labels
- **THEN** the workflow sends exactly one follow-up prompt referencing the existing required output format
- **AND** if the retry still fails, the step output records raw text and an `opencandle-analyst-step` entry with `parsed: false`
- **AND** the workflow continues instead of failing the step

### Requirement: Generated analyst prompts remain deferred in observe-only compliance slice
The observe-only evidence-capture slice SHALL NOT edit analyst prompt templates or replace static analyst prompts with generated prompt contracts.

#### Scenario: Prompt templates remain unchanged
- **WHEN** this change is implemented
- **THEN** `ANALYST_PROMPTS` and debate/synthesis/validation template text remain unchanged
- **AND** generated prompt contract compliance remains documented as deferred future work

### Requirement: Dashboard counts completed analyst steps from custom entries
The GUI dashboard projector SHALL derive active-analysis `analystsDone` from `opencandle-analyst-step` custom entries instead of a hardcoded zero.

#### Scenario: Analyst entries update active dashboard progress
- **WHEN** a session contains an `opencandle-workflow` entry followed by analyst-step custom entries
- **THEN** the projected active analysis reports `analystsDone` equal to the number of matching analyst-step entries
