# workflow-runner Specification

## Purpose
Defines current prompt-workflow execution: typed workflow builders provide prompt-bearing steps, the SessionCoordinator sequences prompts through settlement, and the WorkflowRunner tracks in-memory run IDs, step state, cancellation, and lifecycle events.

## Requirements
### Requirement: Workflow execution uses typed step definitions
The workflow runtime SHALL execute workflows defined as `WorkflowDefinition` builders with an ordered list of typed prompt steps. Each step SHALL declare a `stepType`, prompt text, required inputs, expected outputs, and whether the step is skippable.

#### Scenario: Portfolio builder workflow executes as typed steps
- **WHEN** the routing layer classifies a user request as `portfolio_builder`
- **THEN** the WorkflowRunner receives a workflow definition with steps of types `fetch_candidates`, `risk_review`, and `synthesize`, and executes them in order

#### Scenario: Compare-assets workflow executes as typed steps
- **WHEN** the routing layer classifies a user request as `compare_assets`
- **THEN** the WorkflowRunner receives a workflow definition with steps of types `fetch_data` and `compare_and_present`, and executes them in order

#### Scenario: Options screener workflow executes as typed steps
- **WHEN** the routing layer classifies a user request as `options_screener`
- **THEN** the WorkflowRunner receives a workflow definition with steps of types `fetch_chain` and `rank_and_present`, and executes them in order

#### Scenario: Step declares required inputs and expected outputs
- **WHEN** a workflow step of type `risk_review` is defined
- **THEN** it declares that it requires `candidate_positions` as input and produces `risk_assessment` as output

### Requirement: Each workflow run has a unique run ID and inspectable in-memory state
The WorkflowRunner SHALL assign a unique `runId` to each workflow execution and retain the active run's current step index, step statuses, step outputs, and lifecycle events in memory while the process is running.

#### Scenario: Run state is updated after each step
- **WHEN** a workflow step completes (success or failure)
- **THEN** the active run state is updated with the step's status and output before the next step begins

#### Scenario: Run ID is unique per execution
- **WHEN** two workflow runs are started in the same session
- **THEN** each receives a distinct `runId`

### Requirement: Steps transition through explicit states
Each workflow step SHALL transition through states: `pending` -> `running` -> `completed | failed | skipped`. Invalid transitions (e.g., `completed` -> `running`) SHALL be rejected.

#### Scenario: Step transitions from pending to running
- **WHEN** the WorkflowRunner begins executing a step
- **THEN** the step status changes from `pending` to `running`

#### Scenario: Failed step does not block subsequent skippable steps
- **WHEN** a non-critical step fails and the next step is marked `skippable: true`
- **THEN** the next step executes normally with the available evidence

#### Scenario: Invalid state transition is rejected
- **WHEN** code attempts to transition a step from `completed` to `running`
- **THEN** the transition is rejected with an error

### Requirement: New workflow execution cancels in-flight workflow runs
The WorkflowRunner SHALL support cancellation. When a new workflow starts while another run is active, the active workflow run SHALL be cancelled by marking pending or running steps as `skipped` and recording a `workflow_cancelled` event.

#### Scenario: New workflow cancels previous run
- **WHEN** a user submits a new portfolio request while a previous portfolio workflow is running
- **THEN** the previous run's remaining steps are marked `skipped` and a new run begins

#### Scenario: Cancelled run is recorded
- **WHEN** a workflow run is cancelled
- **THEN** the active run state shows status `cancelled` with the step index where cancellation occurred

### Requirement: Workflow dispatch uses WorkflowRunner with settlement-based prompt sequencing
The SessionCoordinator SHALL dispatch typed workflow definitions through the WorkflowRunner while using prompt settlement checks between prompts to keep prompt-driven steps ordered.

#### Scenario: All existing workflows migrate to WorkflowRunner
- **WHEN** the migration is complete
- **THEN** `portfolio_builder`, `options_screener`, `compare_assets`, and `comprehensive_analysis` all execute through the WorkflowRunner
- **THEN** prompt sequencing waits for current prompt activity to settle before dispatching follow-up workflow prompts
