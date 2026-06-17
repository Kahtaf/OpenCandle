# Reddit Comments Specification

## Purpose
TBD - normalized from existing baseline requirements.
## Requirements
### Requirement: Fetch Reddit comments for deeper sentiment signal
The system SHALL fetch the top N comments (default from `config.sentiment.commentsPerPost`, fallback 5, by score) for the **top 10 posts by score** when performing sentiment analysis via the Reddit adapter. Posts outside the top 10 do not get comment fetching. Each comment becomes its own `SentinelRecord` with `metadata.isComment: true` and `metadata.parentId` linking to the parent post.

#### Scenario: Post with active discussion
- **WHEN** the Reddit adapter fetches a top-10 post with 200 comments
- **THEN** the top 5 comments by score are fetched and mapped to SentinelRecords

#### Scenario: Post with no comments
- **WHEN** a post has 0 comments
- **THEN** no comment fetch is attempted; only the post itself is mapped

### Requirement: Comment fetching via Reddit JSON API

The system SHALL fetch Reddit comments through the configured Reddit provider transport. After this migration, the primary transport SHALL be `rdt-cli` via `rdt read <postId> --json -n <limit>`, using the user's existing Reddit browser session as managed by `rdt-cli`. OpenCandle SHALL parse the returned Reddit listing envelope, map top-level `kind: "t1"` comment records into `RedditComment`, use `rateLimiter.acquire("reddit_comments")` before each uncached comment request, and cache results with a 30-minute TTL.

OpenCandle SHALL NOT use unauthenticated `https://www.reddit.com/r/{subreddit}/comments/{postId}.json` public endpoints as the primary runtime path for comment fetching.

#### Scenario: Cached comments

- **WHEN** comments for a post were fetched 15 minutes ago
- **THEN** cached comments are returned without spawning `rdt`

#### Scenario: Rate limiting

- **WHEN** 10 high-engagement posts need comment fetching
- **THEN** requests are paced by the `reddit_comments` rate limiter bucket

#### Scenario: rdt read returns post and comments listing

- **WHEN** `rdt read <postId> --json -n 5` returns an envelope with post listing data and a comment listing
- **THEN** OpenCandle maps `kind: "t1"` comment children into `RedditComment` records
- **AND** ignores non-comment children such as `more` records unless a future change implements expansion

### Requirement: Provider extensions for comment support

The Reddit provider (`src/providers/reddit.ts`) SHALL expose post and comment fields required by the sentiment pipeline while delegating live Reddit access to `rdt-cli`. The provider SHALL:

- expose `id`, `author`, and `selftext` fields from `rdt` post results
- expose `score`, `num_comments`, `permalink`, `url`, and `created_utc` from `rdt` post results
- implement `getPostComments(subreddit, postId, limit)` through `rdt read`
- preserve the `reddit` and `reddit_comments` rate limiter buckets
- preserve existing cache and stale-cache behavior

#### Scenario: Extended listing response

- **WHEN** `getSubredditPosts` is called and `rdt sub` or `rdt search` succeeds
- **THEN** each post in the result includes `id`, `author`, and `selftext` in addition to existing fields

#### Scenario: rdt binary missing

- **WHEN** the Reddit provider attempts to spawn `rdt`
- **AND** the executable is not on `PATH`
- **THEN** the provider throws a typed external-tool-not-installed error with install command `uv tool install rdt-cli`
- **AND** setup flows can handle the failure without parsing arbitrary stderr

### Requirement: Cross-subreddit aggregation

The Reddit adapter SHALL support searching multiple subreddits in a single query. When no specific subreddit is provided, it SHALL use the configured default list (`config.sentiment.defaultSubreddits`, default: r/wallstreetbets, r/stocks, r/investing, r/options). Results SHALL be deduplicated by post ID.

When a query is provided, OpenCandle SHALL prefer `rdt search <query> --subreddit <subreddit> --json --compact -n <limit>` for each subreddit instead of fetching only hot posts and filtering locally. The short `-r` flag MAY be used only as the equivalent form of `--subreddit`. When no query is provided, OpenCandle SHALL use `rdt sub <subreddit> --json --compact -n <limit>`.

