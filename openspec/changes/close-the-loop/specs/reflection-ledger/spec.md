## ADDED Requirements

### Requirement: Analysis reflections are persisted deterministically

On completion of a comprehensive-analysis run — the synthesis-step completion branch in `SessionCoordinator.startWorkflowRun`, gated on `workflowType === "comprehensive_analysis"` — the system SHALL write one row to a new `analysis_reflections` table (schema v8 → v9 additive migration): `id`, `created_at`, `session_id`, `symbol` (from new optional `WorkflowDefinition` metadata `{ symbol }` set by `buildComprehensiveAnalysisDefinition`), `tally_json` (the code-computed analyst vote tally), `synthesis_excerpt` (first 500 characters of the synthesis text), `price_at_analysis` and `price_currency` (from the run's `get_stock_quote` call for the run symbol, read from the session tool-result entry's full `details` — never from the truncated evidence digest), `parsed_analyst_count`. There is NO invalidation-level column: no structured output carries one today; it may be added additively when a structured synthesis contract exists. Every field that cannot be extracted deterministically SHALL be NULL; no model call may run to fill a reflection field. Runs with fewer than 2 parsed analyst steps still record a row (with `tally_json` NULL), so the ledger reflects that an analysis happened.

#### Scenario: Completed analysis writes a reflection

- **WHEN** `/analyze NVDA` completes with 5 parsed analyst steps and a `get_stock_quote` tool result for NVDA in the session
- **THEN** `analysis_reflections` gains a row with the NVDA symbol, the computed tally, that call's price from the tool result's full details, and the synthesis excerpt

#### Scenario: Degraded run records honestly

- **WHEN** an analysis completes with 1 parsed analyst step and no matching quote tool result
- **THEN** the row has NULL `tally_json` and NULL `price_at_analysis`, and `parsed_analyst_count` is 1

#### Scenario: Migration preserves data

- **WHEN** a test constructs a representative v8 database in a temporary directory and opens it after this change
- **THEN** it migrates additively to v9 with all existing rows intact (migration test against a file-backed temporary database, not `:memory:`)

### Requirement: Prior reflections are injected as data, never fabricated

When a comprehensive analysis or single-asset routed turn concerns a symbol with existing reflections, prompt assembly SHALL inject the most recent 3 reflections as an additive data block (analysis date, tally/verdict summary, price at that date — always rendered with its date, e.g. "price then: $180.20 (2026-06-01)", never as a current price). With zero reflections for the symbol, no section, header, or placeholder SHALL be emitted. The block is data; no instruction text changes. Outcome judgments ("the thesis broke") are left to the model reasoning over the turn's live evidence — the ledger never computes or stores outcomes.

#### Scenario: Second analysis sees the first

- **WHEN** `/analyze NVDA` runs after a prior NVDA reflection exists
- **THEN** the dispatched analysis context contains the prior reflection's date, tally, and price-then as a data block

#### Scenario: Empty ledger is structurally absent

- **WHEN** `/analyze TSLA` runs with no TSLA reflections
- **THEN** the dispatched context contains no reflection section at all

#### Scenario: Pass-through turns get nothing

- **WHEN** a non-finance turn mentions a symbol-like token
- **THEN** no reflection context is injected
