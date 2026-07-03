## MODIFIED Requirements

### Requirement: Stateful Tracking Policy Migration

The planning layer SHALL support a replacement-active `stateful_tracking_update` slice for watchlist, portfolio tracking, alert, and report state turns. Prediction recording and checking are not part of the stateful tracking scope.

#### Scenario: Watchlist mutation prompt uses stateful tracking policy

- **WHEN** the user asks to add, remove, or update a watchlist item, portfolio lot, alert rule, or report template
- **THEN** the planner selects `stateful_tracking_update`
- **AND** the route remains an agent task with the `watchlist_or_tracking` workflow label
- **AND** the answer contract requires state update confirmation rather than a market recommendation

#### Scenario: Stateful policy preserves tool-owned persistence

- **WHEN** a watchlist, portfolio, alert, or report turn mutates state
- **THEN** the appropriate tool owns the persisted change
- **AND** the final answer confirms the persisted symbol/action/parameters without inventing missing values

#### Scenario: Prediction prompts are not offered a tracking tool

- **WHEN** the user asks to record or track a prediction
- **THEN** the policy scope offers no prediction tool
- **AND** the answer explains that prediction tracking is not supported rather than simulating a persisted record
