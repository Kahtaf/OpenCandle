# Sentiment Trend Specification

## Purpose
TBD - normalized from existing baseline requirements.

## Requirements

### Requirement: get_sentiment_trend tool (query-only, no live fetch)
The system SHALL expose a `get_sentiment_trend` AgentTool that queries the sentiment store for historical sentiment data. It SHALL NOT make any live API calls — it reads only from previously indexed data in `sentinel.db`.

#### Scenario: Historical data exists
- **WHEN** agent calls `get_sentiment_trend` with `query: "AAPL"` and `days: 7`
- **THEN** the tool queries the store for AAPL records from the past 7 days and returns per-source time-series with sparklines and sample counts

#### Scenario: No historical data
- **WHEN** agent calls `get_sentiment_trend` with `query: "RIVN"` and the store has no RIVN records
- **THEN** the tool returns "No historical sentiment data for RIVN. Run a sentiment query first to populate the store."

### Requirement: Tool parameters
The tool SHALL accept `query` as a required ticker or topic string, `days` as an optional number defaulting to 7 and capped by `config.sentiment.retentionDays`, and `source` as an optional `"twitter" | "reddit" | "web"` filter defaulting to all sources.

#### Scenario: Source filter
- **WHEN** called with `query: "NVDA"`, `source: "twitter"`
- **THEN** only Twitter records are included in the trend

### Requirement: Output format
The tool SHALL return per-source rows with: source name, sparkline, average score, record count, direction label (rising/falling/stable), and delta over the period. Sample counts are always shown alongside sparklines to prevent overstating signal quality.

#### Scenario: Multi-source trend
- **THEN** output format:
```
Sentiment trend for $AAPL (7d):

Source     Trend        Avg     Count  Direction
Twitter    ▂▃▅▇▆▃▁    +0.31   142    declining (-0.4)
Reddit     ▃▃▅▅▆▃▂    +0.28    67    declining (-0.3)
Web/News   ▅▅▃▂▂▁▁    -0.12    38    declining (-0.5)

Aggregate: +0.19, declining across all sources
```
