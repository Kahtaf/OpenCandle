## MODIFIED Requirements

### Requirement: get_sentiment_summary tool (cross-source aggregate)
The system SHALL expose a `get_sentiment_summary` AgentTool that runs the full sentiment pipeline across all available sources (Twitter, Reddit, web, Finnhub) and returns a cross-source comparison with divergence detection.

#### Scenario: Normal execution with all sources
- **WHEN** agent calls `get_sentiment_summary` with `query: "AAPL"` and `hours: 24`, and `FINNHUB_API_KEY` is configured
- **THEN** the tool fetches from all four sources in parallel (Twitter, Reddit, web, Finnhub), scores, indexes, and returns per-source sentiment, aggregate sentiment, and divergence analysis

#### Scenario: Ticker query without Finnhub key
- **WHEN** agent calls with `query: "AAPL"` but `FINNHUB_API_KEY` is not configured
- **THEN** the tool fetches from three sources (Twitter, Reddit, web) and includes a warning that Finnhub is unavailable

#### Scenario: Non-ticker query
- **WHEN** agent calls with `query: "AI regulation impact"` (no ticker)
- **THEN** Finnhub adapter returns empty results (no API call made), tool proceeds with Twitter, Reddit, and web sources only — no warning emitted since this is expected behavior

#### Scenario: Partial source availability
- **WHEN** Twitter is unavailable and Finnhub API fails but Reddit and web succeed
- **THEN** the tool returns results from available sources with warnings for failed sources

### Requirement: Cross-source divergence detection (normalized)
The tool SHALL compare per-source **average per-record sentiment scores** (not raw aggregates). Finnhub SHALL be classified as an institutional/news source alongside web search. When retail sources (Twitter, Reddit average) and news sources (web, Finnhub average) diverge by more than the configured threshold (`config.sentiment.divergenceThreshold`, default 0.4), the tool SHALL flag this as a divergence signal. Divergence requires minimum 5 records per source group in the time window.

For divergence grouping:
- **Retail**: Twitter, Reddit (post-level only, excluding comments)
- **Institutional/News**: web, Finnhub

#### Scenario: Retail bullish, institutional bearish
- **WHEN** Twitter average is +0.5, Reddit average is +0.4, web average is -0.1, Finnhub average is -0.3
- **THEN** retail average is +0.45, institutional average is -0.2, divergence is 0.65 (> 0.4), flagged

#### Scenario: Finnhub adds institutional signal
- **WHEN** web search returns 3 articles (below minimum) but Finnhub returns 8 articles
- **THEN** combined institutional count is 11 (meets minimum), divergence detection proceeds

## ADDED Requirements

### Requirement: SentimentSource includes finnhub
The `SentimentSource` type in `src/sentiment/types.ts` SHALL be `"twitter" | "reddit" | "web" | "finnhub"`.

#### Scenario: Finnhub records stored with correct source
- **WHEN** Finnhub articles are processed through the pipeline
- **THEN** records are stored in SQLite with `source = "finnhub"` and queryable via `getTimeSeries`

### Requirement: Finnhub wired as parallel source in sentiment-summary
The `get_sentiment_summary` tool SHALL call the Finnhub adapter in the same `Promise.allSettled` block as Twitter, Reddit, and web. The Finnhub call SHALL be guarded by `getConfig().finnhubApiKey` — if no key is configured, the Finnhub entry is omitted from the parallel fetch (not attempted and failed).

#### Scenario: Finnhub key configured
- **WHEN** `FINNHUB_API_KEY` is set
- **THEN** the `Promise.allSettled` array includes a Finnhub fetch entry

#### Scenario: No Finnhub key
- **WHEN** no Finnhub key is configured
- **THEN** the `Promise.allSettled` array has 3 entries (Twitter, Reddit, web) — Finnhub is not attempted

### Requirement: Sentiment summary output includes Finnhub row
The output table SHALL include a `Finnhub` row when Finnhub data is available, formatted identically to other sources.

#### Scenario: Full output with Finnhub
- **THEN** output format includes:
```
| Source    | Score  | Count | Signal          |
|----------|--------|-------|-----------------|
| Twitter  | +0.42  |    50 | Bullish         |
| Reddit   | +0.31  |    34 | Leaning Bullish |
| Web/News | -0.18  |    12 | Leaning Bearish |
| Finnhub  | -0.05  |     8 | Neutral         |
```
