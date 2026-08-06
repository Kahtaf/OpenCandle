# Provider Registry Specification

## Purpose
TBD - normalized from existing baseline requirements.
## Requirements
### Requirement: Provider descriptor registry is the single source of truth for credentialed providers

`src/onboarding/providers.ts` SHALL export provider descriptors as the single source of truth for provider setup, status, and gap-reporting metadata across API-key providers and external-tool providers. Every setup pathway, GUI catalog provider row, TUI doctor/provider-status surface, and provider-gap note SHALL read provider metadata from this registry. No other module SHALL hardcode provider signup URLs, display names, env var names, install commands, binary names, probe commands, or config paths.

#### Scenario: Registry exposes API-key and external-tool providers

- **WHEN** code imports `PROVIDERS` from `src/onboarding/providers.ts`
- **THEN** the array contains the existing API-key providers `alpha_vantage`, `fred`, `finnhub`, `brave`, and `exa`
- **AND** it contains `reddit` as an external-tool provider using `rdt-cli`
- **AND** Reddit is not represented as a public HTTP provider after this migration

### Requirement: ProviderDescriptor shape carries all metadata needed for setup and gap reporting

Each `ProviderDescriptor` SHALL be a discriminated union with common metadata and kind-specific fields:

- common fields: `kind`, `id`, `displayName`, `category`, `tier`, `aliases`, `unlocks`, `fallbackDescription`, `snoozeDurationDays`, and `instructionsHint`
- `kind: "api-key"` fields: `signupUrl`, `freeTier`, `envVar`, and `configPath`
- `kind: "external-tool"` fields: `binary`, `installCmd`, `sessionSource`, and optional `supportedBrowsers`
- `kind: "public-http"` fields: `probeUrl` when such providers exist

Credential helpers SHALL operate only on `api-key` descriptors. Callers that need generic provider readiness SHALL use status probes rather than destructuring `envVar` from every provider.

#### Scenario: Reddit descriptor has no API key input

- **WHEN** the `reddit` descriptor is read
- **THEN** `kind === "external-tool"`
- **AND** it includes `binary: "rdt"` and install command `uv tool install rdt-cli`
- **AND** its session source mentions the user's supported browser session as consumed by `rdt-cli`
- **AND** it does not include API-key-only fields that would cause the GUI to render an API key input

### Requirement: Registry lookup helpers provide typed access by id, category, and alias
The registry module SHALL export the following helper functions:
- `getProvider(id: ProviderId): ProviderDescriptor` — throws if the id is not in the registry
- `getProvidersByCategory(category: ProviderCategory): readonly ProviderDescriptor[]` — returns zero or more providers sorted by declaration order
- `getProvidersByTier(tier: "hard" | "soft"): readonly ProviderDescriptor[]` — returns providers of the given tier in declaration order
- `resolveProviderFromArgument(arg: string): ProviderDescriptor | ProviderDescriptor[] | undefined` — used by the `/connect` command. Resolves a string to either a single provider (id or alias match), a category group (multiple matches), or `undefined` (no match). When the argument matches a category name and that category contains multiple providers, returns the category group; when it matches an alias or id, returns the single provider.
- `listAllProviders(): readonly ProviderDescriptor[]` — returns the full array in declaration order
- `hasCredential(id: ProviderId): boolean` — returns `true` if the provider's credential is present in the loaded config from any source
- `getCredentialSource(id: ProviderId): "env" | "file" | "absent"` — returns which source the active credential comes from, or `absent` if no credential exists. Used by `runProviderConnect` to detect env-var precedence conflicts before writing to file config.

These helpers SHALL be the only public API of the registry module besides the `PROVIDERS` array itself and the `ProviderId` / `ProviderCategory` / `ProviderDescriptor` types.

#### Scenario: getProvider returns the correct descriptor
- **WHEN** `getProvider("finnhub")` is called
- **THEN** it returns the descriptor with `id: "finnhub"` and `displayName: "Finnhub"`

#### Scenario: getProvider throws for unknown id
- **WHEN** `getProvider("not_a_real_provider" as ProviderId)` is called
- **THEN** it throws an error naming the unknown id

