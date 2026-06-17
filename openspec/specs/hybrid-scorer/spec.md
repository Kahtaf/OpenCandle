# Hybrid Scorer Specification

## Purpose
TBD - normalized from existing baseline requirements.

## Requirements

### Requirement: Keyword-only sentiment scoring (v1)
The system SHALL score SentinelRecords using engagement-weighted keyword matching. LLM-based scoring is deferred to a future change that adds runtime LLM access for tools.

#### Scenario: Tool scores without LLM access
- **WHEN** sentiment records are scored in a runtime without LLM access for tools
- **THEN** the scorer uses keyword matching and engagement weighting
- **AND** it does not attempt an LLM call

### Requirement: Keyword scoring with engagement weighting
The scorer SHALL compute keyword sentiment using shared bullish/bearish term lists from `src/sentiment/keywords.ts`. Each term match SHALL be weighted by engagement: `weight = count × (1 + engagement.score)`. The final score SHALL be `(bullishWeight - bearishWeight) / (bullishWeight + bearishWeight)`, clamped to [-1.0, +1.0].

#### Scenario: High-engagement bearish tweet
- **WHEN** a tweet contains 1 bearish term with 500 likes and 3 bullish tweets have 100 total likes
- **THEN** the aggregate score skews bearish despite bullish count majority

#### Scenario: No keywords matched
- **WHEN** a record contains no bullish or bearish terms
- **THEN** score is 0.0, confidence is 0.0 (lowest)

### Requirement: Confidence calculation
The scorer SHALL compute confidence based on: (a) number of keyword matches (more matches = higher confidence), (b) text length (longer text with matches = higher confidence), (c) source type (Twitter records get a 0.1 confidence penalty due to brevity and sarcasm density). Low-confidence records are surfaced as-is — the agent applies its own judgment per `AGENTS.md:76`.

#### Scenario: Short tweet with one keyword
- **WHEN** a 30-character tweet contains "bullish"
- **THEN** confidence is low due to short text and single keyword

#### Scenario: Long Reddit post with multiple keywords
- **WHEN** a 500-character Reddit post contains "undervalued", "buying the dip", "long-term hold"
- **THEN** confidence is high due to multiple keywords and text length

### Requirement: Shared keyword lists
The scorer SHALL use a single shared source of bullish/bearish keywords in `src/sentiment/keywords.ts`, imported by the scorer and by the existing Twitter and Reddit providers for backward compatibility.

#### Scenario: Keyword list update
- **WHEN** a new bullish term is added to the shared list
- **THEN** Twitter, Reddit, and the keyword scorer all use the updated term

### Requirement: Ticker extraction
The scorer SHALL extract ticker symbols from record text using the cashtag regex pattern (`$[A-Z]{1,5}`) consistent with existing extraction in `src/providers/twitter.ts:142` and `src/providers/reddit.ts:42`. Extracted tickers are stored in `sentiment.tickers`.

#### Scenario: Tweet with cashtags
- **WHEN** a tweet contains "$AAPL is going to moon, also watching $TSLA"
- **THEN** `sentiment.tickers` contains `["AAPL", "TSLA"]`

### Requirement: Batch scoring
The scorer SHALL accept an array of SentinelRecords and return them with sentiment fields populated. This is a synchronous, CPU-only operation (no I/O).

#### Scenario: Batch of 50 records
- **WHEN** 50 records are passed to `scoreRecords()`
- **THEN** all 50 are returned with score, confidence, method "keyword", and tickers populated
