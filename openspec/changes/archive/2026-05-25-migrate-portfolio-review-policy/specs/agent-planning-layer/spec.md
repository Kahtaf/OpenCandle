## ADDED Requirements

### Requirement: Portfolio Review Policy Migration

The planning layer SHALL support a replacement-active `portfolio_review` slice for existing-allocation critique that does not ask for a budget or route into portfolio construction unless the user requests construction.

#### Scenario: Existing allocation review is not portfolio construction

- **WHEN** the user asks to critically evaluate an existing portfolio or allocation without requesting a new portfolio
- **THEN** the planner selects `portfolio_review`
- **AND** the route remains an agent task rather than `portfolio_builder`
- **AND** the answer contract requires a clear structural read, risk/downside, data-gap disclosure, and source coverage

#### Scenario: Portfolio construction remains separate

- **WHEN** the user asks to build or construct a portfolio
- **THEN** the planner preserves the `portfolio_build` workflow behavior
- **AND** the `portfolio_review` policy card is not injected for that workflow
