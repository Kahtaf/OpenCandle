## ADDED Requirements

### Requirement: Fetch Reddit comments for deeper sentiment signal
The system SHALL fetch the top N comments (default 5, by score) for each Reddit post when performing sentiment analysis via the Reddit adapter. Each comment becomes its own `SentinelRecord` with `metadata.isComment: true` and `metadata.parentId` linking to the parent post.

#### Scenario: Post with active discussion
- **WHEN** the Reddit adapter fetches a post with 200 comments
- **THEN** the top 5 comments by score are fetched and mapped to SentinelRecords

#### Scenario: Post with no comments
- **WHEN** a post has 0 comments
- **THEN** no comment fetch is attempted; only the post itself is mapped

### Requirement: Comment fetching via Reddit JSON API
The system SHALL fetch comments from `https://www.reddit.com/r/{subreddit}/comments/{postId}.json`. It SHALL use `rateLimiter.acquire("reddit_comments")` before each request and cache results with a 30-minute TTL (longer than post listings, since discussions evolve slower).

#### Scenario: Cached comments
- **WHEN** comments for a post were fetched 15 minutes ago
- **THEN** cached comments are returned without a new HTTP request

#### Scenario: Rate limiting
- **WHEN** 25 posts need comment fetching
- **THEN** requests are paced by the `reddit_comments` rate limiter bucket (10 tokens, 0.5 tokens/sec)

### Requirement: Cross-subreddit aggregation
The Reddit adapter SHALL support searching multiple subreddits in a single query. When no specific subreddit is provided, it SHALL fetch from a default list: r/wallstreetbets, r/stocks, r/investing, r/options. Results SHALL be deduplicated by post ID (crossposts appear in multiple subreddits).

#### Scenario: Default subreddit list
- **WHEN** `get_reddit_sentiment` is called with `query: "NVDA"` and no subreddit specified
- **THEN** all four default subreddits are searched and results are merged

#### Scenario: Duplicate post across subreddits
- **WHEN** the same post appears in r/stocks and r/investing (crosspost)
- **THEN** only one SentinelRecord is created, using the version with higher engagement

### Requirement: Comment text included in sentiment scoring
Comments SHALL be scored by the hybrid scorer alongside post titles and bodies. Comment text typically carries stronger sentiment signal than post titles, especially for neutral-titled discussion threads.

#### Scenario: Neutral title, bearish comments
- **WHEN** a post titled "NVDA earnings thread" has top comments saying "this guidance is terrible" and "selling my position"
- **THEN** the post-level SentinelRecord may score neutral, but the comment-level SentinelRecords score bearish, contributing to the aggregate

## MODIFIED Requirements

### Requirement: get_reddit_discussions removed
The existing `get_reddit_discussions` tool SHALL be removed from the tool registry. Its functionality (searching r/stocks + r/investing) is subsumed by the enhanced `get_reddit_sentiment` with cross-subreddit aggregation and actual sentiment scoring.

#### Scenario: Agent previously used get_reddit_discussions
- **WHEN** the system prompt previously referenced `get_reddit_discussions`
- **THEN** it is replaced by guidance to use `get_reddit_sentiment` with no subreddit param for cross-subreddit search
