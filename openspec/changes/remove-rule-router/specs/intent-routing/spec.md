## MODIFIED Requirements

### Requirement: LLM Router Becomes The Primary Routing Path

After the production-router acceptance gate has passed for a release window, OpenCandle SHALL use the LLM router as the primary input routing path and remove the deterministic rules router as a production fallback path.

#### Scenario: Unset router mode uses LLM after gate passes

- **WHEN** the acceptance gate has passed and `OPENCANDLE_ROUTER_MODE` is unset
- **THEN** OpenCandle SHALL route input through the LLM router

#### Scenario: Deterministic safety nets remain

- **WHEN** the rules router is removed as a primary path
- **THEN** acronym disambiguation, provider invalid-symbol handling, workflow preflight, and tool validation SHALL remain active

#### Scenario: Rules rollback flag removed or deprecated

- **WHEN** the rollback window is complete
- **THEN** `OPENCANDLE_ROUTER_MODE=rules` SHALL either be removed or explicitly documented as deprecated
