## ADDED Requirements

### Requirement: Fetch-first, index-always pipeline
The system SHALL execute a sentiment pipeline that: (1) runs source adapters to fetch fresh data from live APIs, (2) scores all records via the keyword scorer, (3) inserts scored records into the sentiment store (observation model — no upsert-replace), (4) queries the store for historical context, (5) computes trends and divergence. The store SHALL never gate a response — live fetch failures are handled by provider-level stale cache, not the store.

#### Scenario: Normal execution
- **WHEN** the pipeline runs for query "AAPL" with sources ["twitter", "reddit", "web"]
- **THEN** all three adapters run in parallel, results are scored, indexed, and returned with historical trend enrichment

#### Scenario: One source fails
- **WHEN** the Twitter adapter fails but Reddit and web succeed
- **THEN** the pipeline returns results from Reddit and web, indexes them, and includes available trend data. The Twitter failure is surfaced as a warning, not a pipeline failure.

#### Scenario: All sources fail
- **WHEN** all adapters fail
- **THEN** the pipeline returns empty fresh results with a warning. Historical trend data from the store (if any) is still returned.

### Requirement: Parallel adapter execution
The pipeline SHALL run all requested source adapters concurrently using `Promise.allSettled()`. Fulfilled results are collected; rejected results are logged and surfaced as warnings.

#### Scenario: Three sources requested
- **WHEN** sources ["twitter", "reddit", "web"] are requested
- **THEN** all three adapters execute concurrently, not sequentially

### Requirement: Historical trend enrichment
After indexing fresh results, the pipeline SHALL query the store for the same query's historical time-series data and compute trend metrics (sparkline, delta, direction, sample count) per source.

#### Scenario: Store has 7 days of history
- **WHEN** the pipeline runs for "AAPL" and the store contains AAPL records from the past 7 days
- **THEN** the result includes per-source sparklines with sample counts, average scores, and direction labels

#### Scenario: Store is empty (first query)
- **WHEN** the pipeline runs for "NVDA" and the store had no NVDA records before this fetch
- **THEN** the result includes fresh scores only, trend data is null. The just-indexed records from this fetch are excluded from trend computation (no prior history to compare against). Trend requires at least 2 distinct time buckets of data.
