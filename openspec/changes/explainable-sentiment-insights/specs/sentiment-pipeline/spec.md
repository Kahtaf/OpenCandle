## ADDED Requirements

### Requirement: Shared explainable sentiment insight contract
The sentiment pipeline SHALL expose a shared insight contract for source-level and aggregate sentiment findings. Sentiment tool details payloads SHALL attach the insight at `details.insight` while preserving existing legacy fields at their current paths. The `SentimentInsight` contract SHALL include: `label`, `score`, `sampleSize`, `scoredSampleSize`, `confidence`, `positiveDrivers`, `negativeDrivers`, `mixedDrivers`, `notableClaims`, `representativeItems`, `sourceCoverage`, `caveats`, and `method`.

`confidence` SHALL use the shape `{ level: "low" | "medium" | "high"; score: number; reasons: string[] }`, where `score` is a normalized value from 0 to 1. `method` SHALL be a discriminator from a registered insight-method set. The first registered method SHALL be `"deterministic-keyword-v1"`, but callers SHALL NOT assume it is the only valid method.

`representativeItems` SHALL preserve enough source metadata for auditability, including source, title or text excerpt, URL when available, author/source name when available, published timestamp when available, engagement when available, score, and matched terms or driver ids when available.

#### Scenario: Source records produce a typed insight
- **WHEN** the pipeline receives scored Twitter, Reddit, or web records for a query
- **THEN** it returns a source insight at `details.insight` with sample counts, score label, structured confidence, drivers, representative items, caveats, and a registered `method` discriminator

#### Scenario: Insight fields are additive
- **WHEN** existing callers read sentiment result fields such as score, count, records, trend, or divergence
- **THEN** those fields remain available and unchanged
- **AND** the explainable insight data is available as additional structured metadata

### Requirement: Driver extraction from scorer evidence
The sentiment pipeline SHALL derive positive, negative, and mixed drivers from scorer evidence and record metadata rather than from unsupported model inference. Driver extraction SHALL consider matched bullish/bearish terms, repeated phrases, record titles/snippets/text, engagement, freshness, and source type.

#### Scenario: Matched terms explain a bullish score
- **WHEN** multiple records contain bullish terms such as "beat", "guidance raise", or "breakout"
- **THEN** the resulting positive drivers identify those recurring reasons
- **AND** representative items reference records that contributed to the drivers

#### Scenario: Mixed evidence is preserved
- **WHEN** records contain both bullish and bearish matched evidence
- **THEN** the insight includes separate positive and negative drivers
- **AND** the label and caveats disclose that sentiment is mixed when the score is close to neutral or source agreement is weak

### Requirement: Insight output caps are deterministic
The sentiment pipeline SHALL cap insight output sizes deterministically. Unless overridden by `config.sentiment`, a source insight SHALL include at most 3 drivers per polarity, at most 5 representative items, and at most 5 notable claims. An aggregate insight SHALL include at most 3 drivers per polarity, at most 8 representative items, and at most 8 notable claims. The full scoring sample size SHALL remain available as `sampleSize` even when representative output is capped.

#### Scenario: Source insight exceeds display caps
- **WHEN** a source has 20 candidate positive drivers and 50 candidate representative items
- **THEN** the insight returns the highest-ranked capped drivers and representative items
- **AND** `sampleSize` still reports the full scored source sample

#### Scenario: Config overrides caps
- **WHEN** `config.sentiment.maxInsightDriversPerPolarity` or `config.sentiment.maxRepresentativeItemsPerSource` is configured
- **THEN** the pipeline uses those configured limits consistently across Twitter, Reddit, and web insights

### Requirement: Confidence reflects evidence quality
The pipeline SHALL compute confidence from evidence quality, including sample size, scored sample ratio, freshness, source coverage, agreement across records or sources, and engagement concentration. Confidence SHALL NOT be a direct mapping from score magnitude alone. Low-sample thresholds SHALL use `config.sentiment.minUsefulSampleSize` with a default of 10 records unless source-specific configuration overrides it.

#### Scenario: Small sample downgrades confidence
- **WHEN** a source returns fewer than the configured minimum useful sample size
- **THEN** the insight confidence is downgraded
- **AND** caveats include a low-sample warning

#### Scenario: High score with sparse matches remains low confidence
- **WHEN** a source has a high absolute score but only a small fraction of records contain matched sentiment evidence
- **THEN** confidence reflects the sparse scored sample
- **AND** caveats explain that most items were neutral or unscored

#### Scenario: Aggregate confidence combines uneven sources
- **WHEN** one source has high-confidence evidence and another available source has low-sample or sparse-match evidence
- **THEN** aggregate confidence is no higher than medium
- **AND** confidence reasons identify which source downgraded the aggregate

### Requirement: Untrusted source text is not executable instruction
The pipeline and tools SHALL treat tweets, posts, comments, headlines, snippets, and article text as untrusted content. Insight extraction SHALL NOT follow instructions contained in source text. Rendered excerpts, extracted driver labels, and notable claims derived from third-party source text SHALL use existing untrusted-content safeguards before they enter assistant-visible context or GUI rendering.

#### Scenario: Prompt injection text appears in a source item
- **WHEN** a tweet, Reddit post, comment, headline, or snippet contains instruction-like text
- **THEN** OpenCandle treats it only as source evidence
- **AND** it does not alter tool behavior, system prompts, or final-answer policy

#### Scenario: Extracted claim contains instruction-like source text
- **WHEN** a notable claim or driver label is derived from source text containing instruction-like content
- **THEN** the extracted claim is labeled or delimited as untrusted source evidence
- **AND** the assistant treats it as content to analyze, not as an instruction to follow
