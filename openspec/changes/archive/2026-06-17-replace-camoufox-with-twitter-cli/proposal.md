# Replace Camoufox with twitter-cli + yahoo-finance2

## Why

OpenCandle currently depends on Camoufox for X login and Yahoo options fallback, which pulls a large browser runtime into the production install and keeps X authentication tied to an OpenCandle-managed browser profile. Spike work found smaller replacements: `twitter-cli` can reuse the user's normal browser session for X sentiment, and `yahoo-finance2` can replace the Yahoo options browser fallback.

## What Changes

- Replace X/Twitter sentiment fetching with a `twitter-cli` subprocess wrapper while preserving the existing `getTwitterSentiment` contract.
- Replace only the Yahoo options Camoufox fallback with a `yahoo-finance2` fallback; keep the existing primary raw Yahoo fetch path unless a future OpenSpec change explicitly replaces it.
- Expand provider descriptors to cover API-key providers, external tools, and public HTTP providers.
- Add shared provider status probes for the GUI catalog and `opencandle doctor`, with passive probes that do not read browser cookies.
- Remove Camoufox and the old Twitter scraper from runtime dependencies after their call sites are gone.
- Keep Playwright-based GUI/screenshot test tooling separate from production runtime dependency claims.

## Capabilities

### New Capabilities

- None. This change updates existing provider, sentiment, and setup capabilities.

### Modified Capabilities

- `twitter-sentiment`: changes the X/Twitter data source, auth source, and setup flow from Camoufox + scraper library to `twitter-cli`.
- `provider-registry`: changes provider descriptors and readiness reporting to support API-key, external-tool, and public HTTP providers.

## Impact

- **Code:** `src/providers/yahoo-finance.ts`, `src/providers/twitter.ts`, new `src/providers/twitter-cli.ts`, provider errors, onboarding/provider registry, Pi setup flow, GUI catalog/status surfaces, docs.
- **Dependencies:** add `yahoo-finance2`; remove runtime `camoufox-js` and `@the-convocation/twitter-scraper`; decide separately whether `playwright-core` remains dev/test-only.
- **Tests:** Yahoo options fallback tests, Twitter CLI subprocess tests, provider registry/status tests, TUI onboarding tests, GUI catalog/setup tests, and live smoke checks before push.

**Status:** Researched and spike-verified. Ready for implementation after the spec deltas in this change validate.
**Target outcome:** Delete Camoufox from OpenCandle's runtime path. The production package ships no Camoufox/browser binary dependency for X sentiment or Yahoo options. X sentiment + Yahoo options keep working. `playwright-core` is removed only if GUI/screenshot test harnesses are migrated first; otherwise it remains test-only/dev-only.

---

## 1. TL;DR

OC currently uses Camoufox (a ~Firefox-sized headless stealth browser) for three things:

1. `src/tools/interaction/twitter-login.ts` — capture X login cookies interactively.
2. `src/providers/yahoo-finance.ts::fetchOptionsViaBrowser` (the single `StealthBrowser.run` call site) — TLS-fingerprint fallback for the options-chain JSON endpoint.
3. `src/infra/browser.ts` — generic singleton, currently unused by anything else.

Replace with:

| Concern | Replacement | Status |
|---|---|---|
| X tweet reading + auth cookie source | **`public-clis/twitter-cli`** (Python; install via `uv tool install twitter-cli`); OC subprocess + JSON envelope | Spike-verified: clean structured output, auto-extracts cookies from user's Chrome |
| Yahoo options chain | **`gadicc/yahoo-finance2`** v3.15.x | Spike-verified: NVDA + SPY chains fetched directly, no TLS impersonation needed from this IP |
| Future Yahoo TLS fallback (deferred) | **`lexiforest/impers`** wired as `_opts.fetch` on `yahoo-finance2` only if Yahoo starts blocking | Not implemented in this change; do not add a hook yet |
| Browser cookie reads (any future use) | **`@rookie-rs/api`** (Rust NAPI binding, Chrome focus v1) or **`steipete/sweet-cookie`** (pure TS, Node 22+) | Spike-verified for rookie; sweet-cookie not yet spiked |

Camoufox stays in the repo until **PR 3** lands and X is proven through `twitter-cli` in real use. **PR 4** is the deletion PR.

---

## 2. What was researched and ruled out

