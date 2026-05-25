## ADDED Requirements

### Requirement: Semantic Answer Contract Checks

The planning layer SHALL expose observe-only semantic answer contract checks for recurring financial answer obligations that should not live only inside the router prompt.

#### Scenario: Semantic checks evaluate answer text diagnostically

- **WHEN** a selected planning policy requires semantic obligations such as assumptions, tax caveats, target bands, or when-not-ideal guidance
- **THEN** structured checks evaluate those obligations against answer text
- **AND** failures remain observe-only with retry eligibility recorded but no active retry

#### Scenario: Semantic checks are selected by generic policy obligations

- **WHEN** planning selects portfolio rebalance review or concept education refinements
- **THEN** planning includes relevant semantic check IDs
- **AND** the check IDs are generic and not tied to individual tickers, sectors, or memorized prompt strings

#### Scenario: Eval traces expose semantic check outcomes

- **WHEN** the harness records planning telemetry
- **THEN** semantic structured check results and failures appear alongside existing structured checks
- **AND** missing semantic obligations can be tracked as parity gaps before active answer enforcement