#### Scenario: getProvidersByCategory returns matching descriptors
- **WHEN** `getProvidersByCategory("web_search")` is called
- **THEN** it returns an array containing both the `exa` and `brave` descriptors in declaration order

#### Scenario: hasCredential reflects current config state
- **WHEN** `FINNHUB_API_KEY` is set in the environment AND `hasCredential("finnhub")` is called
- **THEN** it returns `true`
- **WHEN** no Finnhub key exists in env or file config AND `hasCredential("finnhub")` is called
- **THEN** it returns `false`

#### Scenario: hasCredential reads the file config when env is not set
- **WHEN** `providers.alphaVantage.apiKey` is set in `~/.opencandle/config.json` AND no env var is set AND `hasCredential("alpha_vantage")` is called
- **THEN** it returns `true`

#### Scenario: getCredentialSource returns env when env var is set
- **WHEN** `ALPHA_VANTAGE_API_KEY` is set in the environment AND `getCredentialSource("alpha_vantage")` is called
- **THEN** it returns `"env"`
- **AND** this is true even if `providers.alphaVantage.apiKey` is also set in the file config

#### Scenario: getCredentialSource returns file when only file config is set
- **WHEN** no env var is set AND `providers.fred.apiKey` is set in file config AND `getCredentialSource("fred")` is called
- **THEN** it returns `"file"`

#### Scenario: getCredentialSource returns absent when no credential exists
- **WHEN** neither env var nor file config has a Finnhub key AND `getCredentialSource("finnhub")` is called
- **THEN** it returns `"absent"`

#### Scenario: resolveProviderFromArgument matches exact provider id
- **WHEN** `resolveProviderFromArgument("alpha_vantage")` is called
- **THEN** it returns the Alpha Vantage descriptor (single, not array)

#### Scenario: resolveProviderFromArgument matches friendly alias
- **WHEN** `resolveProviderFromArgument("financials")` is called AND `"financials"` is in Alpha Vantage's `aliases`
- **THEN** it returns the Alpha Vantage descriptor (single)

#### Scenario: resolveProviderFromArgument matches category with single provider
- **WHEN** `resolveProviderFromArgument("fundamentals")` is called AND Alpha Vantage is the only `fundamentals`-category provider
- **THEN** it returns the Alpha Vantage descriptor (single)

#### Scenario: resolveProviderFromArgument matches category with multiple providers
- **WHEN** `resolveProviderFromArgument("search")` is called AND both Exa and Brave have `"search"` as an alias OR both are in the `web_search` category
- **THEN** it returns an array containing both descriptors
- **AND** the caller is expected to present a sub-picker

#### Scenario: resolveProviderFromArgument returns undefined for unknown input
- **WHEN** `resolveProviderFromArgument("not_a_real_thing")` is called
- **THEN** it returns `undefined`

#### Scenario: getProvidersByTier returns hard providers
- **WHEN** `getProvidersByTier("hard")` is called
- **THEN** it returns an array containing Alpha Vantage and FRED (no other providers)

#### Scenario: getProvidersByTier returns soft providers
- **WHEN** `getProvidersByTier("soft")` is called
- **THEN** it returns an array containing Finnhub, Brave, and Exa (no other providers)

### Requirement: ProviderId is a string literal union matching the registry

`ProviderId` SHALL be declared as a string literal union matching the full registry, including API-key and external-tool providers. The registry array SHALL be typed such that TypeScript fails the build if the array does not contain exactly one descriptor per `ProviderId` value or if a descriptor branch is missing required kind-specific fields.

#### Scenario: Credential map excludes non-key providers intentionally

- **WHEN** a helper maps provider ids to config/env credential fields
- **THEN** it covers only `api-key` provider ids or uses an explicit narrowed type
- **AND** adding `reddit` does not create an impossible credential-map entry

### Requirement: Registry is pure and import-safe
The provider registry module SHALL have no side effects at import time, SHALL NOT read files or environment variables during module initialization, and SHALL NOT import any module that transitively triggers network or filesystem access. `hasCredential` is the only helper that touches env/config state, and it SHALL read them lazily on each invocation via the existing `getConfig()` cache.

