## ADDED Requirements

### Requirement: get_web_sentiment tool
The system SHALL expose a `get_web_sentiment` AgentTool that performs sentiment analysis on web/news search results for a given ticker or topic. It uses the sentiment pipeline with the web adapter only.

#### Scenario: News sentiment for ticker
- **WHEN** agent calls `get_web_sentiment` with `query: "TSLA"` and `freshness: "day"`
- **THEN** the tool searches for recent news about TSLA via the web adapter, scores results via keyword scorer, indexes them, and returns sentiment score with individual results

#### Scenario: Topic sentiment
- **WHEN** agent calls with `query: "semiconductor tariffs"` and `freshness: "week"`
- **THEN** the tool searches for news about semiconductor tariffs from the past week, scores, and returns results

### Requirement: Tool parameters
Parameters: `query` (required string — ticker or topic), `freshness` (optional, "day" | "week" | "month", default "day"), `limit` (optional number, default 10, max 20).

#### Scenario: Default freshness
- **WHEN** called with only `query: "AAPL"`
- **THEN** freshness defaults to "day" (financial context requires recency)

### Requirement: Output format
The tool SHALL return scored results as markdown with title links, snippets, source domains, per-result sentiment indicators (score + confidence), and an aggregate score. If historical data exists in the store, append trend context with sample count.

#### Scenario: Results with history
- **WHEN** results are returned and the store has 5 days of prior data
- **THEN** output includes: aggregate score, individual results, and trend line: `News sentiment (5d): ▃▅▇▅▂  declining (23 records)`
