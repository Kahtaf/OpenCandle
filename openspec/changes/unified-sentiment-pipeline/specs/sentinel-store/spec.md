## ADDED Requirements

### Requirement: SQLite FTS5 sentiment store
The system SHALL maintain a SQLite database at `~/.opencandle/sentinel.db` with a `sentinel_records` table and a `sentinel_fts` FTS5 virtual table. The store persists all sentiment records fetched from any source and supports full-text search, time-range queries, source filtering, and ticker-based lookups.

#### Scenario: First initialization
- **WHEN** the store is opened for the first time and `sentinel.db` does not exist
- **THEN** the database and all tables/indexes are created. Records older than 30 days are pruned on initialization.

#### Scenario: Existing database
- **WHEN** the store is opened and `sentinel.db` already exists
- **THEN** tables are created only if not exists (additive migration). Pruning runs on records older than 30 days.

### Requirement: Upsert with deduplication
The store SHALL upsert records by `(source, source_id)`. If a record with the same source and source_id already exists, it SHALL be replaced with the newer version (updated sentiment scores, engagement counts).

#### Scenario: New record
- **WHEN** a SentinelRecord with source "twitter" and sourceId "12345" is upserted and no matching record exists
- **THEN** a new row is inserted and the FTS5 index is updated

#### Scenario: Duplicate record
- **WHEN** a SentinelRecord with source "twitter" and sourceId "12345" is upserted and a matching record already exists
- **THEN** the existing row is replaced and the FTS5 index is updated

### Requirement: Full-text search with BM25 ranking
The store SHALL support full-text search across text, title, author, query, source, and tickers fields using FTS5's MATCH operator with BM25 ranking.

#### Scenario: Search by keyword
- **WHEN** `search("earnings")` is called and 15 records contain "earnings" in text or title
- **THEN** results are returned ranked by BM25 relevance score

#### Scenario: Search with source filter
- **WHEN** `search("NVDA", { source: "reddit" })` is called
- **THEN** only records with source "reddit" are returned

#### Scenario: Search with time range
- **WHEN** `search("Fed", { since: "2026-04-08", until: "2026-04-11" })` is called
- **THEN** only records with published_at within the date range are returned

### Requirement: Ticker-based lookup
The store SHALL support querying records by ticker symbol from the tickers JSON column.

#### Scenario: Ticker query
- **WHEN** `getByTicker("AAPL", { since: "2026-04-04" })` is called
- **THEN** all records from the last 7 days where tickers contains "AAPL" are returned

### Requirement: Time-series aggregation
The store SHALL support aggregating sentiment scores into time-bucketed series for trend computation.

#### Scenario: Daily buckets
- **WHEN** `getTimeSeries("AAPL", { days: 7, bucketHours: 24 })` is called
- **THEN** returns an array of { timestamp, avgScore, count } grouped by 24-hour buckets, one per source

### Requirement: Pruning
The store SHALL delete records older than a configurable threshold (default 30 days) on initialization.

#### Scenario: Old records exist
- **WHEN** the store initializes and contains records from 45 days ago
- **THEN** those records are deleted; records from 20 days ago are retained