These were considered and rejected during research; do not re-evaluate without new information.

- **`Rishikant181/Rettiwt-API`** (Node) — spiked, fails with HTTP 401 from this machine. Root cause: its built-in `x-client-transaction-id` provider scrapes `x.com/` via plain `axios`, which gets a Cloudflare challenge instead of the real HTML on non-residential IPs. Fixable in theory by replacing its `tidProvider`; not worth it given a working alternative exists.
- **`jpoindexter/x-native`** (pure-TS, zero-deps) — spiked, `refreshQueryIds` succeeds but `SearchTimeline` returns 404 because scraped query IDs lag a build behind the live API. The README's workaround is for the user to pin IDs from DevTools (`X_NATIVE_QID_SEARCHTIMELINE=...`), which breaks "drop in." Keep on the watch list as a possible pure-Node fallback if user wants no Python dep.
- **`d60/twikit`, `vladkens/twscrape`** — Python; twscrape uses `curl_cffi` and would be a viable alternative to twitter-cli, but offers no advantage over `public-clis/twitter-cli` for OC's read-only sentiment use case.
- **`elizaOS/agent-twitter-client`** — deprecated on npm; original repo gone.
- **Roll our own browser-extension bridge (OpenCLI-style) or own MV3 extension** — rejected by user as overscoped. Use existing tools.
- **Official X API ($0.005/read)** — viable but not chosen for v1. Worth wiring later behind `ProviderCredentialError` as an opt-in credentialed tier.
- **Chrome CDP attach to user's running Chrome** — structurally dead. Chrome 136 (May 2025) silently disables `--remote-debugging-port` on the default profile.

---

## 3. Spike evidence (do not re-spike unless something changes)

Run from `/tmp/oc-spike-1781419251/` (now safe to `rm -rf`; cookie JSONs were deleted at end of session).

| Spike | Tool | Result | Evidence |
|---|---|---|---|
| 1 | `@rookie-rs/api` reads Chrome cookies | PASS | Extracted `auth_token` (40 ch), `ct0` (160 ch), `twid`, `kdt`, `guest_id` for x.com; `A1`, `A3`, `GUC`, `PRF` for yahoo.com. macOS Keychain prompt did not block on this machine (already trusted from prior reads). Expiries far future. |
| 2 | `Rettiwt-API` v7.0.3 with extracted cookies | FAIL — 401 | Rettiwt's own debug log: `AUTHORIZATION authenticated:true`, `GET USER_CREDENTIAL` OK, then X returned 401. Caused by `axios.get('https://x.com')` homepage scrape returning a Cloudflare challenge instead of the real HTML. |
| 3 | `yahoo-finance2` v3.15.3 options chain | PASS | `new YahooFinance().options("NVDA")` returned 22 expirations, 49 calls × 34 puts on front month with bid/ask/IV. SPY returned 31 expirations, 116 × 113. No TLS impersonation needed. |
| 4a | `public-clis/twitter-cli` v0.8.5 via `uv tool install` | PASS | `twitter search "NVDA" --max 5 --json` returned a `{ok, schema_version, data}` envelope with full author objects, 6 engagement metrics, 3 createdAt formats, media arrays, quoted-tweet expansion. Tweets were real and current. Auto-extracted Chrome cookies; handled TID natively. |
| 4b | `jpoindexter/x-native` from source | PARTIAL | `refreshQueryIds` populated 157 ops including `SearchTimeline`, but `searchTimeline()` returned HTTP 404 — scraped ID was one X web build behind live. |

---

## 4. Architecture (per leg)

### 4a. Yahoo Finance

Replace the single `StealthBrowser.run` call site in `src/providers/yahoo-finance.ts` (`fetchOptionsViaBrowser`, ~line 605–630) with a direct `yahoo-finance2` fallback. Do **not** replace the primary raw Yahoo fetch as part of this change; keep its cache, crumb retry, stale-cache behavior, and parsing contract intact. The change is: when the primary raw fetch still fails, call `yahoo-finance2` instead of Camoufox.

```ts
// src/providers/yahoo-finance.ts
import YahooFinance from "yahoo-finance2";

let _yf: YahooFinance | null = null;
function yf() {
  if (!_yf) _yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
  return _yf;
}

// Replace fetchOptionsViaBrowser entirely; called only from the existing fallback branch.
async function fetchOptionsViaYahooFinance2(symbol: string, expiration?: number) {
  return yf().options(symbol, expiration ? { date: new Date(expiration * 1000) } : undefined);
}
```

