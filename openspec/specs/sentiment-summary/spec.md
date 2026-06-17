# Sentiment Summary Specification

## Purpose
TBD - normalized from existing baseline requirements.
## Requirements
### Requirement: get_sentiment_summary tool (cross-source aggregate)
The system SHALL expose a `get_sentiment_summary` AgentTool that runs the full sentiment pipeline across all available sources (Twitter, Reddit, web) and returns a cross-source comparison with divergence detection. When one or more sentiment sources are unavailable, the tool SHALL return results from available sources with explicit source-gap notes. Reddit unavailability SHALL distinguish at least missing `rdt-cli`, missing or stale Reddit browser session, skipped Reddit source, and provider execution error when that information is available from typed external-tool failures.

#### Scenario: Normal execution
- **WHEN** agent calls `get_sentiment_summary` with `query: "AAPL"` and `hours: 24`
- **THEN** the tool fetches from all three sources in parallel, scores, indexes, and returns per-source sentiment, aggregate sentiment, and divergence analysis

#### Scenario: Partial source availability
- **WHEN** Twitter is unavailable (no session) but Reddit and web succeed
- **THEN** the tool returns results from available sources with a note that Twitter data is unavailable

#### Scenario: Reddit external tool missing
- **WHEN** Twitter and web sentiment succeed
- **AND** Reddit sentiment fails because `rdt` is not installed
- **THEN** the summary returns Twitter and web results
- **AND** the warning says Reddit requires `rdt-cli` with install command `uv tool install rdt-cli`

#### Scenario: Reddit session missing
- **WHEN** Twitter and web sentiment succeed
- **AND** Reddit sentiment fails because `rdt-cli` has no usable Reddit browser session
- **THEN** the summary returns Twitter and web results
- **AND** the warning says Reddit needs `rdt login` or a refreshed Reddit browser login

#### Scenario: User skips Reddit once
- **WHEN** the user chooses to skip Reddit for the current query
- **THEN** the summary omits Reddit
- **AND** source coverage/caveats state that Reddit was skipped by user choice

### Requirement: Tool parameters
The tool SHALL accept `query` as a required string containing a ticker or topic, and `hours` as an optional number defaulting to 24 for the live-fetch lookback window.

#### Scenario: Query-only invocation uses default lookback
- **WHEN** the tool is called with only `query`
- **THEN** it uses a 24-hour lookback window

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
The tool SHALL return per-source breakdown, aggregate score, divergence analysis, trend context with sample counts if historical data exists, source coverage/caveats, and representative top records. When Reddit is available through `rdt-cli`, Reddit source output SHALL be generated from normalized `rdt-cli` post and comment records. Representative evidence SHALL distinguish scored sample size from displayed representative items.

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

#### Scenario: Reddit contributes rdt-cli post and comment evidence
- **WHEN** `rdt-cli` returns Reddit posts and top comments for a ticker query
- **THEN** sentiment summary source coverage includes Reddit
- **AND** Reddit drivers may cite post-level and comment-level evidence
- **AND** representative evidence distinguishes scored sample size from displayed representative items

#### Scenario: Reddit unavailable does not block summary
- **WHEN** Reddit setup is incomplete but Twitter or web/news sources return usable data
- **THEN** the sentiment summary still reports available source findings
- **AND** confidence/caveats identify the missing Reddit source

### Requirement: Cross-source sentiment summary explains key findings
The `get_sentiment_summary` tool SHALL aggregate source-level insights from Twitter/X, Reddit, web/news, and any available news provider into a cross-source findings summary at `details.insight`. The output SHALL include overall label, aggregate score, source coverage, key positive drivers, key negative drivers, mixed or unresolved themes, notable claims, structured confidence, and caveats.

#### Scenario: Sources broadly agree
- **WHEN** multiple available sources lean in the same direction with adequate sample sizes
- **THEN** the sentiment summary states the overall direction
- **AND** explains the main shared drivers behind that direction
- **AND** lists representative evidence from more than one source when available

#### Scenario: Sources disagree
- **WHEN** retail sources and web/news sources point in different directions
- **THEN** the sentiment summary preserves the existing divergence signal
- **AND** explains what each side is reacting to
- **AND** lowers confidence or adds caveats when the disagreement is material

#### Scenario: Uneven source confidence
- **WHEN** a high-confidence source agrees with the aggregate but another contributing source has low confidence
- **THEN** aggregate confidence is no higher than medium
- **AND** confidence reasons identify the low-confidence source and the evidence-quality issue

#### Scenario: Only one source is available
- **WHEN** only one sentiment source returns usable data
- **THEN** the sentiment summary still reports source-level findings
- **AND** source coverage and caveats clearly state that the result is not cross-source confirmation

### Requirement: Summary separates evidence from assistant synthesis
The `get_sentiment_summary` tool SHALL provide structured findings and concise markdown evidence, but it SHALL NOT produce a final buy/sell recommendation or substitute for the assistant's final synthesis. The final assistant answer SHALL use the structured findings to explain why sentiment leans bullish, bearish, neutral, or mixed.

#### Scenario: Sentiment-only prompt
- **WHEN** a user asks what social/web sentiment says about a ticker
- **THEN** the assistant final answer includes the overall read, reasons, source agreement, confidence, and caveats using `get_sentiment_summary` output
- **AND** it does not present sentiment as a standalone investment recommendation

### Requirement: Sentiment summary reports sample and representative evidence distinctions
The `get_sentiment_summary` output SHALL distinguish between the number of records that contributed to scoring and the number of representative records displayed as evidence.

#### Scenario: Preview is smaller than scoring sample
- **WHEN** 80 records contribute to the cross-source sentiment score and 8 representative items are displayed
- **THEN** the output reports the 80-record scoring sample
- **AND** labels the 8 displayed items as representative evidence

### Requirement: Answer contract requires rationale and caveats
The sentiment snapshot answer contract SHALL require final responses to include source coverage, why the result leans bullish/bearish/neutral/mixed, confidence or sample-quality caveats, and data gaps. For ticker-specific sentiment prompts, the final answer SHALL continue to include price-context divergence when quote data is available.

#### Scenario: Final answer uses insight fields
- **WHEN** the agent has sentiment insight fields from any sentiment tool
- **THEN** the final answer summarizes the top positive and negative drivers
- **AND** includes confidence or caveats
- **AND** states which sources contributed and which were missing or degraded

#### Scenario: Insight fields are missing from older cached output
- **WHEN** a tool result lacks insight fields but contains legacy score/count fields
- **THEN** the assistant still answers using the legacy fields
- **AND** it discloses that rationale detail is limited

#### Scenario: Quote unavailable for ticker sentiment prompt
- **WHEN** a ticker-specific sentiment prompt has sentiment insight but quote data is unavailable or fails
- **THEN** the final answer still explains the sentiment rationale
- **AND** it discloses that price-action divergence could not be evaluated