#### Scenario: Default subreddit list

- **WHEN** `get_reddit_sentiment` is called with `query: "NVDA"` and no subreddit specified
- **THEN** all default subreddits are searched with `rdt search <query> --subreddit <subreddit> --json --compact -n <limit>`
- **AND** results are merged and deduplicated

#### Scenario: Duplicate post across subreddits

- **WHEN** the same post appears in multiple subreddit result sets
- **THEN** only one SentinelRecord is created, using the version with higher engagement

### Requirement: Topic filtering

The Reddit adapter SHALL support a `query` parameter that filters Reddit discussion relevance. With `rdt-cli`, OpenCandle SHALL prefer Reddit-side search through `rdt search` for query-bearing requests. OpenCandle MAY retain a local relevance filter as a defensive post-filter, but it SHALL NOT rely only on hot-listing substring filtering when `rdt search` is available.

#### Scenario: Topic query

- **WHEN** `get_reddit_sentiment` is called with `query: "NVDA"` and `subreddits: ["stocks", "investing"]`
- **THEN** OpenCandle searches each subreddit with `rdt search <query> --subreddit <subreddit> --json --compact -n <limit>`
- **AND** only posts returned for that query are included in the merged result unless a defensive local filter removes irrelevant records

#### Scenario: Public endpoint returns 403

- **WHEN** `https://www.reddit.com/r/stocks/hot.json` returns HTTP 403
- **THEN** Reddit sentiment is not considered broken if `rdt-cli` is installed and can fetch equivalent Reddit data
- **AND** provider diagnostics point to `rdt-cli` install/session status rather than public HTTP reachability

### Requirement: Comment text included in sentiment scoring
Comments SHALL be scored by the keyword scorer alongside post titles and bodies. Comment text typically carries stronger sentiment signal than post titles, especially for neutral-titled discussion threads.

#### Scenario: Neutral title, bearish comments
- **WHEN** a post titled "NVDA earnings thread" has top comments saying "this guidance is terrible" and "selling my position"
- **THEN** the post-level SentinelRecord may score neutral, but the comment-level SentinelRecords score bearish, contributing to the aggregate

### Requirement: Reddit sentiment uses rdt-cli external tool

The `get_reddit_sentiment` tool SHALL use `rdt-cli` as the primary live Reddit data source. OpenCandle SHALL invoke `rdt` as a subprocess with argument arrays, request JSON output, parse the `{ ok, schema_version, data, error? }` envelope, normalize posts and comments into existing Reddit sentiment types, and preserve scoring, trend, insight, cache, and stale-cache behavior.

OpenCandle SHALL not ask users to paste cookies or Reddit credentials. Browser-session access is delegated to `rdt-cli`.

#### Scenario: Successful query with active browser session

- **WHEN** a user requests Reddit sentiment for ticker `SPCX`
- **AND** `rdt-cli` is installed and authenticated from the user's supported browser session
- **THEN** OpenCandle invokes `rdt search "SPCX" --json --compact -n <limit>` for the configured subreddit scope
- **AND** returns a `RedditSentimentResult` with posts, comments when fetched, sentiment score, bullish/bearish counts, top mentions, and `fetchedAt`

#### Scenario: Browser session is missing

- **WHEN** `rdt status` or a Reddit data command reports no usable Reddit session
- **THEN** OpenCandle surfaces a recoverable setup message asking the user to run `rdt login` or log into Reddit in a supported browser
- **AND** sentiment summary may continue without Reddit

#### Scenario: Subprocess output is redacted

- **WHEN** `rdt-cli` writes stderr or malformed output containing cookie-looking values or credential file details
- **THEN** any logged, surfaced, or stored error text redacts those values before leaving the provider wrapper

### Requirement: Reddit CLI External-Tool Onboarding

OpenCandle SHALL treat Reddit sentiment as an external-tool provider. When a chat turn needs Reddit data and the external tool or browser session is unavailable, the TUI and GUI SHALL guide the user through setup, allow skipping Reddit for the current query, and allow persistently skipping Reddit sentiment. Setup guidance SHALL be diagnostic and reversible; OpenCandle SHALL NOT run system-level installers automatically by default.

