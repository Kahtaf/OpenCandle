## ADDED Requirements

### Requirement: Fetch Twitter sentiment via scraper library
The system SHALL accept a stock ticker symbol or search query and return recent tweets using `@the-convocation/twitter-scraper` authenticated with cookies extracted from the shared Firefox profile at `~/.opencandle/browser-profile/cookies.sqlite`.

#### Scenario: Successful search with active session
- **WHEN** user requests Twitter sentiment for ticker `AAPL` and valid auth cookies (`auth_token`, `ct0`) exist in the Firefox profile
- **THEN** the provider extracts cookies, passes them to the scraper, calls `searchTweets("$AAPL", limit, SearchMode.Latest)`, filters by time window, and returns a `TwitterSentimentResult`

#### Scenario: No session exists
- **WHEN** no auth cookies exist in the Firefox profile
- **THEN** the provider throws an error with message indicating login is required. The tool catches this via `wrapProvider("twitter", ...)` and returns `content: "⚠ Twitter sentiment unavailable (Twitter login required. Run /twitter-login to authenticate.)"`, `details: null`

#### Scenario: Session expired mid-request
- **WHEN** the scraper's `isLoggedIn()` returns false after setting cookies
- **THEN** the provider throws an error indicating session expired. The tool catches this via `wrapProvider` and surfaces the message

### Requirement: `/twitter-login` Pi command
The system SHALL register a `/twitter-login` command via `pi.registerCommand()` that launches Camoufox in headful mode with stealth options (`geoip: true`, `humanize: true`, `block_webrtc: true`, `os: "macos"`, `user_data_dir: ~/.opencandle/browser-profile/`) and navigates to `https://x.com/login`. The command waits for auth cookies to appear, then closes the browser and reports success.

#### Scenario: User completes login
- **WHEN** user runs `/twitter-login` and completes authentication in the Camoufox window
- **THEN** the system detects auth cookies (`auth_token`, `ct0`, `twid`) via `context.cookies()`, reports success, and closes the browser

#### Scenario: User closes browser without logging in
- **WHEN** the user closes the Camoufox window before completing login
- **THEN** the command reports that login was cancelled

#### Scenario: Non-interactive context (IPC harness)
- **WHEN** `/twitter-login` is invoked in a non-interactive context where `ctx.hasUI` is false
- **THEN** the command reports that interactive login requires a terminal session

### Requirement: Query normalization
The tool SHALL normalize the `query` parameter: if the input matches a bare ticker pattern (`/^[A-Z]{1,5}$/`), prepend `$` to search as a cashtag. Otherwise pass the query through unchanged.

#### Scenario: Bare ticker input
- **WHEN** user passes `query: "AAPL"`
- **THEN** the system searches for `"$AAPL"`

#### Scenario: Cashtag input
- **WHEN** user passes `query: "$TSLA"`
- **THEN** the system searches for `"$TSLA"` (no double-prefix)

#### Scenario: Free-form query
- **WHEN** user passes `query: "AAPL earnings call"`
- **THEN** the system searches for `"AAPL earnings call"` unchanged

### Requirement: Cookie extraction from Firefox profile
The system SHALL read Twitter auth cookies from the Firefox profile's `cookies.sqlite` database using `better-sqlite3`. It SHALL query `moz_cookies` for cookies matching `x.com` and `twitter.com` domains.

#### Scenario: Cookies present in both domains
- **WHEN** auth cookies exist on both `.x.com` and `.twitter.com` domains
- **THEN** the system collects cookies from both domains and passes them to the scraper

#### Scenario: No cookies in profile
- **WHEN** `cookies.sqlite` exists but contains no Twitter auth cookies
- **THEN** the provider throws with a message directing the user to `/twitter-login`

### Requirement: Sentiment scoring with engagement weighting
The system SHALL compute a sentiment score from -1.0 (fully bearish) to +1.0 (fully bullish) using term-based matching consistent with the Reddit sentiment approach. Each tweet's contribution to the aggregate score SHALL be weighted by its engagement (likes + retweets).

#### Scenario: Mixed sentiment with varying engagement
- **WHEN** 3 bullish tweets have 100 total likes and 1 bearish tweet has 500 likes
- **THEN** the aggregate score reflects engagement weighting, skewing bearish despite bullish tweet count majority

#### Scenario: No sentiment signal
- **WHEN** fetched tweets contain no bullish or bearish terms
- **THEN** the sentiment score SHALL be 0.0 (neutral) and bullishCount and bearishCount SHALL both be 0

### Requirement: Tool parameters and return shape
The `get_twitter_sentiment` tool SHALL accept a required `query` parameter (ticker or search term) and optional `limit` (default 50, max 200) and `hours` (default 24, lookback window) parameters. It SHALL return `content` (human-readable markdown) and `details` (typed `TwitterSentimentResult`).

#### Scenario: Default parameters
- **WHEN** user calls `get_twitter_sentiment` with only `query: "AAPL"`
- **THEN** the system searches for up to 50 tweets from the last 24 hours

#### Scenario: Custom parameters
- **WHEN** user calls with `query: "TSLA"`, `limit: 100`, `hours: 48`
- **THEN** the system searches for up to 100 tweets from the last 48 hours

### Requirement: Caching and rate limiting
The system SHALL cache Twitter sentiment results using `TTL.SENTIMENT` (5 minutes) and fall back to stale cache within `STALE_LIMIT.SENTIMENT` (1 hour) on provider failure. The system SHALL use `rateLimiter` for Twitter search requests.

#### Scenario: Repeated query within TTL
- **WHEN** the same query is requested twice within 5 minutes
- **THEN** the second request SHALL return cached data without making an API call

#### Scenario: Provider failure with stale cache
- **WHEN** the scraper fails but a cached result exists from 30 minutes ago
- **THEN** the system SHALL return the stale cached data with a staleness warning

### Requirement: TwitterSentimentResult type
The system SHALL define a `TwitterSentimentResult` interface in `src/types/sentiment.ts` containing: `query` (string), `tweetCount` (number), `tweets` (array of tweet objects with `text`, `author`, `likes`, `retweets`, `replies`, `views` (nullable), `url`, `created`), `sentimentScore` (number), `bullishCount` (number), `bearishCount` (number), `topMentions` (string array of co-mentioned tickers), and `fetchedAt` (ISO string).

#### Scenario: Full result
- **WHEN** tweets are successfully fetched
- **THEN** all fields are populated and `tweetCount` matches the length of the `tweets` array
