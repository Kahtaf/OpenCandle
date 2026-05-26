## ADDED Requirements

### Requirement: Concept Education Sub-Policies

The planning layer SHALL support selected concept education policy cards under the existing `concept_explainer` task family so recurring educational obligations can move out of broad fallback prose without creating new task families.

#### Scenario: Options education selects options concept policy

- **WHEN** the user asks a no-symbol education question about covered calls, protective puts, option premiums, assignment, strikes, expirations, or similar option mechanics
- **THEN** planning selects task family `concept_explainer`
- **AND** it selects an options education policy card
- **AND** it keeps evidence plan `placeholder_concept_explainer`
- **AND** it does not require live options-chain tools unless the user asks for current tradable examples

#### Scenario: Inflation and cash education selects inflation concept policy

- **WHEN** the user asks how inflation affects cash, purchasing power, savings, bonds, real returns, or inflation protection
- **THEN** planning selects task family `concept_explainer`
- **AND** it selects an inflation/cash education policy card
- **AND** it keeps the concept answer contract rather than a macro allocation decision contract unless the user asks for a portfolio recommendation

#### Scenario: Valuation metric education remains concept education

- **WHEN** the user asks how to use a valuation metric such as P/E, P/S, EV/EBITDA, trailing earnings, forward earnings, normalized earnings, or cyclically adjusted metrics without over-relying on it
- **THEN** planning selects task family `concept_explainer`
- **AND** it selects valuation-metric education policy behavior
- **AND** it does not add entry levels, confidence bands, or invalidation boilerplate

#### Scenario: Education sub-policies remain compact and general

- **WHEN** an education sub-policy is selected
- **THEN** only the selected concept policy card is injected
- **AND** the card does not encode ticker-specific, sector-specific, or time-specific examples as required behavior
- **AND** unrelated education cards are not injected
