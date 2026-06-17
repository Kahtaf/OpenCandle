## ADDED Requirements

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
