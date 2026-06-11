## ADDED Requirements

### Requirement: Imports Preserve Source Provenance

OpenCandle SHALL represent imports as batches and rows with source metadata, row status, and raw row payloads.

#### Scenario: TradingView watchlist import can be represented

- **WHEN** a future importer reads a TradingView-style watchlist export with source symbols
- **THEN** OpenCandle can record an import batch for source `tradingview`
- **AND** each imported symbol can be represented as an import row with raw source data and row status

#### Scenario: Broker portfolio import can be represented

- **WHEN** a future importer reads broker positions or lots
- **THEN** OpenCandle can record an import batch for that broker or CSV source
- **AND** each imported position can preserve raw source data, source account reference, and normalized instrument mapping when available

#### Scenario: Failed row does not block whole import audit

- **WHEN** one imported row cannot be resolved to an instrument
- **THEN** OpenCandle records that row with a failed or needs-review status and an error message
- **AND** other valid rows in the batch can still be imported

### Requirement: Imported Rows Link To Saved State

OpenCandle SHALL store source references on saved watchlist items and portfolio lots created from imports.

#### Scenario: Watchlist item retains import source

- **WHEN** a watchlist item is created from an import row
- **THEN** the watchlist item stores source and source row metadata
- **AND** the original import row can be inspected later

#### Scenario: Portfolio lot retains account reference

- **WHEN** a portfolio lot is created from a broker or account import
- **THEN** the lot stores non-secret source account reference metadata when available
- **AND** the model does not require broker credentials to be stored

### Requirement: Import Model Supports Re-Import

OpenCandle SHALL preserve enough source identity to support future safe re-import behavior without duplicating obvious rows.

#### Scenario: Alias identity handles reused symbols

- **WHEN** an import source reuses the same bare symbol across exchanges, asset classes, or source-native ids
- **THEN** OpenCandle stores alias identity with the available disambiguators
- **AND** it does not collapse distinct source securities solely because the bare symbol matches

#### Scenario: Source alias maps repeated symbol import

- **WHEN** the same source symbol is imported again from the same source
- **THEN** OpenCandle can use `instrument_aliases` to resolve it to the same normalized instrument
- **AND** it does not require a duplicate instrument row

#### Scenario: Stable source row identity is represented for future upserts

- **WHEN** an import source provides a stable row id
- **THEN** OpenCandle can store that identity on import rows and saved watchlist/portfolio rows
- **AND** future import adapters can use the stored identity to implement upsert behavior

#### Scenario: Import adapters remain deferred

- **WHEN** this data model is implemented
- **THEN** OpenCandle is not required to implement TradingView, Interactive Brokers, or CSV import adapters immediately
- **AND** the schema is still capable of representing those future imports