The rest of `yahoo-finance.ts` (quote, history, fundamentals, primary options fetch) is **unchanged**. Only the options-fallback path moves.

Defer cycletls integration. If Yahoo later starts blocking, wire `lexiforest/impers` into `yahoo-finance2`'s `_opts.fetch` override; do not pre-build that.

### 4b. X / Twitter

Add a new provider that subprocesses `twitter` (the CLI installed by `uv tool install twitter-cli`).

```ts
// src/providers/twitter-cli.ts (new)
import { spawn } from "node:child_process";
import type { Tweet } from "../types/sentiment.js"; // existing OC type

interface TwitterCliEnvelope<T> {
  ok: boolean;
  schema_version: string;
  data: T;
  error?: { code: string; message: string };
}

interface RawTweet {
  id?: string;
  text?: string;
  author?: { username?: string; screenName?: string; name?: string };
  username?: string;
  url?: string;
  createdAt?: string | number;
  created_at?: string | number;
  likeCount?: number;
  likes?: number;
  retweetCount?: number;
  retweets?: number;
  replyCount?: number;
  replies?: number;
  viewCount?: number | null;
  views?: number | null;
}

export async function searchTweets(query: string, max = 20): Promise<Tweet[]> {
  const env = await runTwitterCli<TwitterCliEnvelope<RawTweet[]>>([
    "search", query, "--max", String(max), "--json",
  ]);
  if (!env.ok) throw new ExternalToolError("twitter-cli", env.error?.message ?? "unknown");
  return env.data.map(adapt);
}

async function runTwitterCli<T>(args: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const p = spawn("twitter", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (e) => {
      if ((e as any).code === "ENOENT") {
        reject(new ExternalToolNotInstalled("twitter-cli", "uv tool install twitter-cli"));
      } else {
        reject(e);
      }
    });
    p.on("close", (code) => {
      if (code !== 0) return reject(new ExternalToolError("twitter-cli", stderr.trim()));
      try {
        resolve(JSON.parse(stdout) as T);
      } catch (e) {
        reject(new Error(`twitter-cli returned non-JSON: ${stdout.slice(0, 200)}`));
      }
    });
  });
}
```

Replace `src/providers/twitter.ts`'s Firefox-profile + `@the-convocation/twitter-scraper` implementation with thin shims that call into `twitter-cli.ts`. Keep the public function signatures (`getTwitterSentiment`, `normalizeQuery`, `scoreTwitterSentiment`, etc.) so existing consumers don't change. Remove `readTwitterCookies` and the direct `better-sqlite3` cookie dependency from this provider path.

`src/sentiment/adapters/twitter.ts` only needs to map the envelope's tweet shape (verified in Spike 4a) to OC's existing `Tweet` interface — likely a 30-line adapter.

### 4c. Cookie reader

Add a thin `src/infra/cookie-reader.ts` that wraps `@rookie-rs/api`. **Not load-bearing for this change** — twitter-cli does its own cookie extraction. The reader is useful for:

- Yahoo crumb persistence (future)
- Manual-paste fallback's machine-side detection of "did the user paste cookies that match what's in their Chrome"
- Any future cookie-needing source (LinkedIn, etc.)

Default decision: defer. Only ship it in this change if it is needed for a concrete status probe or test; otherwise keep `@rookie-rs/api` out of `package.json` and track it as a follow-up.

---

## 5. Code touchpoints

