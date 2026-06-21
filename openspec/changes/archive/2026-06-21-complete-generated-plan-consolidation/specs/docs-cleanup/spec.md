## ADDED Requirements

### Requirement: Completed Generated Plans Archive Under OpenSpec

Completed generated implementation-plan queues SHALL be preserved under archived OpenSpec changes instead of remaining as a root-level `plans/` folder.

#### Scenario: Generated plan queue is complete

- **WHEN** every item in a generated plan queue is implemented or intentionally rejected
- **THEN** the queue is moved into a completed OpenSpec change as source evidence
- **AND** the root of the repository no longer contains the generated `plans/` folder

#### Scenario: OpenSpec remains the completed-work ledger

- **WHEN** maintainers inspect completed generated implementation work
- **THEN** they can find the proposal, completed tasks, and original plan records under `openspec/changes/archive/`
- **AND** no second root-level planning index is required for those completed records
