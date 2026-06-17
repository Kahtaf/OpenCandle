## MODIFIED Requirements

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

### Requirement: ProviderId is a string literal union matching the registry

`ProviderId` SHALL be declared as a string literal union matching the full registry, including API-key and external-tool providers. The registry array SHALL be typed such that TypeScript fails the build if the array does not contain exactly one descriptor per `ProviderId` value or if a descriptor branch is missing required kind-specific fields.

#### Scenario: Credential map excludes non-key providers intentionally

- **WHEN** a helper maps provider ids to config/env credential fields
- **THEN** it covers only `api-key` provider ids or uses an explicit narrowed type
- **AND** adding `reddit` does not create an impossible credential-map entry

## ADDED Requirements

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
