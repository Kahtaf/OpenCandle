## 1. rdt-cli Provider Wrapper

- [x] 1.1 Add `tests/fixtures/rdt-cli/` fixtures for `search`, `sub`, `read`, `status ok`, `status unauthenticated`, non-zero stderr, and malformed JSON.
- [x] 1.2 Add a hardened `rdt` subprocess wrapper with timeout, stdout limit, JSON envelope validation, no shell interpolation, cookie/session redaction, and an injectable/resolvable binary path for tests.
- [x] 1.3 Add typed external-tool errors for missing `rdt`, missing/stale Reddit session, non-zero exit, malformed JSON, and envelope errors.
- [x] 1.4 Add unit tests for wrapper success/failure cases and redaction.
- [x] 1.5 Verify the implemented search command uses the real `rdt search <query> --subreddit <subreddit> --json --compact -n <limit>` contract, with `-r` accepted only as the equivalent short form.

## 2. Reddit Provider Migration

- [x] 2.1 Replace `getSubredditPosts()` transport with `rdt sub` when no query is present and `rdt search` when query/subreddit search is requested.
- [x] 2.2 Replace `getPostComments()` transport with `rdt read` comment extraction.
- [x] 2.3 Preserve existing `RedditSentimentResult`, `RedditComment`, cache, rate-limit, stale-cache, and sentiment pipeline behavior.
- [x] 2.4 Prefer server-side `rdt search` for topic/ticker queries, then dedupe across subreddits by post id.
- [x] 2.5 Remove or disable the unauthenticated Reddit public `.json` path as the primary runtime path.

## 3. Setup, Provider Registry, And Diagnostics

- [x] 3.1 Change the Reddit provider descriptor from `public-http` to `external-tool` with `binary: "rdt"` and install command `uv tool install rdt-cli`.
- [x] 3.2 Add passive install probe support for `rdt --version`.
- [x] 3.3 Add explicit session probe support for `rdt status`; do not run it from passive catalog polling.
- [x] 3.4 Add first-time TUI `ask_user` flow for missing `rdt`: show `uv tool install rdt-cli`, offer Continue after install, Skip Reddit once, and Always skip Reddit.
- [x] 3.5 Add TUI `ask_user` flow for installed-but-not-logged-in or stale session: show `rdt login`, explain supported browser-session reuse, offer Continue after login, Skip Reddit once, and Always skip Reddit.
- [x] 3.6 Ensure Continue retries the same Reddit provider request once after install/login, and Skip once/Always skip let the current sentiment turn continue without Reddit.
- [x] 3.7 Add GUI catalog/setup drawer copy and actions for Reddit external-tool install and explicit session check.
- [x] 3.8 Add GUI setup drawer states for missing `rdt`, installed-but-not-logged-in, session OK, skipped once, and always skipped.
- [x] 3.9 Update `opencandle doctor` output for Reddit external-tool install/session modes.
- [x] 3.10 Store Always skip in OpenCandle provider setup/preferences state, show the skip in TUI/GUI/doctor readiness, and provide a re-enable action from provider setup or `opencandle doctor`.
- [x] 3.11 Rebase provider-registry deltas after `replace-camoufox-with-twitter-cli` archives, or merge the Reddit descriptor/status changes into the same provider-registry baseline before archiving.

## 4. Sentiment UX And Summary Behavior

- [x] 4.1 Update `get_reddit_sentiment` text and details to disclose `rdt-cli` setup/session failures cleanly.
- [x] 4.2 Ensure Reddit post/comment insights still show source coverage, drivers, caveats, and representative discussions after the transport change.
- [x] 4.3 Update `get_sentiment_summary` tests so Reddit unavailable because of missing `rdt` or stale session is reported as a source gap while Twitter/web continue.
- [x] 4.4 Ensure GUI sentiment cards render normalized `rdt` Reddit posts/comments without leaking credential paths or raw stderr.

## 5. Verification

- [x] 5.1 Run `openspec validate replace-reddit-with-rdt-cli --strict`.
- [x] 5.2 Run focused unit tests for Reddit provider, rdt wrapper, provider registry/status, sentiment summary, and setup flows.
- [x] 5.3 Run `npm test`.
- [x] 5.4 Run `graphify update .`.
- [x] 5.5 Run TUI harness tests for missing `rdt` first-time setup, missing/stale Reddit session setup, skip once, always skip, continue/retry, and successful Reddit sentiment.
- [x] 5.6 Run GUI browser tests for provider setup drawer install/session states and explicit session-check behavior.
- [x] 5.7 Run CI-safe TUI and GUI tests with a mocked fixture-backed `rdt` executable at the spawn boundary; these tests must not require a real Reddit login.
- [x] 5.8 Before push, run live local TUI harness proof with real `rdt-cli` installed and authenticated, showing Reddit sentiment plus final synthesis.
- [x] 5.9 Before push, run live GUI browser proof with real `rdt-cli` installed and authenticated, showing Reddit sentiment, all relevant tool calls, and final synthesis.