#### Scenario: Importing the registry does not load config
- **WHEN** `import { PROVIDERS } from "./onboarding/providers.js"` runs in a test
- **THEN** no call to `loadEnv`, `loadFileConfig`, or `readFileSync` occurs as part of module evaluation

#### Scenario: hasCredential uses the cached config
- **WHEN** `hasCredential` is called after `loadConfig` has been invoked once
- **THEN** it uses the cached `Config` object rather than re-reading the file

### Requirement: Provider Status Probes Are Shared By GUI Catalog And TUI Doctor

OpenCandle SHALL expose provider readiness through shared status probes consumed by both the GUI catalog and `opencandle doctor`. Status probes SHALL be cached for 60 seconds by provider id and probe type. Passive probes SHALL avoid side effects such as browser-cookie reads, Keychain prompts, account login attempts, or system-level installs.

Provider status responses SHALL use a discriminated union shape that includes provider id, provider kind, state, checked timestamp, and cache-hit indicator. API-key responses SHALL include credential source. External-tool responses SHALL include mode (`install` or `session`) and MAY include an install command or redacted message. Public HTTP responses MAY include HTTP status code.

#### Scenario: API-key provider status uses credential source

- **WHEN** status is requested for an API-key provider
- **THEN** the probe reports env, file, or absent credential state using existing credential helpers

#### Scenario: External-tool passive status checks only installation

- **WHEN** passive status is requested for the Twitter external-tool provider
- **THEN** the probe spawns `twitter --version` or equivalent
- **AND** it does not run a command that reads browser cookies
- **AND** the response state is `installed`, `missing`, or `error` with `mode: "install"`

#### Scenario: Explicit Twitter session check may read cookies

- **WHEN** the user explicitly clicks re-check or check X session in setup
- **THEN** OpenCandle may run a short `twitter-cli` JSON smoke command
- **AND** the UI/TUI copy warns that the command may read browser cookies and trigger Keychain prompts
- **AND** the response state is `session_ok`, `session_missing`, `session_stale`, or `error` with `mode: "session"`

#### Scenario: Public HTTP status uses bounded reachability

- **WHEN** status is requested for a public HTTP provider such as Yahoo or Reddit
- **THEN** OpenCandle runs a bounded reachability probe with a short timeout
- **AND** the probe result is cached for the provider status TTL

### Requirement: Yahoo Options Fallback Uses yahoo-finance2 Without Browser Runtime

OpenCandle SHALL preserve the existing Yahoo options primary raw-fetch path and replace only the Camoufox/StealthBrowser fallback with a `yahoo-finance2` fallback. The fallback SHALL return the same public `OptionsChain` contract as before, including greeks, expiration dates, quote status warnings, cache/stale-cache behavior, and invalid-symbol handling.

#### Scenario: Primary raw fetch still succeeds without yahoo-finance2 fallback

- **WHEN** the existing raw Yahoo options endpoint succeeds
- **THEN** `getOptionsChain()` returns the parsed `OptionsChain`
- **AND** it does not call `yahoo-finance2`

#### Scenario: yahoo-finance2 fallback replaces StealthBrowser

- **WHEN** the raw options fetch and retry fail
- **THEN** `getOptionsChain()` attempts the `yahoo-finance2` fallback
- **AND** it does not import or invoke `StealthBrowser`

#### Scenario: Stale options cache remains the last fallback

- **WHEN** both the raw fetch path and `yahoo-finance2` fallback fail
- **AND** a stale cached options chain exists within the stale limit
- **THEN** `getOptionsChain()` returns the stale cached chain

### Requirement: Runtime Browser Dependencies Are Removed Separately From Test Browser Tooling

OpenCandle SHALL remove Camoufox and the old Twitter scraper from runtime dependencies once their runtime call sites are gone. Playwright-based GUI e2e and screenshot harnesses SHALL be audited separately: they may be migrated off Playwright, or `playwright-core` may remain as explicit dev/test-only tooling. Production install-size claims SHALL distinguish runtime/browser-removal wins from retained test harness dependencies.

#### Scenario: Runtime Camoufox references are gone

- **WHEN** the Camoufox deletion PR lands
- **THEN** runtime code under `src/` and `gui/server/` no longer imports `camoufox-js`, `StealthBrowser`, `twitter-login`, or `@the-convocation/twitter-scraper`

