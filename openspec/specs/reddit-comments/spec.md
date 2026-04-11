## ADDED Requirements

### Requirement: Fetch Reddit comments for deeper sentiment signal
The system SHALL fetch the top N comments (default from `config.sentiment.commentsPerPost`, fallback 5, by score) for the **top 10 posts by score** when performing sentiment analysis via the Reddit adapter. Posts outside the top 10 do not get comment fetching. Each comment becomes its own `SentinelRecord` with `metadata.isComment: true` and `metadata.parentId` linking to the parent post.

#### Scenario: Post with active discussion
- **WHEN** the Reddit adapter fetches a top-10 post with 200 comments
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
- **WHEN** 10 high-engagement posts need comment fetching
- **THEN** requests are paced by the `reddit_comments` rate limiter bucket

### Requirement: Provider extensions for comment support
The Reddit provider (`src/providers/reddit.ts`) SHALL be extended to:
- Expose `id`, `author`, and `selftext` fields from the listing response (currently only returns title, score, num_comments, permalink, created_utc)
- Add a new `getPostComments(subreddit, postId, limit)` function
- Add `reddit` and `reddit_comments` rate limiter buckets (Reddit currently has no rate limiting)

#### Scenario: Extended listing response
- **WHEN** `getSubredditPosts` is called
- **THEN** each post in the result includes `id`, `author`, and `selftext` in addition to existing fields

### Requirement: Cross-subreddit aggregation
The Reddit adapter SHALL support searching multiple subreddits in a single query. When no specific subreddit is provided, it SHALL fetch from the configured default list (`config.sentiment.defaultSubreddits`, default: r/wallstreetbets, r/stocks, r/investing, r/options). Results SHALL be deduplicated by post ID (crossposts appear in multiple subreddits).

#### Scenario: Default subreddit list
- **WHEN** `get_reddit_sentiment` is called with `query: "NVDA"` and no subreddit specified
- **THEN** all default subreddits are searched and results are merged

#### Scenario: Duplicate post across subreddits
- **WHEN** the same post appears in r/stocks and r/investing (crosspost)
- **THEN** only one SentinelRecord is created, using the version with higher engagement

### Requirement: Topic filtering
The Reddit adapter SHALL support a `query` parameter that filters posts by title and selftext relevance (case-insensitive substring match). This absorbs the functionality of the removed `get_reddit_discussions` tool.

#### Scenario: Topic query
- **WHEN** `get_reddit_sentiment` is called with `query: "NVDA"` and `subreddits: ["stocks", "investing"]`
- **THEN** only posts mentioning "NVDA" in title or selftext are included in results

### Requirement: Comment text included in sentiment scoring
Comments SHALL be scored by the keyword scorer alongside post titles and bodies. Comment text typically carries stronger sentiment signal than post titles, especially for neutral-titled discussion threads.

#### Scenario: Neutral title, bearish comments
- **WHEN** a post titled "NVDA earnings thread" has top comments saying "this guidance is terrible" and "selling my position"
- **THEN** the post-level SentinelRecord may score neutral, but the comment-level SentinelRecords score bearish, contributing to the aggregate

## REMOVED

### get_reddit_discussions removed entirely
The `get_reddit_discussions` tool (`src/tools/sentiment/news-sentiment.ts`) SHALL be deleted. The file, its import in `src/tools/index.ts`, and all references in `src/system-prompt.ts`, `src/prompts/context-builder.ts`, `src/analysts/orchestrator.ts`, and `tests/e2e/audit-fixes.test.ts` SHALL be removed. The project is unreleased — no deprecation path is needed.

Its functionality (searching r/stocks + r/investing for topic-relevant posts) is fully absorbed by the enhanced `get_reddit_sentiment` with `query` param and cross-subreddit aggregation, plus actual sentiment scoring that the old tool lacked.
