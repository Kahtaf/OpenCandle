## REMOVED Requirements

### Requirement: Prediction Lifecycle Is Explicit

**Reason**: The predictions feature is removed as a product decision — it presented an experimental scorecard as core finance functionality. The `track_prediction` tool, prediction storage, GUI surface, and prompt/routing references are all deleted.

**Migration**: The v8 schema migration drops the `prediction_records` table; this change constitutes the explicit destructive opt-in required by the schema-upgrade requirement. No replacement surface is provided. Watchlist thesis/target/stop fields, analyst debate conviction outputs, and the SEC `filing_thesis_review` policy are separate features and are unaffected.

## MODIFIED Requirements

### Requirement: Market-State Schema Upgrades Preserve User Rows

OpenCandle SHALL treat user market state as durable after this feature ships.

#### Scenario: Additive schema upgrade preserves rows

- **WHEN** a later schema version adds market-state tables, columns, or indexes
- **THEN** OpenCandle preserves existing user-authored watchlists, portfolios, alert rules, report templates, and import provenance rows
- **AND** it migrates shape additively where possible rather than dropping market-state tables

#### Scenario: Destructive reset requires explicit opt-in

- **WHEN** a schema reset would delete user-authored market-state rows after V1 ships
- **THEN** OpenCandle requires explicit developer or user opt-in
- **AND** it does not perform the reset as a silent compatibility fallback

#### Scenario: Prediction records are dropped at v8

- **WHEN** a database at schema version 7 or earlier migrates to version 8
- **THEN** the migration drops the `prediction_records` table as the explicit, documented removal of the predictions feature
- **AND** all other user-authored market-state rows are preserved unchanged

### Requirement: Market State Relationships Have Explicit Delete Semantics

OpenCandle SHALL define foreign-key behavior for market-state rows.

#### Scenario: Deleting a collection removes its child rows

- **WHEN** a watchlist or portfolio is deleted in a future multi-collection flow
- **THEN** its watchlist items or portfolio lots are removed with it

#### Scenario: Referenced instruments are protected

- **WHEN** an instrument is referenced by watchlist items, portfolio lots, alert rules, or import history
- **THEN** OpenCandle prevents deleting the instrument unless dependent state is removed first

### Requirement: Market State Writes Are Transactional Across Surfaces

OpenCandle SHALL use SQLite transactions as the concurrency boundary for normal market-state mutations from TUI tools and GUI actions.

#### Scenario: Concurrent surface writes serialize through SQLite

- **WHEN** a TUI tool and GUI action mutate market state at nearly the same time
- **THEN** each mutation runs in an SQLite transaction
- **AND** the resulting saved state is equivalent to a serial order of those mutations

#### Scenario: Session writer lock is not required for normal state writes

- **WHEN** a process does not hold the Pi session writer lock
- **THEN** it may still perform authorized market-state mutations through the shared service
- **AND** it must not run background alert/report work that could duplicate another writer's work

#### Scenario: Same-row concurrent edits return committed state

- **WHEN** two surfaces update the same watchlist item, portfolio lot, alert rule, or report template near the same time
- **THEN** each mutation is committed transactionally with an updated timestamp or equivalent change marker
- **AND** callers receive or can refetch the committed row after the write
- **AND** later reads show the final SQLite-committed state rather than stale local form state