#### Scenario: Test-only Playwright retention is explicit

- **WHEN** `tests/e2e/gui-browser.test.ts` or `tests/screenshots/capture.ts` still imports `playwright-core`
- **THEN** `playwright-core` remains dev/test-only unless a separate test-harness change migrates those tests before removing it
- **AND** release notes do not claim all browser tooling was removed from the repository

### Requirement: Reddit Status Probes Separate Install And Session Checks

OpenCandle SHALL expose Reddit readiness through provider status probes consumed by both the GUI catalog and `opencandle doctor`. Status probes SHALL be cached for 60 seconds by provider id and probe type. Passive probes SHALL avoid side effects such as browser-cookie reads, Keychain prompts, account login attempts, or system-level installs.

Provider status responses SHALL use a discriminated union shape that includes provider id, provider kind, state, checked timestamp, and cache-hit indicator. API-key responses SHALL include credential source. External-tool responses SHALL include mode (`install` or `session`) and MAY include an install command or redacted message.

#### Scenario: Reddit external-tool passive status checks only installation

- **WHEN** passive status is requested for the Reddit external-tool provider
- **THEN** the probe spawns `rdt --version` or equivalent
- **AND** it does not run `rdt status`, `rdt login`, or a Reddit data command
- **AND** the response state is `installed`, `missing`, or `error` with `mode: "install"`

#### Scenario: Explicit Reddit session check may read cookies

- **WHEN** the user explicitly clicks re-check or check Reddit session in setup
- **THEN** OpenCandle may run `rdt status`
- **AND** the UI/TUI copy warns that the command may read browser cookies or `rdt-cli` credential state and may trigger Keychain prompts
- **AND** the response state is `session_ok`, `session_missing`, `session_stale`, or `error` with `mode: "session"`

#### Scenario: Reddit no longer uses public HTTP reachability for readiness

- **WHEN** status is requested for Reddit after this migration
- **THEN** OpenCandle reports `rdt-cli` install/session readiness
- **AND** it does not use `https://www.reddit.com/r/stocks/about.json` or another public URL as the primary readiness signal

### Requirement: Quote and Options Providers Surface Unavailable for Zero-Result Responses

`getQuote` and `getOptionsChain` SHALL detect zero-result responses from upstream providers and throw a typed `InvalidSymbolError` rather than returning a successful zero-filled payload. `wrapProvider` SHALL map `InvalidSymbolError` to `unavailable`, and `withFallback` SHALL preserve unavailable status/reason for fallback-backed consumers so all callers see "⚠ … unavailable" instead of "$0.00".

A zero-result quote response is defined as one where ALL of the following fields are simultaneously zero (or absent and therefore defaulted to zero by the provider parser):

- `price`
- `volume`
- `week52High`
- `week52Low`
- `marketCap`

A zero-result options-chain response is defined as one where the upstream `result.options` array is empty AND `quote.regularMarketPrice` is missing or zero.

#### Scenario: Invalid ticker surfaces as unavailable, not $0.00

- **WHEN** `getQuote("XXFAKEXX")` is invoked and Yahoo returns a sparse-meta response with all five fields defaulting to zero
- **THEN** `getQuote` throws `InvalidSymbolError("XXFAKEXX", "yahoo")`
- **AND** `wrapProvider("yahoo", () => getQuote("XXFAKEXX"))` returns `{ status: "unavailable", reason: <error message> }`
- **AND** `withFallback` callers preserve an unavailable result rather than returning zero-filled details
- **AND** the `get_stock_quote` tool emits "⚠ Stock quote unavailable for XXFAKEXX (…)" with no zero-filled `details` payload

#### Scenario: Direct Yahoo tool callers surface unavailable

- **WHEN** a watchlist check, portfolio view, alert check, or daily report run calls Yahoo through `wrapProvider` for an invalid zero-result symbol
- **THEN** the tool output includes an unavailable/data-gap status for that symbol
- **AND** no tool result uses zero-filled quote values as valid market data

#### Scenario: Real low-priced stock with non-zero volume is preserved

