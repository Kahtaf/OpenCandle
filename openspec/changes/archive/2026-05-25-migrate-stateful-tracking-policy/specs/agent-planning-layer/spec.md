## ADDED Requirements

### Requirement: Stateful Tracking Policy Migration

The planning layer SHALL support a replacement-active `stateful_tracking_update` slice for watchlist, portfolio tracking, and prediction state turns.

#### Scenario: Prediction record prompt uses stateful tracking policy

- **WHEN** the user asks to record a prediction
- **THEN** the planner selects `stateful_tracking_update`
- **AND** the route remains an agent task with the `watchlist_or_tracking` workflow label
- **AND** the answer contract requires state update confirmation rather than a market recommendation

#### Scenario: Stateful policy preserves tool-owned persistence

- **WHEN** a watchlist or prediction turn mutates state
- **THEN** the appropriate tool owns the persisted change
- **AND** the final answer confirms the persisted symbol/action/parameters without inventing missing values
