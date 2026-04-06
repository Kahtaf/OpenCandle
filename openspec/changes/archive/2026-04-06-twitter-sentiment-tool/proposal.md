## Why

OpenCandle has Reddit sentiment but no Twitter/X coverage — the platform where most real-time stock discourse happens. Building this also exercises `createTool` from the extension framework, though as a core in-tree tool (not as an external addon package).

## What Changes

- Add a Twitter sentiment provider (`src/providers/twitter.ts`) using a hybrid approach: Camoufox for interactive login + `@the-convocation/twitter-scraper` for search API calls
- Add a `/twitter-login` Pi command in `src/pi/opencandle-extension.ts` for the interactive Camoufox login flow (separate from the tool — follows the `/setup` pattern)
- Add a `get_twitter_sentiment` tool in `src/tools/sentiment/` as a core tool registered in `getAllTools()`
- The tool never prompts or launches browsers — it reads cookies from the Firefox profile and returns "unavailable" if no session exists
- Add `TwitterSentimentResult` type to `src/types/sentiment.ts`
- Wire rate-limiter config and cache TTLs for the new provider
- New dependency: `@the-convocation/twitter-scraper`

## Capabilities

### New Capabilities

- `twitter-sentiment`: Fetch and score Twitter/X posts for a given stock ticker or search query, returning engagement-weighted sentiment with bullish/bearish breakdown — mirroring the Reddit sentiment tool's interface.

### Modified Capabilities

_(none)_

## Impact

- **New files**: provider, tool, test, fixture
- **Modified files**: `src/types/sentiment.ts` (new interface), `src/tools/index.ts` (register tool), `src/pi/opencandle-extension.ts` (register `/twitter-login` command)
- **New dependency**: `@the-convocation/twitter-scraper`
- **Dependencies**: User's own Twitter/X account (login once via `/twitter-login`). No API keys.
- **Risk**: Twitter rotates GraphQL anti-bot headers; the scraper library tracks these. Session cookies may expire requiring re-login via `/twitter-login`.