| File | Change |
|---|---|
| `src/providers/yahoo-finance.ts` | Replace `fetchOptionsViaBrowser` body with `yahoo-finance2.options()` call. Remove `StealthBrowser` import. |
| `src/infra/browser.ts` | **Delete** (after PR 3 ships; PR 4) |
| `src/tools/interaction/twitter-login.ts` | **Delete** (PR 4) — twitter-cli reads cookies from the user's browser directly |
| `src/providers/twitter.ts` | Rewrite to call `twitter-cli.ts` instead of `@the-convocation/twitter-scraper` + Firefox-profile cookies |
| `src/providers/twitter-cli.ts` | **New** — subprocess wrapper + envelope parser |
| `src/providers/external-tool-error.ts` (new) | Add `ExternalToolNotInstalled` + `ExternalToolError` as siblings, not subclasses, of `ProviderCredentialError`; existing credential interceptors should not catch them as API-key setup errors |
| `src/sentiment/adapters/twitter.ts` | Map twitter-cli envelope's tweet shape → OC `Tweet` interface |
| `src/onboarding/providers.ts` | Expand `ProviderDescriptor` to a discriminated union (see §7). Add `twitter` entry of kind `external-tool`. Optional: `yahoo`, `reddit` entries of kind `public-http`. |
| `src/onboarding/external-tools.ts` | **New** — conversational onboarding for the `external-tool` provider kind (uses Pi's `ask_user`) |
| `gui/server/tool-metadata.ts` | Generalize provider serialization for the new descriptor union. Add `statusProbes` with a 60s TTL cache. |
| `gui/web/src/features/catalog/CatalogOverlay.jsx` | `ProviderRow` and `ProviderBuilder` branch on `provider.kind`. New "external-tool" row renders install + login state; new "public-http" row renders reachability only. |
| `src/cli.ts` (or new `src/tools/doctor.ts`) | New `opencandle doctor` subcommand — walks `PROVIDERS`, runs the same status probes the catalog uses, renders a status board. |
| `package.json` | Add `yahoo-finance2`. Remove `@the-convocation/twitter-scraper` and `camoufox-js` when their last runtime users are gone. Remove `playwright-core` only if GUI/screenshot harnesses no longer import it; otherwise keep/move it as dev-only test tooling. Defer `@rookie-rs/api` unless used by an implemented probe. |
| `CHANGELOG.md` | Entry describing the migration and the install footprint change |
| `tests/fixtures/twitter-cli/` | New fixtures: sample `--json` envelope outputs for search, user details, user-posts |

---

## 6. First-time setup UX

### 6a. From a fresh machine

**Yahoo:** zero touch. No accounts, no logins, no prompts. Works on first call.

**Twitter prerequisites:**
1. `uv` (or `pipx`) on `PATH`. If not present: `curl -LsSf https://astral.sh/uv/install.sh | sh`.
2. `twitter-cli` installed: `uv tool install twitter-cli`.
3. User logged into x.com in a supported browser (Chrome / Arc / Edge / Firefox / Brave).
4. **macOS Chrome only:** first cookie read triggers a Keychain prompt ("Allow" + login password). Persistent after first allow.

OC cannot fully automate steps 1–3 (installing system-level binaries on the user's behalf is high blast radius). OC's role: detect → diagnose → guide → re-verify.

### 6b. TUI flow (Pi shell)

Triggered lazily when a chat turn needs X data.

```
User: "What are people saying about NVDA?"

OC routes → twitter sentiment tool → spawn fails with ENOENT
  ↓
ask_user (text): "X sentiment needs twitter-cli installed.
                  Run this in another terminal, then press Continue:
                    uv tool install twitter-cli
                  (Install uv first if missing:
                   curl -LsSf https://astral.sh/uv/install.sh | sh)
                  Or: skip X for this query."
Choices: [Continue once installed] [Skip X] [Always skip X]

User installs, presses Continue → OC re-spawns → succeeds → answer flows.
```

Three failure shapes, each with its own `ask_user` template:
- **ENOENT** ("twitter-cli not installed") → install copy
- **stderr contains "No Twitter cookies found"** → "log into x.com in Chrome" copy
- **stderr contains "401" / empty data** → "session may have expired, refresh x.com" copy

Eager path: `opencandle doctor` walks everything and prints a status board (see §7).

### 6c. GUI flow

Three surfaces, all in existing UI structure:

1. **Onboarding card on first launch** (extends existing first-run setup). Adds an "Optional: X sentiment" row with a [Setup] button.

2. **Setup drawer** (clicking [Setup]): three labeled steps with copy-to-clipboard commands, an install-status indicator that polls `GET /api/diagnostics/twitter-cli?mode=install` every 2 s while the drawer is open, and an explicit [Check X session] action that calls `POST /api/diagnostics/twitter-cli/check-session` for the cookie-reading smoke. Passive polling must not trigger Keychain or browser-cookie prompts.

3. **Inline failure banner in chat** when an answer would have used X but couldn't: small banner under the assistant turn with `[Refresh x.com session]` / `[Retry with X]` / `[Always skip X]` action buttons. No modal interrupt.

The Catalog modal (existing `CatalogOverlay.jsx`) is the canonical doctor surface — see §7.

### 6d. The Keychain prompt

First time twitter-cli (or rookie) reads Chrome cookies on macOS, the user sees:

> **"twitter" wants to use your confidential information stored in "Chrome Safe Storage"**
> *Enter your login password to allow.*

Document this in both TUI's `ask_user` text and the GUI setup drawer. **Click "Always Allow"** to make it persistent. **Packaged binaries:** Keychain ACL is keyed by code signature, so unsigned binaries re-prompt each version. If OC ever ships as a signed binary, this stops mattering.

---

## 7. Catalog / doctor unification

Today's `gui/web/src/features/catalog/CatalogOverlay.jsx` Providers tab renders 5 API-keyed entries (`alpha_vantage`, `fred`, `finnhub`, `brave`, `exa`). Twitter/Camoufox is invisible. Yahoo is invisible. Reddit is invisible.

**Expand `ProviderDescriptor` to a discriminated union:**

```ts
type ProviderDescriptor =
  | { kind: "api-key"; id: ProviderId; envVar: string; signupUrl: string; unlocks: string[]; ... }
  | { kind: "external-tool"; id: ProviderId; binary: string; installCmd: string;
      sessionSource: "browser-cookies" | "config-file"; supportedBrowsers?: string[];
      unlocks: string[]; ... }
  | { kind: "public-http"; id: ProviderId; probeUrl: string; unlocks: string[]; ... };
```

**`gui/server/tool-metadata.ts`** gains a `statusProbes` map with per-provider checks, cached with a 60 s TTL so opening the catalog doesn't spawn subprocesses every time:

- `api-key` → existing `hasCredential(id)` check
- `external-tool` → passive check: `spawn(binary, ["--version"])` only. Explicit setup/re-check action: for twitter, run a short JSON smoke (`twitter feed --max 0 --json` or equivalent) after warning that it may read browser cookies and trigger Keychain.
- `public-http` → `HEAD probeUrl` with 3 s timeout

Provider diagnostic responses use one shared shape:

```ts
type ProviderStatus =
  | { providerId: ProviderId; kind: "api-key"; state: "configured" | "missing"; source: "env" | "file" | "absent"; checkedAt: string; cacheHit: boolean }
  | { providerId: ProviderId; kind: "external-tool"; state: "installed" | "missing" | "session_ok" | "session_missing" | "session_stale" | "error"; mode: "install" | "session"; message?: string; installCmd?: string; checkedAt: string; cacheHit: boolean }
  | { providerId: ProviderId; kind: "public-http"; state: "reachable" | "unreachable" | "error"; statusCode?: number; checkedAt: string; cacheHit: boolean };
```

**`ProviderRow` / `ProviderBuilder` in `CatalogOverlay.jsx`** branch on `provider.kind`:

- `external-tool` builder shows: install command in a copyable command field, supported browsers/session source, install status, explicit [Check X session] action, last checked timestamp, and retry/skip actions. **No API key input.**
- `public-http` builder shows: reachability + last successful call. **No setup.**

The TUI `opencandle doctor` command consumes the same `tool-metadata.ts` serialization and renders it as text. GUI catalog modal and TUI doctor become **the same data, two renderings.**

---

## 8. Testing plan

### 8a. Unit tests (vitest)

| Path | What it tests |
|---|---|
| `tests/unit/providers/twitter-cli.test.ts` | Subprocess wrapper: ENOENT → `ExternalToolNotInstalled`; non-zero exit → `ExternalToolError`; malformed JSON → parse error; happy path returns adapted Tweets. Mocks `child_process.spawn`. Uses fixtures from `tests/fixtures/twitter-cli/search-nvda.json`. |
| `tests/unit/providers/yahoo-finance-options.test.ts` | Calls `getOptionsChain("NVDA")`, asserts it routes through the new `yahoo-finance2` path, not the old browser fallback. Mocks `yahoo-finance2.options()`. |
| `tests/unit/onboarding/external-tools.test.ts` | `ExternalToolNotInstalled` → `ask_user` shape; `ExternalToolError` with "No Twitter cookies found" → login-needed copy. |
| `tests/unit/onboarding/providers-descriptor.test.ts` | Discriminated union serialization round-trips through `tool-metadata.ts`. |
| `tests/unit/gui-server/diagnostics.test.ts` | `statusProbes` cache hits within TTL; re-runs after TTL expiry. Mocks subprocess + HEAD. |

### 8b. E2E provider tests (`npm run test:e2e:providers`)

| Path | What it tests |
|---|---|
| `tests/e2e/providers/twitter-cli.test.ts` | Skip if `twitter` not on PATH. Otherwise: real `twitter feed --max 3 --json` subprocess, assert envelope shape matches schema. Documented as requiring a logged-in browser session. |
| `tests/e2e/providers/yahoo-finance-options.test.ts` | Real `yahoo-finance2.options("SPY")` call. Assert ≥1 expiration returned, ≥1 call/put per chain. |

### 8c. TUI integration (`tests/harness/opencandle-runner.ts`)

| Path | What it tests |
|---|---|
| `tests/integration/tui/twitter-onboarding.test.ts` | Use the harness to drive a session asking for X sentiment with `twitter` un-`PATH`ed (mock `spawn` to ENOENT). Assert OC issues an `ask_user` with install copy. Answer the question via harness; assert OC retries and succeeds when subprocess is re-mocked to a fixture. |
| `tests/integration/tui/doctor.test.ts` | `opencandle doctor` produces the expected status board (3 sections, twitter row showing install status). |

Both follow the existing pattern in `tests/harness/cli.ts` — IPC-based, no live API calls.

### 8d. GUI tests (`tests/e2e/gui-browser.test.ts` pattern)

| Path | What it tests |
|---|---|
| `tests/e2e/gui-browser-catalog-twitter.test.ts` | Open the GUI in headless Chromium, open the Catalog modal → Providers tab. Assert twitter row visible. Click [Setup]; assert drawer shows install command. Mock the diagnostics endpoint to return "installed: true" mid-test; assert status dot turns green within 3 s without page reload. |
| `tests/e2e/gui-browser-catalog-yahoo.test.ts` | Yahoo public-http row renders, status dot reflects probe result. |
| `tests/e2e/gui-browser-chat-x-degraded.test.ts` | Trigger a chat turn that would use X with diagnostics mocked to "not installed." Assert the inline degradation banner renders with the three action buttons. |

### 8e. Manual smoke tests (pre-merge)

1. On a fresh machine without `twitter-cli`, run `opencandle` and ask "what's the sentiment on NVDA?". Verify the TUI prompts for install with correct copy.
2. Install per the prompt, press Continue, verify the answer flows with real X data.
3. Open the GUI, open the Catalog modal, verify twitter row status is green. Click [Re-check].
4. Run a few options-chain queries (NVDA, SPY, AAPL) and verify chains come back.
5. Verify `camoufox-js` and `@the-convocation/twitter-scraper` are no longer runtime dependencies after PR 4, and verify `playwright-core` is either absent or dev/test-only.

---

## 9. PR sequence

Land in order. Do not collapse — each one has its own failure-recovery scope.

| PR | Scope | Pre-merge gate |
|---|---|---|
| **PR 1** | Yahoo migration. Replace `fetchOptionsViaBrowser` with `yahoo-finance2.options()`. No other changes. | E2E options-chain test green. No regressions in existing yahoo-finance tests. |
| **PR 2** | Provider descriptor refactor + passive diagnostics. Expand to discriminated union. Add `twitter` (external-tool) and `yahoo` / `reddit` (public-http) entries. Catalog UI branches on kind. `opencandle doctor` subcommand. Include the passive install/reachability probes and diagnostic response shape so new rows do not point at missing endpoints. | Unit tests for descriptor + passive diagnostics. GUI catalog test for new row kinds. |
| **PR 3** | Twitter migration. New `twitter-cli.ts` provider + adapter. Rewrite `twitter.ts`. TUI onboarding wiring (`external-tools.ts`). GUI setup drawer session-smoke action + inline degradation banner. | E2E `twitter-cli.test.ts` green (skipped if env lacks tool). TUI harness onboarding test green. GUI catalog twitter session-check test green. |
| **PR 4** | Camoufox deletion. Remove `src/infra/browser.ts`, `src/tools/interaction/twitter-login.ts`, `camoufox-js`, and `@the-convocation/twitter-scraper`. Audit `playwright-core`: remove it only after migrating GUI/screenshot harnesses, or keep it as dev-only test tooling. Update README + `docs/first-run.md` + `docs/getting-started.md`. | No runtime reference to `camoufox`, `StealthBrowser`, `twitter-login`, or `@the-convocation/twitter-scraper` remains. Production bundle/install-size delta documented in PR description; any retained test-only browser tooling is called out separately. |

Optional follow-ups (not blocking):
- **PR 5** Tradier sandbox as credentialed options provider; Yahoo becomes free-tier fallback only.
- **PR 6** `lexiforest/impers` wired as `_opts.fetch` on `yahoo-finance2` (only if Yahoo starts blocking). Triggered by alerts from PR 1's reliability metrics.

---

## 10. Gotchas (collected from research + spikes)

1. **`yahoo-finance2` v3 API change.** Default export is the class, not an instance: `import YahooFinance from "yahoo-finance2"; const yf = new YahooFinance();`. Methods on the bare module export throw.
2. **Cookie staleness on first read.** Chrome flushes session cookies to disk every ~30–60 s. If twitter-cli is invoked immediately after a fresh login in Chrome, the cookie may not be on disk yet. Document: "log in, wait a moment, then re-run."
3. **macOS Keychain ACL keyed by code signature.** Unsigned `node` / packaged binaries re-prompt every version. If/when OC ships as a signed binary, this becomes irrelevant; until then, warn first-run users.
4. **Safari needs TCC Full Disk Access.** Not in v1 scope (Chrome only). If a future PR adds Safari, gate it behind an explicit `--from-safari` flag with a pre-flight check that prompts the user to add Terminal/opencandle to System Settings → Privacy → Full Disk Access.
5. **Chrome 136+ killed `--remote-debugging-port` on the default profile** (May 2025 security fix). Any future CDP-based path must use an extension model, not flag-based CDP. This is the reason we did not explore CDP attach.
6. **twitter-cli auth header sensitivity.** twitter-cli auto-extracts cookies; do not pass `auth_token`/`ct0` via env unless absolutely necessary — env-based auth bypasses the browser-extraction logic that handles cookie rotation. Document: "make sure you're logged into x.com; do not set `TWITTER_AUTH_TOKEN` unless instructed."
7. **`twitter-cli` runs Python.** OC users now need Python (≥ 3.10 per twitter-cli's deps). Document this in `docs/first-run.md`. Most macOS devs have it; many Linux users do too; Windows users may need explicit install via uv.
8. **Subprocess output redaction.** twitter-cli's stderr can include cookie material on auth errors. Redact `auth_token=...; ct0=...; ` patterns from any subprocess stderr that gets logged or surfaced to the UI. Lift the regex from `/tmp/oc-spike-1781419251/spike-rettiwt-v2.ts` (`REDACT` helper).
9. **`statusProbes` cache invalidation.** When the user clicks [Re-check] in the catalog, the cache must be busted server-side for that probe specifically — not the whole cache, otherwise opening the modal becomes a wave of subprocess calls.
10. **Camoufox cleanup on process exit.** `src/infra/browser.ts` has `process.on("exit", ...)` cleanup. Make sure no other consumers depend on this lifecycle hook before deleting in PR 4.
11. **`tests/screenshots/capture.ts` uses Playwright, not Camoufox.** Treat it as test tooling. For PR 4, confirm `playwright-core` stays dev-only unless a separate test-harness migration removes it.
12. **`tests/e2e/gui-browser.test.ts` uses Playwright.** It imports `playwright-core`, not `camoufox-js`. Confirm `playwright-core` is intentionally retained as a devDependency after PR 4; do not claim "zero browser binaries" for test harnesses unless this path is migrated in a separate change.
13. **Provider descriptor migration is breaking.** Anything that destructures `provider.envVar` on a provider that's now `external-tool` will crash. Audit `src/onboarding/`, `gui/server/`, and `gui/web/src/features/catalog/` for unconditional `.envVar` reads.
14. **CHANGELOG/AGENTS.md update etiquette.** Per project convention, keep AGENTS.md additions to 2–3 lines max. The CHANGELOG entry can be longer.

---

## 11. Open questions / decisions deferred

These were not resolved in the research thread. Get explicit answers before implementing.

1. **Headless runtime mode (`opencandle monitor`, cron).** No interactive browser session means twitter-cli will fail. Options: (a) cookie+TID+impers path (~75% reliability) as a documented fallback, (b) use the paid X API in headless mode only, (c) disable X sentiment in headless mode entirely, (d) decide later. Current proposal defers the decision; revisit after PR 3 ships.
2. **Should `@rookie-rs/api` ship in this change or be deferred?** twitter-cli does its own cookie extraction, so the change works without rookie. Rookie is mainly useful for future cookie-needing sources or for Yahoo crumb persistence. Decision: defer to a follow-up PR unless free to add.
3. **Tradier sandbox provider.** Spike-noted as the cleaner long-term Yahoo replacement. Not in scope for this change; track as a follow-up PR.
4. **Should the catalog group rows by kind?** With 5 → ~8 rows, a flat list still works. With more, group as "Required keys / External tools / Public sources." Defer; decide when the row count grows.
5. **GUI "do it for me" auto-install button.** Could run `curl -LsSf ... | sh` + `uv tool install` for the user. Technically yes; ethically high blast radius. Decision: guide + copy by default, only consider auto-install behind an explicit opt-in checkbox.
6. **`src/pi/setup.ts` integration.** The Pi-side setup wizard may need a corresponding entry for twitter-cli. Check that file during PR 3.

---

## 12. References

- **Verified projects (spike-tested):**
  - [`gadicc/yahoo-finance2`](https://github.com/gadicc/yahoo-finance2) v3.15.x — pass
  - [`public-clis/twitter-cli`](https://github.com/public-clis/twitter-cli) — pass
  - [`@rookie-rs/api`](https://github.com/thewh1teagle/rookie) — pass
- **Watch list / fallbacks:**
  - [`jpoindexter/x-native`](https://github.com/jpoindexter/x-native) — pure-TS X client (partial spike)
  - [`lexiforest/impers`](https://github.com/lexiforest/impers) — Node binding for curl-impersonate
  - [`steipete/sweet-cookie`](https://github.com/steipete/sweet-cookie) — pure-TS cookie extractor (Node ≥ 22)
  - [`vladkens/twscrape`](https://github.com/vladkens/twscrape) — Python alt to twitter-cli with multi-account rotation
- **Technical background:**
  - [`iSarabjitDhiman/XClientTransaction`](https://github.com/iSarabjitDhiman/XClientTransaction) — `x-client-transaction-id` reference implementation
  - [`Lqm1/x-client-transaction-id`](https://github.com/Lqm1/x-client-transaction-id) — TS port of the algorithm
  - Chrome 136 remote-debugging-port deprecation: https://developer.chrome.com/blog/remote-debugging-port
- **OC code references (file:line):**
  - `src/providers/yahoo-finance.ts:618` — single `StealthBrowser.run` call site
  - `src/tools/interaction/twitter-login.ts:13` — Camoufox login flow entry
  - `src/infra/browser.ts:11` — `Camoufox` import
  - `src/onboarding/providers.ts:50` — `PROVIDERS` array
  - `gui/server/tool-metadata.ts:51` — provider serialization
  - `gui/web/src/features/catalog/CatalogOverlay.jsx:50,328,641` — provider list, row, builder

---

## 13. Acceptance criteria for the migration as a whole

The migration is complete when **all** of these are true:

- `grep -r camoufox src/ tests/ gui/ docs/` returns no matches.
- `package.json` does not list `camoufox-js` or `@the-convocation/twitter-scraper` as runtime dependencies. `playwright-core` is either removed after harness migration or retained only as explicit dev/test tooling.
- A user on a fresh machine, following only `docs/first-run.md`, can:
  - Get Yahoo Finance data immediately.
  - Set up twitter-cli in under 3 minutes (one terminal command + one Keychain click).
- Opening the GUI catalog → Providers tab shows status for **all** of: 5 existing API-key providers, twitter (external-tool), yahoo (public-http), reddit (public-http).
- `opencandle doctor` produces the same status data as the GUI catalog, rendered as text.
- The TUI gracefully recovers from each of the three twitter-cli failure modes (not installed / no cookies / 401) without crashing the session.
- No degradation in existing sentiment, options, or quote tool coverage.
