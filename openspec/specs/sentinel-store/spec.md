## ADDED Requirements

### Requirement: SQLite FTS5 sentiment store with schema versioning
The system SHALL maintain a SQLite database at `~/.opencandle/sentinel.db` with a `sentinel_records` table, a `sentinel_fts` FTS5 virtual table, and a `schema_version` table (following the pattern in `src/memory/sqlite.ts:8-23`). The store persists all sentiment records fetched from any source and supports full-text search, time-range queries, source filtering, and ticker-based lookups.

#### Scenario: First initialization
- **WHEN** the store is opened for the first time and `sentinel.db` does not exist
- **THEN** the database and all tables/indexes are created with schema version 1. WAL mode is enabled. Records older than the configured retention period (default 30 days) are pruned on initialization.

#### Scenario: Existing database
- **WHEN** the store is opened and `sentinel.db` already exists with schema version 1
- **THEN** schema version is checked; tables are created only if not exists (additive migration). Pruning runs on records older than the retention period.

#### Scenario: Schema upgrade
- **WHEN** the store is opened and `sentinel.db` has schema version lower than current
- **THEN** version-gated migration logic runs to bring the schema up to date

### Requirement: Observation-based insert (not upsert-replace)
The store SHALL insert each record as a new observation row keyed by `(source, source_id, fetched_at)`. The same content fetched at different times produces multiple rows, building temporal history for trend analysis. Insert with identical `(source, source_id, fetched_at)` is idempotent (no-op).

#### Scenario: New record
- **WHEN** a SentinelRecord with source "twitter" and sourceId "12345" is inserted
- **THEN** a new row is inserted and the FTS5 index is updated

#### Scenario: Same content, different fetch time
- **WHEN** a SentinelRecord with source "twitter" and sourceId "12345" is inserted on Monday and again on Wednesday
- **THEN** two rows exist in the store — one per observation — enabling trend computation

#### Scenario: Idempotent insert
- **WHEN** a SentinelRecord with identical source, sourceId, and fetchedAt is inserted twice
- **THEN** only one row exists (INSERT OR IGNORE on the unique constraint)

### Requirement: Full-text search with BM25 ranking
The store SHALL support full-text search across text, title, author, query, and source fields using FTS5's MATCH operator with BM25 ranking.

#### Scenario: Search by keyword
- **WHEN** `search("earnings")` is called and 15 records contain "earnings" in text or title
- **THEN** results are returned ranked by BM25 relevance score

#### Scenario: Search with source filter
- **WHEN** `search("NVDA", { source: "reddit" })` is called
- **THEN** only records with source "reddit" are returned

#### Scenario: Search with time range
- **WHEN** `search("Fed", { since: "2026-04-08", until: "2026-04-11" })` is called
- **THEN** only records with fetched_at within the date range are returned

### Requirement: Ticker-based lookup
The store SHALL support querying records by ticker symbol from the tickers JSON column using exact-match JSON queries on the main table (not FTS5 MATCH, since ticker symbols are structured data). Supports varied ticker formats: `AAPL`, `RY.TO`, `BTC-USD`.

#### Scenario: Ticker query
- **WHEN** `getByTicker("AAPL", { since: "2026-04-04" })` is called
- **THEN** all records from the last 7 days where tickers JSON array contains "AAPL" are returned

### Requirement: Time-series aggregation
The store SHALL support aggregating sentiment scores into time-bucketed series for trend computation. Multiple observations of the same content within a bucket are averaged.

#### Scenario: Daily buckets
- **WHEN** `getTimeSeries("AAPL", { days: 7, bucketHours: 24 })` is called
- **THEN** returns an array of { timestamp, avgScore, count } grouped by 24-hour buckets, one per source

### Requirement: Pruning
The store SHALL delete records older than a configurable retention period (from `config.sentiment.retentionDays`, default 30 days) on initialization.

#### Scenario: Old records exist
- **WHEN** the store initializes with retention of 30 days and contains records from 45 days ago
- **THEN** those records are deleted; records from 20 days ago are retained