#### Scenario: TUI prompts for missing rdt-cli

- **WHEN** a TUI turn needs Reddit sentiment and spawning `rdt` fails with `ENOENT`
- **THEN** OpenCandle uses Pi `ask_user` to show the install command `uv tool install rdt-cli`
- **AND** offers choices to continue after install, skip Reddit once, or always skip Reddit

#### Scenario: TUI retries after install

- **WHEN** the user selects continue after installing `rdt-cli`
- **THEN** OpenCandle retries the same Reddit sentiment provider request once
- **AND** the current turn continues with Reddit data if the retry succeeds

#### Scenario: TUI prompts for missing Reddit session

- **WHEN** `rdt` is installed but the Reddit browser session is missing or stale
- **THEN** OpenCandle uses Pi `ask_user` to ask the user to run `rdt login` or refresh their Reddit browser login
- **AND** offers choices to continue after login, skip Reddit once, or always skip Reddit

#### Scenario: TUI retries after login

- **WHEN** the user selects continue after running `rdt login` or refreshing their Reddit browser login
- **THEN** OpenCandle retries the same Reddit sentiment provider request once
- **AND** the current turn continues with Reddit data if the retry succeeds

#### Scenario: TUI skip choices continue the turn

- **WHEN** the user chooses skip Reddit once or always skip Reddit
- **THEN** the current turn continues without Reddit sentiment
- **AND** the final answer or tool output discloses that Reddit was skipped or unavailable

#### Scenario: Always skip can be reversed

- **WHEN** the user chooses always skip Reddit
- **THEN** OpenCandle stores the preference in OpenCandle provider setup/preferences state rather than in `rdt-cli`
- **AND** the GUI setup surface, TUI setup surface, or `opencandle doctor` offers a way to re-enable Reddit sentiment

#### Scenario: GUI setup separates install and session checks

- **WHEN** the user opens the GUI setup drawer for Reddit sentiment
- **THEN** passive polling checks only whether the `rdt` executable is installed
- **AND** any browser-cookie/session status check runs only after an explicit user action that warns about possible Keychain or browser-cookie prompts

### Requirement: Reddit sentiment is covered by TUI harness and GUI browser tests

The Reddit `rdt-cli` migration SHALL include end-to-end coverage in both the scripted TUI harness and the real GUI browser flow. These tests SHALL exercise first-time setup and successful data retrieval paths rather than only unit-testing the wrapper.

CI-safe tests SHALL inject or prepend a fixture-backed `rdt` executable at the subprocess boundary. Local live proof before push SHALL use a real `rdt-cli` installation and authenticated Reddit session.

#### Scenario: TUI harness covers first-time setup

- **WHEN** `rdt` is missing from `PATH`
- **THEN** the TUI harness test observes an `ask_user` prompt with install guidance
- **AND** answers skip or continue through the harness IPC to verify the turn settles

#### Scenario: TUI harness covers successful Reddit sentiment

- **WHEN** the TUI harness uses a fixture-backed `rdt` executable or a local live authenticated `rdt-cli` environment
- **THEN** the TUI harness run invokes `get_reddit_sentiment`
- **AND** the trace includes Reddit posts or comments plus a final synthesized answer

#### Scenario: GUI browser covers setup and success

- **WHEN** the GUI is opened in a real browser during verification
- **THEN** the provider setup drawer shows Reddit install/session states
- **AND** a chat prompt can invoke Reddit sentiment and render the final synthesized result

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

## REMOVED

### get_reddit_discussions removed entirely
The `get_reddit_discussions` tool (`src/tools/sentiment/news-sentiment.ts`) SHALL be deleted. The file, its import in `src/tools/index.ts`, and all references in `src/system-prompt.ts`, `src/prompts/context-builder.ts`, `src/analysts/orchestrator.ts`, and `tests/e2e/audit-fixes.test.ts` SHALL be removed. The project is unreleased — no deprecation path is needed.

Its functionality (searching r/stocks + r/investing for topic-relevant posts) is fully absorbed by the enhanced `get_reddit_sentiment` with `query` param and cross-subreddit aggregation, plus actual sentiment scoring that the old tool lacked.
