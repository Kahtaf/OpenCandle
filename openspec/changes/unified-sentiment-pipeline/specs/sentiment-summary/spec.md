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

### Requirement: Cross-source divergence detection
The tool SHALL compare per-source average sentiment scores. When retail sources (Twitter, Reddit average) and news sources (web average) diverge by more than 0.4 (absolute difference), the tool SHALL flag this as a divergence signal. Divergence requires minimum 5 records per source group in the time window.

#### Scenario: Retail bullish, news bearish
- **WHEN** Twitter average is +0.5, Reddit average is +0.4, web/news average is -0.2
- **THEN** retail average is +0.45, divergence from news is 0.65 (> 0.4), flagged: `⚠ DIVERGENCE: Retail sentiment (+0.45) sharply diverged from news sentiment (-0.20). This pattern often precedes increased volatility.`

#### Scenario: All sources agree
- **WHEN** all sources are within 0.3 of each other
- **THEN** no divergence flag; output notes "Sources broadly aligned"

#### Scenario: Insufficient data for divergence
- **WHEN** Twitter has 3 records and Reddit has 2 records (both below minimum 5)
- **THEN** divergence detection is skipped with note "Insufficient data for divergence analysis"

### Requirement: Output format
The tool SHALL return: per-source breakdown (source, score, count, top records), aggregate score, divergence analysis, and trend context if historical data exists.

#### Scenario: Full output
- **THEN** output format:
```
Sentiment summary for $AAPL (last 24h):

Source     Score   Count  Signal
Twitter    +0.42     50   Bullish
Reddit     +0.31     34   Cautious Bullish
Web/News   -0.18     12   Slightly Bearish

Aggregate: +0.22 (Cautious Bullish)

⚠ DIVERGENCE: Retail sentiment (+0.37 avg) diverged from news
sentiment (-0.18). This often precedes increased volatility.

Trend (7d): ▃▅▇▇▅▃▂  peaked mid-week, now declining
```
