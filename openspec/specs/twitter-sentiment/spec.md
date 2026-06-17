# Twitter Sentiment Specification

## Purpose
TBD - normalized from existing baseline requirements.
## Requirements
### Requirement: Fetch Twitter sentiment via scraper library

The system SHALL accept a stock ticker symbol or search query and return recent X/Twitter posts by invoking the external `twitter` CLI installed from `public-clis/twitter-cli`. OpenCandle SHALL request JSON output, parse the CLI envelope, adapt returned posts into the existing `TwitterSentimentResult` shape, and preserve existing query normalization, engagement-weighted sentiment scoring, co-mentioned cashtag extraction, cache, rate-limit, and stale-cache behavior. OpenCandle SHALL NOT use Camoufox, `@the-convocation/twitter-scraper`, or an OpenCandle-managed Firefox profile for this provider after this migration.

The CLI JSON fixture contract SHALL include an envelope `{ ok: boolean, schema_version: string, data: RawTweet[], error?: { code: string, message: string } }`. `RawTweet` SHALL allow the observed twitter-cli tweet fields needed by OpenCandle: id, text, author or username, URL, created timestamp, likes, retweets, replies, and views. The adapter SHALL tolerate equivalent camelCase/snake_case metric names found in fixture outputs.

#### Scenario: Successful search with active browser session

- **WHEN** user requests Twitter sentiment for ticker `AAPL`
- **AND** `twitter-cli` is installed and can read a valid X session from the user's supported browser
- **THEN** the provider invokes `twitter search "$AAPL" --max <limit> --json` or equivalent
- **AND** it returns a `TwitterSentimentResult` with tweets, sentiment score, bullish/bearish counts, top mentions, and `fetchedAt`

#### Scenario: External tool is not installed

- **WHEN** the provider attempts to spawn `twitter`
- **AND** the executable is not on `PATH`
- **THEN** the provider throws a typed external-tool-not-installed error containing the install command `uv tool install twitter-cli`
- **AND** tool/UI setup flows can recognize the failure without parsing arbitrary stderr
- **AND** the error is not a subclass of `ProviderCredentialError`

#### Scenario: Browser session is missing

- **WHEN** `twitter-cli` reports that no usable X/Twitter browser cookies or session were found
- **THEN** OpenCandle surfaces a recoverable setup message asking the user to log into x.com in a supported browser
- **AND** it does not suggest `/twitter-login`

#### Scenario: Browser session is stale or rejected

- **WHEN** `twitter-cli` returns a 401, empty authenticated result, or equivalent stale-session error
- **THEN** OpenCandle surfaces a recoverable setup message asking the user to refresh or re-login to x.com
- **AND** stale cached Twitter sentiment may be used when available within `STALE_LIMIT.SENTIMENT`

#### Scenario: Subprocess output is redacted

- **WHEN** `twitter-cli` writes stderr or malformed output containing cookie-looking values such as `auth_token` or `ct0`
- **THEN** any logged, surfaced, or stored error text redacts those values before leaving the provider wrapper

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

The system SHALL cache Twitter sentiment results using `TTL.SENTIMENT` and fall back to stale cache within `STALE_LIMIT.SENTIMENT` on provider failure. The system SHALL use `rateLimiter` for Twitter search requests even though the data is fetched through an external CLI subprocess.

#### Scenario: Repeated query within TTL

- **WHEN** the same query is requested twice within the sentiment TTL
- **THEN** the second request SHALL return cached data without spawning `twitter`

#### Scenario: Provider failure with stale cache

- **WHEN** `twitter-cli` fails but a cached result exists within the stale-cache window
- **THEN** the system SHALL return the stale cached data with stale-data disclosure

### Requirement: TwitterSentimentResult type
The system SHALL define a `TwitterSentimentResult` interface in `src/types/sentiment.ts` containing: `query` (string), `tweetCount` (number), `tweets` (array of tweet objects with `text`, `author`, `likes`, `retweets`, `replies`, `views` (nullable), `url`, `created`), `sentimentScore` (number), `bullishCount` (number), `bearishCount` (number), `topMentions` (string array of co-mentioned tickers), and `fetchedAt` (ISO string).

#### Scenario: Full result
- **WHEN** tweets are successfully fetched
- **THEN** all fields are populated and `tweetCount` matches the length of the `tweets` array

### Requirement: Twitter CLI External-Tool Onboarding

OpenCandle SHALL treat Twitter sentiment as an external-tool provider. When a chat turn needs X/Twitter data and the external tool or browser session is unavailable, the TUI and GUI SHALL guide the user through setup, allow skipping X for the current query, and allow persistently skipping X sentiment. Setup guidance SHALL be diagnostic and reversible; OpenCandle SHALL NOT run system-level installers automatically by default.

#### Scenario: TUI prompts for missing twitter-cli

- **WHEN** a TUI turn needs Twitter sentiment and spawning `twitter` fails with `ENOENT`
- **THEN** OpenCandle uses Pi `ask_user` to show the install command and choices to continue after install, skip X once, or always skip X

#### Scenario: TUI retries after user continues

- **WHEN** the user selects continue after installing `twitter-cli`
- **THEN** OpenCandle retries the Twitter sentiment provider once for the same query

#### Scenario: GUI setup separates install and session checks

- **WHEN** the user opens the GUI setup drawer for X sentiment
- **THEN** passive polling checks only whether the `twitter` executable is installed
- **AND** any browser-cookie/session smoke test is run only after an explicit user action that warns about possible Keychain or browser-cookie prompts

#### Scenario: GUI shows inline degradation

- **WHEN** a GUI chat turn would have used X sentiment but Twitter setup is incomplete
- **THEN** the assistant turn includes a small inline degradation banner with retry and skip actions

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
