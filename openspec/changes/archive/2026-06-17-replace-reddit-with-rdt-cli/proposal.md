# Replace Reddit public JSON integration with rdt-cli

## Why

OpenCandle's Reddit provider currently calls unauthenticated `www.reddit.com/...json` endpoints. Those requests now return HTTP 403 from this environment even with a User-Agent header, so `get_reddit_sentiment` and `get_sentiment_summary` often run without Reddit data. That makes Reddit appear as a configured public provider while the live tool is effectively unavailable.

Spike work found a closer match to the new Twitter external-tool pattern: `public-clis/rdt-cli` can reuse the user's existing Reddit browser session, return structured JSON, and fetch both posts and comments from a local CLI boundary. This lets OpenCandle keep Reddit as a local, user-controlled sentiment source without storing Reddit passwords or asking users to paste cookies.

## What Changes

- Replace the unauthenticated Reddit public `.json` provider path with an `rdt-cli` subprocess provider.
- Treat Reddit as an `external-tool` provider in the provider registry, not as `public-http`.
- Add Reddit external-tool first-time setup UX in TUI and GUI using the same `ask_user` pattern as Twitter: install guidance, login/session guidance, continue/retry, skip once, and always-skip choices.
- Normalize `rdt --json` envelopes into the existing `RedditSentimentResult` and `SentinelRecord` contracts, preserving comment-aware sentiment and explainable insights.
- Remove or disable direct `https://www.reddit.com/r/.../*.json` fetches as the primary runtime path.
- Keep unavailable/skip behavior: sentiment summary continues with Twitter and web/news when Reddit setup is missing or the session is stale.

## Capabilities

### New Capabilities

- None. This updates existing Reddit sentiment, provider registry, setup, and sentiment summary behavior.

### Modified Capabilities

- `reddit-comments`: changes the Reddit data source and auth source from public `.json` endpoints to `rdt-cli` using the user's supported browser session.
- `provider-registry`: changes Reddit from `public-http` to `external-tool`, with install/session probes and setup copy.
- `sentiment-summary`: clarifies Reddit degradation when the external tool or browser session is missing.
- `pi-synced-gui`: adds GUI setup/status behavior for Reddit external-tool providers and protects browser-cookie access behind explicit user action.

## Impact

- **Code:** `src/providers/reddit.ts`, a new `src/providers/reddit-cli.ts` or equivalent subprocess wrapper, provider errors/status probes, onboarding providers, TUI ask-user setup, GUI provider catalog/setup drawer, Reddit sentiment tests and fixtures.
- **Dependencies:** no runtime npm dependency is required for `rdt-cli`; users install it externally with `uv tool install rdt-cli`. Tests may add JSON fixtures under `tests/fixtures/rdt-cli/`.
- **State:** `rdt-cli` stores its own browser-derived credentials under `~/.config/rdt-cli/credential.json`. OpenCandle must not copy, log, or persist these cookies.
- **Tests:** subprocess wrapper tests, fixture adapter tests, missing-tool/session-expired `ask_user` tests, GUI catalog/status tests, sentiment summary degradation tests, CI-safe TUI/GUI tests using a mocked `rdt` spawn boundary, and local live TUI/GUI proof with `rdt-cli` installed.

## OpenSpec Ordering

This change is designed to follow the `replace-camoufox-with-twitter-cli` provider-registry work because both changes introduce external-tool provider descriptors and shared status probes. If the Twitter CLI change archives first, rebase this proposal's `provider-registry` delta against the archived baseline before archiving Reddit so only the Reddit-specific descriptor/status changes remain.

This proposal does not require `explainable-sentiment-insights` to archive first. Reddit-specific insight and evidence requirements are expressed against the current `sentiment-summary`, `reddit-comments`, and `pi-synced-gui` capabilities, and should be reconciled with the explainable-sentiment change if both remain open at implementation time.

**Status:** Researched and spike-verified on 2026-06-16.
**Target outcome:** Reddit sentiment works locally again for users with `rdt-cli` installed and a valid Reddit browser session. When unavailable, the agent clearly says Reddit is missing/degraded and continues with other sentiment sources.

---

## 1. Spike Evidence

Current OpenCandle path failed:

```bash
curl -A 'OpenCandle/1.0 (financial analysis agent)' \
  'https://www.reddit.com/r/stocks/hot.json?limit=5'
# HTTP/2 403
```

`get_reddit_sentiment` on the current provider also failed:

```text
Reddit sentiment unavailable (r/stocks: HTTP 403).
```

`rdt-cli` worked from the same machine:

```bash
uv tool install rdt-cli
~/.local/bin/rdt --version
# rdt, version 0.4.1

~/.local/bin/rdt status
# ok: true
# data.authenticated: true
# data.source: browser:subprocess

~/.local/bin/rdt search "SPCX" --json --compact -n 5
# ok: true, schema_version: "1", data: 5 posts

~/.local/bin/rdt sub stocks --json --compact -n 5
# ok: true, schema_version: "1", data: 5 posts

~/.local/bin/rdt read 1u1jsys --json -n 8
# ok: true, schema_version: "1", data: [post listing, comments listing]
```

