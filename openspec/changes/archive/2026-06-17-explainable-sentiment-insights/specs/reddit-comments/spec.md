## ADDED Requirements

### Requirement: Reddit sentiment explains post and comment themes
The `get_reddit_sentiment` tool SHALL return `details.insight` for Reddit posts and fetched comments in addition to existing post, comment, score, and trend output. When the tool details payload uses `RedditSentimentResult`, that type SHALL gain an additive `insight: SentimentInsight` property while preserving existing fields. The insight SHALL identify positive, negative, and mixed themes using post titles, post bodies, top comments, matched sentiment evidence, subreddit metadata, and engagement.

#### Scenario: Comments change the sentiment read
- **WHEN** post titles are neutral but top comments contain recurring bullish or bearish evidence
- **THEN** the Reddit insight explains the comment-driven theme
- **AND** representative items identify whether the evidence came from a post or comment

#### Scenario: Posts and comments disagree
- **WHEN** posts lean bullish but top comments lean bearish, or the reverse
- **THEN** the insight includes mixed drivers
- **AND** caveats disclose disagreement between post-level and comment-level evidence

#### Scenario: Comment-driven insight does not change cross-source divergence math
- **WHEN** comments drive a Reddit insight theme but the cross-source divergence calculation excludes comments
- **THEN** the Reddit insight may cite comment-driven drivers and representative comments
- **AND** the per-source score used for cross-source divergence remains aligned with the existing post-level divergence rule unless a separate divergence-spec change modifies that behavior

### Requirement: Reddit insight handles cross-subreddit coverage
The `get_reddit_sentiment` tool SHALL disclose which subreddits contributed records, which subreddits returned no usable records, and whether results were filtered by query. Cross-subreddit aggregation SHALL avoid presenting one subreddit as representative of all Reddit discussion.

#### Scenario: Default subreddit search
- **WHEN** `get_reddit_sentiment` searches the default subreddit list for a ticker
- **THEN** the insight source coverage lists contributing subreddits and per-subreddit record counts
- **AND** caveats list searched subreddits with no matching records when applicable

#### Scenario: One subreddit dominates results
- **WHEN** most records come from a single subreddit
- **THEN** caveats disclose subreddit concentration
- **AND** confidence reflects that concentration

### Requirement: Reddit representative discussions are auditable
Representative Reddit items SHALL include post/comment type, subreddit, title or excerpt, URL/permalink, author when available, score, comment count or parent id when available, sentiment score, and matched driver metadata when available.

#### Scenario: Representative comment included
- **WHEN** a top comment contributes to a bullish or bearish driver
- **THEN** the representative item identifies it as a comment
- **AND** it links back to the parent discussion when a permalink is available

### Requirement: Reddit confidence and caveats
The `get_reddit_sentiment` tool SHALL include confidence and caveats for Reddit-specific risks including low matching post count, comment-fetch failures, subreddit concentration, stale cached listings, deleted/removed content, and meme or joke-heavy discussion.

#### Scenario: Comment fetch partially fails
- **WHEN** comments fail to fetch for some high-engagement posts but posts still return
- **THEN** Reddit sentiment still returns available post-level insight
- **AND** caveats disclose partial comment coverage
