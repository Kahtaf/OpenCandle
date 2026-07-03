# market-alerts-and-reports Specification

## Purpose
Defines alert rules, alert events, daily report templates, report history, and notification hooks for local market-state automations.
## Requirements
### Requirement: Alert Rules Are Durable

OpenCandle SHALL store alert rules and alert trigger events in SQLite.

#### Scenario: Price alert rule is stored

- **WHEN** a user creates a price crossing alert for a resolved instrument
- **THEN** OpenCandle stores an enabled alert rule with condition type, condition version, condition JSON, scope, check cadence metadata, and cooldown metadata
- **AND** the rule can be listed later without reading session history

#### Scenario: Instrument alert creation does not mutate watchlists

- **WHEN** a user creates an instrument-scoped alert for a resolved symbol that is not on any watchlist
- **THEN** OpenCandle stores or reuses the canonical instrument row needed by the alert rule
- **AND** it does not create a watchlist item as a side effect

#### Scenario: Indicator alert rule is stored

- **WHEN** a user creates an alert such as price crossing an SMA or RSI crossing a threshold
- **THEN** OpenCandle stores the indicator condition in structured condition JSON
- **AND** the rule records the timeframe needed to evaluate the condition

#### Scenario: V1 alert vocabulary is finite

- **WHEN** a V1 alert rule is created
- **THEN** its scope is one of the V1-supported scopes such as instrument or watchlist
- **AND** its timeframe is one of the V1-supported quote or daily-bar timeframes

#### Scenario: V1 alert condition JSON has canonical shapes

- **WHEN** OpenCandle creates a V1 price, SMA, RSI, percent-move, or volume alert
- **THEN** the rule stores condition JSON matching the documented V1 shape for that condition type
- **AND** the shape is versioned by `condition_version`
- **AND** evaluator code does not depend on provider-native indicator payload formats

#### Scenario: Trigger event is recorded

- **WHEN** an enabled alert condition evaluates from false to true
- **THEN** OpenCandle records an alert event with the rule id, instrument id, observed values, triggered timestamp, status, and message

### Requirement: Alert Evaluation Avoids Repeated Crossing Triggers

OpenCandle SHALL preserve enough previous observation state to evaluate crossing-style conditions without repeatedly firing while the condition remains true.

#### Scenario: Crossing above fires once

- **WHEN** the previous observed price was below a threshold and the current observed price is above that threshold
- **THEN** OpenCandle records a trigger event
- **AND** stores the current observation as the last observation

#### Scenario: Still above does not fire every check

- **WHEN** the previous observed price was already above a threshold and the current observed price remains above that threshold
- **THEN** OpenCandle updates check metadata
- **AND** it does not record another crossing event unless the rule cooldown and condition semantics permit it

#### Scenario: Cooldown suppresses repeated events

- **WHEN** an alert condition crosses again within `cooldown_seconds` after `last_triggered_at`
- **THEN** OpenCandle updates check metadata
- **AND** it does not record another alert event for that rule

#### Scenario: First observation seeds crossing state

- **WHEN** a crossing-style alert rule has no prior observation and the first observed value is already beyond the threshold
- **THEN** OpenCandle stores the first observation
- **AND** it does not record a crossing event until a later observation crosses from the opposite side

#### Scenario: Invalid provider data does not trigger alerts

- **WHEN** alert evaluation receives missing, stale beyond the rule's acceptable freshness, or zero-filled provider data
- **THEN** OpenCandle updates the rule's `last_checked_at`
- **AND** it records the check as an unavailable or degraded alert event with the reason
- **AND** it does not create a trigger event
- **AND** it does not overwrite `last_observed_json` with the invalid value

### Requirement: Alert Evaluation Can Be Manual Before Background Heartbeat

OpenCandle SHALL support explicit alert checks independently of whether a background runner is active.

#### Scenario: User manually checks due alerts

- **WHEN** the user runs an explicit alert check from the TUI, GUI, or future CLI command
- **THEN** OpenCandle evaluates due enabled alert rules using available market data
- **AND** records any resulting alert events

#### Scenario: Concurrent manual checks do not duplicate events

- **WHEN** two manual alert checks evaluate the same due rule at nearly the same time
- **THEN** OpenCandle creates the trigger event only if the persisted previous observation and `last_triggered_at` still match the check's decision point
- **AND** it stores the final observation atomically with event creation
- **AND** it does not create duplicate user-visible alert events for the same observation

#### Scenario: Unsupported condition version needs review

- **WHEN** an alert rule has a `condition_version` the current evaluator does not support
- **THEN** OpenCandle marks the rule as needs-review or unavailable
- **AND** it does not execute the rule using guessed semantics

#### Scenario: No background runner is required for stored rules

- **WHEN** alert rules exist and no GUI/TUI writer process is running a heartbeat
- **THEN** the rules remain durable in SQLite
- **AND** they are evaluated the next time an explicit check or authorized runner executes

#### Scenario: Minute cadence does not imply active monitoring in V1

- **WHEN** an alert rule stores cadence metadata such as a minute-level check interval
- **THEN** OpenCandle does not claim the rule is being monitored continuously unless an authorized runner is enabled
- **AND** manual checks remain the V1 execution path

### Requirement: Future Background Heartbeat Has Single Writer Ownership

OpenCandle SHALL NOT require a background heartbeat for V1 manual alert checks, but any future in-process heartbeat evaluation SHALL run only from the active writer process for a session or local state owner.

#### Scenario: GUI writer evaluates due rules

- **WHEN** the GUI holds the writer role and heartbeat evaluation is enabled
- **THEN** the GUI process may evaluate due alert rules
- **AND** follower processes display results without also evaluating the same rules

#### Scenario: Follower process does not duplicate alerts

- **WHEN** a TUI or GUI process is in follower mode
- **THEN** it SHALL NOT run due alert evaluation
- **AND** it SHALL NOT create duplicate alert events

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

### Requirement: Watchlist Target And Stop Fields Are Not V1 Background Alerts

OpenCandle SHALL treat watchlist target and stop prices as display/manual-check metadata until a later executable alert flow promotes them into alert rules.

#### Scenario: Watchlist target price remains metadata

- **WHEN** a watchlist item has a target price or stop price
- **THEN** OpenCandle may display those fields and use them in explicit watchlist checks
- **AND** it does not create background alert events for those fields unless a corresponding enabled alert rule exists

