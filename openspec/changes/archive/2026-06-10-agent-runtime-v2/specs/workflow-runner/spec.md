## ADDED Requirements

### Requirement: Workflow execution uses typed step definitions
The WorkflowRunner SHALL execute workflows defined as an ordered list of typed `WorkflowStep` objects, each declaring a `stepType`, required inputs, expected outputs, and whether the step is skippable.

#### Scenario: Portfolio builder workflow executes as typed steps
- **WHEN** the routing layer classifies a user request as `portfolio_builder`
- **THEN** the WorkflowRunner receives a workflow definition with steps of types `fetch_data`, `rank`, `risk_review`, `synthesize`, and `validate`, and executes them in order

#### Scenario: Step declares required inputs and expected outputs
- **WHEN** a workflow step of type `risk_review` is defined
- **THEN** it declares that it requires `candidate_positions` as input and produces `risk_assessment` as output

### Requirement: Each workflow run has a unique run ID and persistent state
The WorkflowRunner SHALL assign a unique `runId` to each workflow execution and persist the run's state (current step index, step statuses, step outputs) so it can be inspected and recovered.

#### Scenario: Run state is persisted after each step
- **WHEN** a workflow step completes (success or failure)
- **THEN** the run record in storage is updated with the step's status and output before the next step begins

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

### Requirement: New user input cancels in-flight workflow runs
The WorkflowRunner SHALL support cancellation. When a new user message triggers a new workflow, any in-flight workflow run SHALL be cancelled by marking remaining pending steps as `skipped` and recording a `workflow_cancelled` event.

#### Scenario: New workflow cancels previous run
- **WHEN** a user submits a new portfolio request while a previous portfolio workflow is running
- **THEN** the previous run's remaining steps are marked `skipped` and a new run begins

#### Scenario: Cancelled run is recorded
- **WHEN** a workflow run is cancelled
- **THEN** the run record shows status `cancelled` with the step index where cancellation occurred

### Requirement: WorkflowRunner replaces queuePromptSequence
The `queuePromptSequence()` function, `waitForPromptSettlement()`, and the polling/settlement machinery in `opencandle-extension.ts` SHALL be removed once all workflows are migrated to the WorkflowRunner.

#### Scenario: All existing workflows migrate to WorkflowRunner
- **WHEN** the migration is complete
- **THEN** `portfolio_builder`, `options_screener`, `compare_assets`, and `comprehensive_analysis` all execute through the WorkflowRunner
- **THEN** `queuePromptSequence` and related settlement functions no longer exist in the codebase
