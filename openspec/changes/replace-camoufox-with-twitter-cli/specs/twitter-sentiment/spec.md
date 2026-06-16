## MODIFIED Requirements

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

### Requirement: Caching and rate limiting

The system SHALL cache Twitter sentiment results using `TTL.SENTIMENT` and fall back to stale cache within `STALE_LIMIT.SENTIMENT` on provider failure. The system SHALL use `rateLimiter` for Twitter search requests even though the data is fetched through an external CLI subprocess.

#### Scenario: Repeated query within TTL

- **WHEN** the same query is requested twice within the sentiment TTL
- **THEN** the second request SHALL return cached data without spawning `twitter`

#### Scenario: Provider failure with stale cache

- **WHEN** `twitter-cli` fails but a cached result exists within the stale-cache window
- **THEN** the system SHALL return the stale cached data with stale-data disclosure

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: `/twitter-login` Pi command

OpenCandle SHALL no longer provide a `/twitter-login` command that launches Camoufox for X/Twitter authentication. User authentication for X sentiment is delegated to the user's normal browser session as consumed by `twitter-cli`.

#### Scenario: Old login command is absent

- **WHEN** OpenCandle registers Pi commands and interaction tools
- **THEN** no `/twitter-login` command or `trigger_twitter_login` tool is registered
- **AND** user-facing setup copy points to browser login plus `twitter-cli`, not Camoufox

### Requirement: Cookie extraction from Firefox profile

OpenCandle SHALL no longer read X/Twitter cookies directly from `~/.opencandle/browser-profile/cookies.sqlite` for Twitter sentiment. The provider SHALL not depend on an OpenCandle-owned Firefox profile or `better-sqlite3` cookie extraction for X/Twitter auth.

#### Scenario: OpenCandle-managed profile is ignored

- **WHEN** `~/.opencandle/browser-profile/cookies.sqlite` contains old X/Twitter cookies
- **THEN** the Twitter sentiment provider does not read or trust those cookies directly
- **AND** session availability is determined by `twitter-cli` and the user's supported browser session
