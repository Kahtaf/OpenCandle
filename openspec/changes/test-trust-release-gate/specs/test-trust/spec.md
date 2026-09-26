## ADDED Requirements

### Requirement: Honest coverage and inventory
The project SHALL report every test surface's execution route and coverage status, with unmeasured surfaces explicitly identified.

#### Scenario: Coverage misses a production branch
- **WHEN** a production branch is not executed
- **THEN** the scoped report includes it as uncovered and does not remove the file from the denominator

### Requirement: Deterministic product proof
Mandatory deterministic journeys SHALL execute without live model credentials and SHALL assert observable results at their declared boundary.

#### Scenario: Application persistence fails
- **WHEN** a journey's application write is omitted
- **THEN** its reopen assertion fails rather than succeeding through manually seeded state

### Requirement: Independent test value
Every removed test contract SHALL have documented remaining proof or a reviewed explanation that the contract is obsolete.

#### Scenario: Source-text assertion is replaced
- **WHEN** a GUI source assertion is removed
- **THEN** a mandatory interaction test detects the intended behavioral regression

### Requirement: Complete release evidence
Release and publish paths SHALL reject missing, stale, mismatched, or incomplete required evidence and SHALL publish only the validated package artifact.

#### Scenario: Empty eval selection
- **WHEN** a required suite selects zero cases
- **THEN** it cannot produce passing release evidence

#### Scenario: Direct tag publication
- **WHEN** a tag is pushed without trusted approved release evidence
- **THEN** publication is blocked before npm publish

#### Scenario: Failed check cannot be waived
- **WHEN** a required check fails
- **THEN** release evidence stays blocked and no waiver, skip, or override turns it green
