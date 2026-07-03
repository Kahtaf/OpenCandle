## MODIFIED Requirements

### Requirement: Daily Reports Are Durable Templates and Runs

OpenCandle SHALL store daily report templates and report run history in SQLite. Manual report generation SHALL NOT create or imply an active schedule.

#### Scenario: Default watchlist morning report is configured

- **WHEN** a user explicitly asks to set up a morning report for the default watchlist
- **THEN** OpenCandle stores a report template with cadence, timezone, intended local run time, and configuration containing `targets.default_watchlist = true`
- **AND** the template can target the default watchlist without hardcoding a single-watchlist schema
- **AND** the surface states that the schedule is stored intent and will run automatically only once background scheduling ships

#### Scenario: Report schedule preserves user-local intent

- **WHEN** a morning report template is stored
- **THEN** OpenCandle preserves timezone and local schedule metadata even if V1 reports are only run manually
- **AND** future heartbeat or external scheduler implementations can compute `next_run_at` from that user-local schedule

#### Scenario: Fixed report targets remain fixed

- **WHEN** a future report template targets explicit watchlist ids or portfolio ids
- **THEN** OpenCandle reads those fixed collection ids
- **AND** it does not reinterpret them as the current default collection

#### Scenario: Report run is recorded

- **WHEN** OpenCandle generates a daily report
- **THEN** it records a report run with start time, completion time, status, summary metadata, and any error metadata
- **AND** the run references an existing configured report template when one matches, or records as an unscheduled manual run otherwise

#### Scenario: Report generator can run manually

- **WHEN** a user explicitly requests a daily report
- **THEN** OpenCandle can generate the report from current watchlist state and available providers
- **AND** the result does not require a background scheduler to exist

#### Scenario: Manual generation does not create a schedule

- **WHEN** a user generates a report manually and no report template exists
- **THEN** OpenCandle records the run without creating an enabled schedule template as a side effect
- **AND** no surface presents the report as scheduled when no scheduler will run it
