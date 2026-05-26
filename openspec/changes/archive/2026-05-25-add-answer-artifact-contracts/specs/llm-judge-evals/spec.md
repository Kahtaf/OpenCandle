## ADDED Requirements

### Requirement: Judge Reports Can Classify Artifact Contract Gaps

LLM judge reports SHALL be able to distinguish a missing structured-answer contract from a missing provider/tool capability or prose-only synthesis weakness.

#### Scenario: Structured work expected but absent

- **WHEN** a prompt would benefit from an exposure map, rebalance action plan, education example table, or source coverage table
- **THEN** the report MAY classify the improvement as an artifact-contract gap
- **AND** it must not imply a rendered workspace artifact exists unless a later implementation provides it