- **WHEN** `getQuote("PENNY")` returns `price: 0.04, volume: 12000, week52High: 0.20, week52Low: 0.01, marketCap: 50000`
- **THEN** the heuristic does NOT match (volume and 52W fields are non-zero)
- **AND** the quote is returned normally as a successful `StockQuote`

#### Scenario: Empty options chain surfaces as unavailable

- **WHEN** `getOptionsChain("XXFAKEXX")` returns a response where `result.options` is empty and `quote.regularMarketPrice` is missing
- **THEN** `getOptionsChain` throws `InvalidSymbolError("XXFAKEXX", "yahoo")`
- **AND** the consuming tool emits an "unavailable" status rather than a zero-row chain

### Requirement: `analyze_correlation` Supports Partial Success

`analyze_correlation` SHALL return a partial-success matrix computed over the symbols whose history fetch succeeded, when ≥ 2 symbols succeed. The response SHALL list dropped symbols with their wrapped `unavailable` reason.

#### Scenario: One bogus symbol among three valid

- **WHEN** the user runs `analyze_correlation(["AAPL","MSFT","XXFAKEXX"])` and `XXFAKEXX` returns `unavailable`
- **THEN** the matrix is computed for AAPL × MSFT
- **AND** the response includes a "Symbols dropped: XXFAKEXX (…reason)" section
- **AND** the response is NOT marked unavailable

#### Scenario: Only one symbol succeeds

- **WHEN** the user runs `analyze_correlation(["XXFAKEXX","YYBOGUS","AAPL"])` and only AAPL succeeds
- **THEN** the response is unavailable with per-symbol drop reasons for XXFAKEXX and YYBOGUS
- **AND** no matrix is emitted (a 1-symbol matrix carries no information)

### Requirement: Provider registry declares browser transport

Every provider descriptor SHALL declare a hosted-browser transport of
`direct`, `proxy`, or `blocked`, together with a concise reason and the live
browser proof required for `direct`. Unknown or missing classification SHALL be
treated as `blocked`.

#### Scenario: External desktop tool is blocked

- **WHEN** the hosted runtime reads the Reddit or X provider descriptor
- **THEN** its browser transport is `blocked`
- **AND** the reason identifies the native CLI or desktop-session dependency

#### Scenario: Proxy-only provider requires a negotiated relay

- **WHEN** a provider requires forbidden CORS access, custom headers, or a
  credential relay
- **THEN** its browser transport is `proxy`
- **AND** the hosted build enables it only when the fixed relay manifest declares support
- **AND** it remains unavailable when relay negotiation is absent or incompatible

### Requirement: Hosted tool registration is capability filtered

Hosted Pi tool construction SHALL receive the provider capability manifest and
MUST omit a tool when no complete direct-browser or negotiated fixed-relay path
can execute it. Runtime provider checks SHALL remain as defense in depth.

#### Scenario: Unsupported tool is absent from Pi

- **WHEN** hosted mode builds the tool set and a tool depends only on blocked
  providers or proxy providers absent from the negotiated relay manifest
- **THEN** that tool is absent from the model-visible definitions
- **AND** a user-facing capability report explains why it is unavailable

#### Scenario: New provider defaults to blocked

- **WHEN** a provider is added without a browser transport classification
- **THEN** hosted capability tests fail
- **AND** the provider cannot become model-visible in hosted mode

### Requirement: Direct classification requires a real browser proof

A provider SHALL be classified `direct` only after a real-browser test from the
hosted runtime proves its required request shape, authentication, CORS behavior,
bounded response, and secret handling.

#### Scenario: Documentation claim is insufficient

- **WHEN** provider documentation says browser access is supported but the live
  browser proof is absent or failing
- **THEN** the provider remains `proxy` or `blocked`

### Requirement: Hosted capability claims have current production evidence

The hosted capability matrix SHALL distinguish verified production journeys,
configured-but-unverified providers, and intentional unsupported boundaries.
The PWA SHALL not claim local feature parity for a provider, direct tool, or
workflow until its current deployed browser path returns and renders a real
result with the required credentials.

#### Scenario: Configured provider awaits proof

- **WHEN** a supported credential such as Finnhub or LSE is configured but has
  not completed a production browser journey
- **THEN** diagnostics records it as configured but unverified
- **AND** release acceptance does not count it as feature parity

