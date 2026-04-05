## Context

OpenCandle has a working Reddit sentiment pipeline. Twitter/X is the other major real-time sentiment source but is heavily defended against scraping — Twitter enforces a cryptographic `x-client-transaction-id` header on GraphQL API calls that changes per-request.

POC testing revealed:
- **Camoufox DOM scraping fails**: Twitter's SearchTimeline GraphQL API returns 404 from Camoufox. The browser's fingerprint injection breaks `x-client-transaction-id` generation in Twitter's client JS. Home timeline works, search does not.
- **Camoufox login works**: Interactive login via headful Camoufox with `user_data_dir`, `geoip`, `humanize`, and `block_webrtc` successfully authenticates. Session persists in the Firefox profile.
- **`@the-convocation/twitter-scraper` search works**: Extracting `auth_token` + `ct0` cookies from the Firefox profile's `cookies.sqlite` and passing them to the scraper library successfully returns search results with full engagement data.

## Goals / Non-Goals

**Goals:**
- Fetch tweets for a stock ticker via Twitter's search API with engagement data
- One-time interactive login via Camoufox, triggered by a `/twitter-login` Pi command
- Tool works non-interactively: reads cookies, calls scraper, returns result or "unavailable"
- Engagement-weighted sentiment scoring matching the Reddit tool's interface

**Non-Goals:**
- External addon package DX validation (this is a core in-tree tool using `createTool` for helper validation only)
- DOM-based browser scraping (proven unreliable)
- Official Twitter API or third-party API services
- Real-time streaming, posting, or write operations
- NLP/LLM-based sentiment analysis (keep term-based; LLM layer synthesizes)

## Decisions

### 1. Login as a Pi command, not embedded in the tool

**Choice**: The interactive Camoufox login flow is a `/twitter-login` Pi command registered via `pi.registerCommand()`, following the same pattern as `/setup`. The `get_twitter_sentiment` tool never launches a browser or prompts the user.

**Why**: `AgentTool.execute()` only receives `toolCallId`, params, signal, and `onUpdate` — it has no access to `ctx.ui` or browser launch capability. The `ask_user` tool uses `ctx` via raw Pi registration, not the `AgentTool` adapter. Embedding login in the tool would require changing the adapter contract. Additionally, OpenCandle runs through an IPC test harness where launching a headful browser would hang.

**How**: The provider throws on missing/expired session (same as all other providers). The tool wraps the provider call with `wrapProvider("twitter", ...)` which converts exceptions into structured `ProviderResult` with status `"unavailable"`. The tool then formats the reason into user-facing output (e.g., `"⚠ Twitter sentiment unavailable (Twitter login required. Run /twitter-login to authenticate.)"`). This follows the exact same pattern as `reddit-sentiment.ts` → `wrapProvider("reddit", ...)`.

### 2. Hybrid architecture: Camoufox login + twitter-scraper search

**Choice**: Use Camoufox exclusively for the interactive login flow. Use `@the-convocation/twitter-scraper` for all search API calls.

**Why**: POC proved Camoufox cannot make SearchTimeline API calls (404 due to broken `x-client-transaction-id`), but its login flow works reliably. The scraper library handles all the GraphQL header complexity.

**How**:
1. `/twitter-login` command launches Camoufox headful with `user_data_dir: ~/.opencandle/browser-profile/` + stealth options
2. User logs in manually. Auth cookies persist in Firefox's `cookies.sqlite`
3. Tool reads cookies from `cookies.sqlite` via `better-sqlite3`
4. Cookies passed to `Scraper.setCookies()` for authenticated search

### 3. Query normalization rules

**Choice**: The tool accepts a `query` parameter. If it looks like a bare ticker (1-5 uppercase letters), prepend `$` to search as a cashtag. Otherwise pass the query through as-is.

**Why**: Twitter cashtag search (`$AAPL`) returns more relevant financial tweets than bare ticker search (`AAPL`). But users may also pass free-form queries like `"AAPL earnings call"` or `"inflation fears"` which should not be modified.

**Rule**: `if (/^[A-Z]{1,5}$/.test(query)) query = "$" + query`

### 4. Shared browser profile directory

**Choice**: Use `~/.opencandle/browser-profile/` as a shared Camoufox profile for all authenticated browsing.

**Why**: Avoids per-provider profile proliferation. Future providers needing browser auth can reuse the same profile.

### 5. Core tool registration, not addon

**Choice**: Register in `getAllTools()` in `src/tools/index.ts`. Use `createTool()` to construct the tool (validates metadata), but don't use `registerTools()` or the addon registry.

**Why**: This is a core sentiment capability. The addon registry (`registerTools()` + npm package auto-discovery) is designed for external packages. Pretending this is an addon would test a different path than what it actually is. `createTool()` is still exercised, validating the helper for all tool authors.

### 6. Sentiment scoring: same approach as Reddit, with engagement weighting

**Choice**: Reuse bullish/bearish term matching. Weight each tweet's contribution by engagement (likes + retweets).

**Why**: Consistency with Reddit tool. The scraper returns rich engagement data.

## Risks / Trade-offs

- **Scraper library breaks on Twitter API changes** → Mitigation: Actively maintained (v0.22.3), tracks `x-client-transaction-id` changes. Pin version, monitor releases.
- **Twitter session expires** → Mitigation: `isLoggedIn()` check, structured "unavailable" response pointing to `/twitter-login`. Stale cache fallback within 1hr.
- **Camoufox login blocked ("suspicious activity")** → Mitigation: `geoip: true`, `humanize: true`, `block_webrtc: true`. User uses their own account from their own IP.
- **Non-interactive contexts (IPC harness, headless)** → Mitigation: Tool never launches browsers. Returns structured "unavailable" with instructions. Login is a separate explicit user action.