Observed search/sub post fields include:

- `id`, `name`, `title`, `subreddit`, `author`
- `score`, `num_comments`, `created_utc`
- `permalink`, `url`, `selftext`
- `is_self`, `over_18`, `is_video`, `stickied`

Observed `read` output follows the Reddit listing shape:

- `data[0].data.children[0].data` is the post
- `data[1].data.children[]` contains `kind: "t1"` comment records
- comment fields include `id`, `author`, `score`, `body`, and permalink-like fields when present

`rdt-cli` stores credentials outside OpenCandle:

```text
~/.config/rdt-cli/credential.json 0600
~/.config/rdt-cli/index_cache.json 0600
```

OpenCandle must treat those as bearer credentials owned by `rdt-cli`.

## 2. Architecture

### 2a. Provider wrapper

Add a subprocess wrapper around `rdt` with the same hardening used for Twitter CLI:

- bounded timeout
- stdout size limit
- JSON parsing with envelope validation
- stderr redaction for cookie/session-like tokens
- typed errors for not installed, missing session, stale session, non-zero exit, malformed JSON, and empty data
- no shell interpolation; use `spawn("rdt", args)`

Suggested commands:

| Need | Command |
|---|---|
| Passive install probe | `rdt --version` |
| Explicit session probe | `rdt status` |
| Search posts | `rdt search <query> --subreddit <subreddit> --json --compact -n <limit>` when scoped, or omit `--subreddit` for global search |
| Browse subreddit | `rdt sub <subreddit> --json --compact -n <limit>` |
| Fetch comments | `rdt read <postId> --json -n <commentsPerPost>` |

The session probe may read browser cookies or `rdt-cli` credentials and must run only after explicit user action.

### 2b. Reddit provider contract

Keep the public `getSubredditPosts`, `getPostComments`, and `get_reddit_sentiment` behavior where possible, but change the transport:

- `getSubredditPosts(subreddit, limit)` calls `rdt sub`.
- query-aware sentiment calls use `rdt search <query> --subreddit <subreddit>` (short form `-r`) instead of fetching hot posts then substring filtering.
- `getPostComments(subreddit, postId, limit)` calls `rdt read`.
- adapters normalize `rdt` post/comment shapes into the existing `RedditSentimentResult` and `SentinelRecord` fields.

OpenCandle should not keep a fallback to unauthenticated Reddit `.json` endpoints unless explicitly marked as best-effort and tested to avoid repeated 403 loops. The default runtime path should be `rdt-cli`.

### 2c. Setup UX

Reddit setup should mirror Twitter's external-tool onboarding:

- passive provider catalog polling checks installation only (`rdt --version`)
- explicit session check runs `rdt status` and warns about browser-cookie/Keychain access
- first-time missing-tool flow uses Pi `ask_user` to show `uv tool install rdt-cli`, then offers:
  - continue after install, which retries the same Reddit provider call once
  - skip Reddit once for the current turn
  - always skip Reddit sentiment until the user re-enables it from provider setup or `opencandle doctor`
- installed-but-not-logged-in flow uses `ask_user` to show `rdt login` and explain that it reuses the user's supported browser session, then offers:
  - continue after login, which retries the same Reddit provider call once
  - skip Reddit once for the current turn
  - always skip Reddit sentiment until the user re-enables it from provider setup or `opencandle doctor`
- GUI setup drawer mirrors the same two-stage flow: install check first, explicit session/login check second, with no passive cookie reads

## 3. Risks And Constraints

- Browser cookies are bearer credentials. OpenCandle must never ask users to paste cookies, print cookies, or copy `~/.config/rdt-cli/credential.json`.
- `rdt-cli` is reverse-engineered and can break if Reddit changes its web/session behavior.
- Official Reddit OAuth remains the cleaner durable option. This change should not block a future OAuth provider; it only replaces the broken public `.json` path.
- Reddit results can be joke-heavy, meme-heavy, or dominated by a single subreddit. Existing insight caveats remain required.

## 4. Rollout Plan

1. Add `rdt-cli` fixtures and a hardened subprocess wrapper.
2. Switch Reddit provider reads from public `.json` endpoints to wrapper calls.
3. Add provider registry/status/setup UX for Reddit as `external-tool`.
4. Update sentiment summary degradation and GUI rendering tests.
5. Add scripted TUI harness coverage for missing install, missing login/session, skip, continue/retry, and successful Reddit sentiment.
6. Add GUI browser coverage for setup drawer install/session states and a real chat prompt that uses Reddit sentiment.
7. Run CI-safe end-to-end tests with a mocked `rdt` executable at the spawn boundary.
8. Run local live proof with `rdt-cli`: TUI harness and GUI browser prompts that invoke Twitter, Reddit, and web sentiment and show final synthesis.
