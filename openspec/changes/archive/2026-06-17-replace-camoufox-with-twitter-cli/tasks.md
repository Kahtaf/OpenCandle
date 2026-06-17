## 1. Yahoo Options Fallback

- [x] 1.1 Add `yahoo-finance2` and a focused adapter for options-chain fallback output.
- [x] 1.2 Replace only the `StealthBrowser.run` fallback in `src/providers/yahoo-finance.ts`; preserve the existing primary raw fetch, crumb retry, cache key, stale-cache behavior, and `OptionsChain` return shape.
- [x] 1.3 Replace browser-fallback unit tests with tests that mock `yahoo-finance2.options()` for direct-fetch failure, crumb failure, stale-cache fallback, and final failure messaging.
- [x] 1.4 Add an e2e provider test for a real `yahoo-finance2.options("SPY")` call, skipped or separately gated if live provider tests are disabled.

## 2. Provider Registry And Diagnostics

- [x] 2.1 Expand `ProviderDescriptor` to a discriminated union for `api-key`, `external-tool`, and `public-http` providers.
- [x] 2.2 Add provider entries for `twitter` as `external-tool`, and `yahoo` / `reddit` as `public-http`, while preserving existing API-key provider setup behavior.
- [x] 2.3 Generalize credential helpers so API-key helpers reject or ignore non-API-key providers intentionally rather than destructuring missing `envVar` fields.
- [x] 2.4 Add status probes with 60 s TTL and a shared response shape. Passive probes use `--version` or public reachability only; cookie-reading Twitter smoke runs only from explicit setup/re-check actions.
- [x] 2.5 Wire the same serialized provider status into the GUI catalog and `opencandle doctor`.

## 3. Twitter CLI Provider

- [x] 3.1 Add `src/providers/twitter-cli.ts` subprocess wrapper with timeout, stdout size limit, JSON envelope validation, stderr/cookie redaction, and typed `ExternalToolNotInstalled` / `ExternalToolError` failures as siblings, not subclasses, of `ProviderCredentialError`.
- [x] 3.2 Rewrite `src/providers/twitter.ts` to call `twitter-cli.ts`, preserve `getTwitterSentiment`, `normalizeQuery`, `scoreTwitterSentiment`, cache/rate-limit/stale-cache behavior, and remove direct Firefox cookie extraction.
- [x] 3.3 Update `src/sentiment/adapters/twitter.ts` only as needed to map the twitter-cli tweet shape into the existing `TwitterSentimentResult` / `TwitterTweet` contract.
- [x] 3.4 Add fixtures under `tests/fixtures/twitter-cli/` with a documented envelope/tweet shape and unit tests for installed, not-installed, non-zero, malformed JSON, empty data, no-cookies, and 401/session-expired cases.

## 4. TUI And GUI Setup UX

- [x] 4.1 Replace `/twitter-login` registration with lazy external-tool onboarding through Pi `ask_user` when X sentiment needs `twitter-cli`.
- [x] 4.2 Add `ENOENT`, no-cookie, and 401/session-expired ask-user flows with Continue, Skip once, and Always skip choices.
- [x] 4.3 Add GUI catalog rows/builders for `external-tool` and `public-http` provider kinds without API-key inputs; the external-tool row includes copyable install command, install status, explicit session-check action, last checked timestamp, and retry/skip actions.
- [x] 4.4 Add GUI setup drawer install polling that does not read cookies passively, plus an explicit X-session smoke action that warns about Keychain/browser-cookie access.
- [x] 4.5 Add inline GUI degradation banner for X sentiment failures with retry/skip actions.

## 5. Camoufox And Runtime Dependency Removal

- [x] 5.1 Delete `src/tools/interaction/twitter-login.ts` after the Twitter CLI path is proven.
- [x] 5.2 Delete `src/infra/browser.ts` and `src/infra/index.ts` browser exports after no runtime imports remain.
- [x] 5.3 Remove `camoufox-js` and `@the-convocation/twitter-scraper` from runtime dependencies.
- [x] 5.4 Confirm `tests/e2e/gui-browser.test.ts` and `tests/screenshots/capture.ts` use `playwright-core` as dev/test-only tooling, or migrate them in a separate test-harness change before removing `playwright-core`.
- [x] 5.5 Update README, first-run docs, getting-started docs, and CHANGELOG with the new X setup and the production install-footprint change.

## 6. Verification

- [x] 6.1 Run `openspec validate replace-camoufox-with-twitter-cli --strict`.
- [x] 6.2 Run focused unit tests for Yahoo options, Twitter provider, provider registry, tool metadata, and setup flows.
- [x] 6.3 Run `npm test`.
- [x] 6.4 Run `graphify update .`.
- [x] 6.5 Before any push, exercise a live local runtime path: options-chain query for a real symbol, TUI X-sentiment missing-tool flow, GUI catalog provider rows, and explicit Twitter re-check flow when `twitter-cli` is available.
