## ADDED Requirements

### Requirement: Twitter sentiment explains score rationale
The `get_twitter_sentiment` tool SHALL return `details.insight` for the fetched X/Twitter sample in addition to the existing `TwitterSentimentResult` fields. The `TwitterSentimentResult` tool-details payload SHALL gain an additive `insight: SentimentInsight` property while preserving the existing `query`, `tweetCount`, `tweets`, `sentimentScore`, `bullishCount`, `bearishCount`, `topMentions`, and `fetchedAt` fields. The insight SHALL identify why the sample is bullish, bearish, neutral, or mixed using matched terms, recurring claims, engagement-weighted records, co-mentioned tickers, and representative tweets.

#### Scenario: Bullish Twitter sample
- **WHEN** recent tweets for a ticker contain recurring bullish terms and positive price-action claims
- **THEN** the tool output includes positive drivers explaining the bullish signal
- **AND** representative tweets include excerpts that contributed to those drivers

#### Scenario: Bearish Twitter sample
- **WHEN** recent tweets contain recurring bearish terms, valuation criticism, downside claims, or risk language
- **THEN** the tool output includes negative drivers explaining the bearish signal
- **AND** representative tweets include excerpts that contributed to those drivers

#### Scenario: Neutral or mixed Twitter sample
- **WHEN** bullish and bearish evidence is balanced or sparse
- **THEN** the tool labels the result neutral or mixed
- **AND** the caveats explain whether the score is weak because of offsetting evidence, sparse matches, or a low sample count

### Requirement: Twitter insight preserves sample auditability
The `get_twitter_sentiment` result SHALL disclose the full sample size used for scoring and separately cap the number of representative tweets shown in tool output. Tool output SHALL NOT imply that the representative tweet count is the scoring sample size.

#### Scenario: Representative output shows fewer tweets than scored sample
- **WHEN** the provider scores 50 tweets and the tool output displays 5 representative tweets
- **THEN** the tool discloses that 50 tweets contributed to the score
- **AND** the 5 displayed tweets are labeled as representative items, not the full sample

### Requirement: Twitter confidence and caveats
The `get_twitter_sentiment` tool SHALL include confidence and caveats for Twitter-specific quality risks such as low sample size, stale cached data, engagement concentration, missing browser session, unavailable external tool, and noisy social chatter.

#### Scenario: Engagement concentration
- **WHEN** a small number of tweets dominate engagement-weighted scoring
- **THEN** the insight caveats mention engagement concentration
- **AND** confidence is lower than an otherwise similar broad-based sample

#### Scenario: Stale cached Twitter data
- **WHEN** Twitter sentiment is served from stale cache
- **THEN** the insight caveats disclose stale data
- **AND** representative tweets preserve their original timestamps
