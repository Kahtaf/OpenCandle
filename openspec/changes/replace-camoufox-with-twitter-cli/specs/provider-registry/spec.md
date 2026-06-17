## MODIFIED Requirements

### Requirement: Provider descriptor registry is the single source of truth for credentialed providers

`src/onboarding/providers.ts` SHALL export provider descriptors as the single source of truth for provider setup, status, and gap-reporting metadata across API-key providers, external-tool providers, and public HTTP providers. Every setup pathway, GUI catalog provider row, TUI doctor/provider-status surface, and provider-gap note SHALL read provider metadata from this registry. No other module SHALL hardcode provider signup URLs, display names, env var names, install commands, probe URLs, or config paths.

#### Scenario: Registry exposes API-key and non-key providers

- **WHEN** code imports `PROVIDERS` from `src/onboarding/providers.ts`
- **THEN** the array contains the existing API-key providers `alpha_vantage`, `fred`, `finnhub`, `brave`, and `exa`
- **AND** it contains `twitter` as an external-tool provider
- **AND** it contains `yahoo` and `reddit` as public HTTP providers

#### Scenario: Existing API-key setup keeps using the registry

- **WHEN** first-run startup, `/connect`, credential interception, or provider-gap notes need API-key provider metadata
- **THEN** they read the `api-key` descriptor branch from the registry
- **AND** current setup behavior for Alpha Vantage, FRED, Finnhub, Brave Search, and Exa remains unchanged

### Requirement: ProviderDescriptor shape carries all metadata needed for setup and gap reporting

Each `ProviderDescriptor` SHALL be a discriminated union with common metadata and kind-specific fields:

- common fields: `kind`, `id`, `displayName`, `category`, `tier`, `aliases`, `unlocks`, `fallbackDescription`, `snoozeDurationDays`, and `instructionsHint`
- `kind: "api-key"` fields: `signupUrl`, `freeTier`, `envVar`, and `configPath`
- `kind: "external-tool"` fields: `binary`, `installCmd`, `sessionSource`, and optional `supportedBrowsers`
- `kind: "public-http"` fields: `probeUrl`

Credential helpers SHALL operate only on `api-key` descriptors. Callers that need generic provider readiness SHALL use status probes rather than destructuring `envVar` from every provider.

#### Scenario: API-key descriptors retain credential metadata

- **WHEN** the `alpha_vantage`, `fred`, `finnhub`, `brave`, or `exa` descriptor is read
- **THEN** `kind === "api-key"`
- **AND** credential fields such as `envVar`, `configPath`, and `signupUrl` are present

#### Scenario: Twitter descriptor has no API key input

- **WHEN** the `twitter` descriptor is read
- **THEN** `kind === "external-tool"`
- **AND** it includes `binary: "twitter"` and an install command for `twitter-cli`
- **AND** it does not include API-key-only fields that would cause the GUI to render an API key input

#### Scenario: Public providers have reachability metadata

- **WHEN** the `yahoo` or `reddit` descriptor is read
- **THEN** `kind === "public-http"`
- **AND** it includes a public reachability probe URL
- **AND** it does not include API-key-only fields

### Requirement: ProviderId is a string literal union matching the registry

`ProviderId` SHALL be declared as a string literal union matching the full registry, including API-key, external-tool, and public HTTP providers. The registry array SHALL be typed such that TypeScript fails the build if the array does not contain exactly one descriptor per `ProviderId` value or if a descriptor branch is missing required kind-specific fields.

#### Scenario: Compile-time exhaustiveness includes non-key providers

- **WHEN** a developer adds a new `ProviderId` value without adding a corresponding descriptor
- **THEN** TypeScript compilation fails with a clear error

#### Scenario: Credential map excludes non-key providers intentionally

- **WHEN** a helper maps provider ids to config/env credential fields
- **THEN** it covers only `api-key` provider ids or uses an explicit narrowed type
- **AND** adding `twitter`, `yahoo`, or `reddit` does not create an impossible credential-map entry

## ADDED Requirements

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
