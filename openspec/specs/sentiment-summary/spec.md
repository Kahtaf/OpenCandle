## ADDED Requirements

### Requirement: get_sentiment_summary tool (cross-source aggregate)
The system SHALL expose a `get_sentiment_summary` AgentTool that runs the full sentiment pipeline across all sources (Twitter, Reddit, web) and returns a cross-source comparison with divergence detection.

#### Scenario: Normal execution
- **WHEN** agent calls `get_sentiment_summary` with `query: "AAPL"` and `hours: 24`
- **THEN** the tool fetches from all three sources in parallel, scores, indexes, and returns per-source sentiment, aggregate sentiment, and divergence analysis

#### Scenario: Partial source availability
- **WHEN** Twitter is unavailable (no session) but Reddit and web succeed
- **THEN** the tool returns results from available sources with a note that Twitter data is unavailable

### Requirement: Tool parameters
Parameters: `query` (required string — ticker or topic), `hours` (optional number, default 24 — lookback window for live fetching).

### Requirement: Cross-source divergence detection (normalized)
The tool SHALL compare per-source **average per-record sentiment scores** (not raw aggregates). When retail sources (Twitter, Reddit average) and news sources (web average) diverge by more than the configured threshold (`config.sentiment.divergenceThreshold`, default 0.4), the tool SHALL flag this as a divergence signal. Divergence requires minimum 5 records per source group in the time window.

Per-record averaging ensures cross-source comparability regardless of volume differences (50 tweets vs 10 articles). For Reddit, comment-level records are excluded from divergence averages — only post-level records count (filter by `metadata.isComment !== true`). This prevents comment fan-out from inflating Reddit's weight in cross-source comparison.

#### Scenario: Retail bullish, news bearish
- **WHEN** Twitter per-record average is +0.5, Reddit per-record average is +0.4, web per-record average is -0.2
- **THEN** retail average is +0.45, divergence from news is 0.65 (> 0.4), flagged: `⚠ DIVERGENCE: Retail sentiment (+0.45) vs news sentiment (-0.20) — gap of 0.65.`

#### Scenario: All sources agree
- **WHEN** all sources per-record averages are within the threshold of each other
- **THEN** no divergence flag; output notes "Sources broadly aligned"

#### Scenario: Insufficient data for divergence
- **WHEN** Twitter has 3 records and Reddit has 2 records (both below minimum 5)
- **THEN** divergence detection is skipped with note "Insufficient data for divergence analysis"

### Requirement: Output format
The tool SHALL return: per-source breakdown (source, average score, count, top records), aggregate score, divergence analysis, and trend context with sample counts if historical data exists.

#### Scenario: Full output
- **THEN** output format:
```
Sentiment summary for $AAPL (last 24h):

Source     Score   Count  Signal
Twitter    +0.42     50   Bullish
Reddit     +0.31     34   Cautious Bullish
Web/News   -0.18     12   Slightly Bearish

Aggregate: +0.22 (Cautious Bullish)

⚠ DIVERGENCE: Retail sentiment (+0.37 avg) vs news sentiment (-0.18) — gap of 0.55.

Trend (7d): ▃▅▇▇▅▃▂  peaked mid-week, now declining (96 records)
```
