## ADDED Requirements

### Requirement: Provider descriptor registry is the single source of truth for credentialed providers
`src/onboarding/providers.ts` SHALL export a `PROVIDERS` array of `ProviderDescriptor` records, with exactly one entry per credentialed provider currently supported by OpenCandle (Alpha Vantage, FRED, Finnhub, Brave Search, Exa). Every setup pathway — first-run startup, the `/connect` command, the `connect_provider` agent tool, and the orchestrator's `credential_required` interception — SHALL read provider metadata exclusively from this registry. No other module SHALL hardcode provider signup URLs, display names, env var names, or config paths.

#### Scenario: Registry exposes all five credentialed providers
- **WHEN** code imports `PROVIDERS` from `src/onboarding/providers.ts`
- **THEN** the array contains exactly five entries with ids `alpha_vantage`, `fred`, `finnhub`, `brave`, and `exa`

#### Scenario: Setup module has no hardcoded provider constants
- **WHEN** `src/pi/setup.ts` is read after this change is applied
- **THEN** it contains no references to `ALPHA_VANTAGE_SIGNUP_URL`, `FRED_SIGNUP_URL`, or any other hardcoded provider signup URL, env var, or config path
- **AND** any code paths that previously referenced those constants SHALL obtain the same values by looking up the provider in the registry

### Requirement: ProviderDescriptor shape carries all metadata needed for setup and gap reporting
Each `ProviderDescriptor` SHALL define the following fields:
- `id`: a `ProviderId` discriminated-union value
- `displayName`: the human-readable name shown in UI copy (e.g., `"Alpha Vantage"`)
- `category`: one of `"fundamentals" | "macro" | "news" | "web_search"`
- `tier`: either `"hard"` or `"soft"`. Hard providers have no meaningful fallback and trigger a just-in-time prompt; soft providers have a usable fallback and silently degrade with a post-answer gap note. See the `conversational-provider-setup` capability for how each tier behaves.
- `aliases`: a readonly array of lowercase friendly names accepted by the `/connect` command (e.g., `["financials", "fundamentals", "company-financials"]` for Alpha Vantage)
- `signupUrl`: an absolute HTTPS URL opened by `runProviderConnect`
- `freeTier`: a boolean indicating whether the free tier is sufficient for OpenCandle
- `envVar`: the exact environment variable name read by `src/config.ts`
- `configPath`: a readonly string array describing the nested key path in `OpenCandleFileConfig` where the key is persisted (e.g., `["providers", "alphaVantage", "apiKey"]`)
- `unlocks`: a readonly array of short human strings describing what the provider unlocks (e.g., `["fundamentals", "DCF", "earnings history"]`)
- `fallbackDescription`: a human string describing the degraded experience when the provider is missing, or `null` if there is no fallback. For `brave` the fallback is DuckDuckGo; for `exa` the fallback is the keyless Exa MCP endpoint (NOT DuckDuckGo — that's a further fallback through the cascade). For `alpha_vantage`, `fred`, and `finnhub` this field is `null`.
- `snoozeDurationDays`: a positive integer number of days for the snooze option (7 for all providers in this change)
- `instructionsHint`: a one-line human copy used in the connect-now prompt (e.g., `"Free, ~30 seconds, signup opens in your browser"`)

#### Scenario: All descriptors conform to the shape
- **WHEN** each entry in `PROVIDERS` is validated against the `ProviderDescriptor` interface
- **THEN** every field is present with the correct type AND no extra fields exist

#### Scenario: Hard providers are tagged correctly
- **WHEN** the `alpha_vantage` and `fred` descriptors are read
- **THEN** `tier === "hard"` for both
- **AND** `fallbackDescription` is `null` for both

#### Scenario: Soft providers are tagged correctly
- **WHEN** the `finnhub`, `brave`, and `exa` descriptors are read
- **THEN** `tier === "soft"` for all three

#### Scenario: Brave fallback description mentions DuckDuckGo
- **WHEN** the `brave` descriptor is read
- **THEN** `fallbackDescription` is a non-null human string mentioning DuckDuckGo as the fallback search provider

#### Scenario: Exa fallback description mentions keyless MCP
- **WHEN** the `exa` descriptor is read
- **THEN** `fallbackDescription` is a non-null human string mentioning the keyless Exa MCP endpoint as the fallback
- **AND** it does NOT claim the fallback is DuckDuckGo

#### Scenario: Aliases are non-empty and lowercase
- **WHEN** any descriptor is read
- **THEN** `aliases` contains at least one entry
- **AND** every alias is lowercase and kebab-case-friendly (letters, digits, hyphens only)

#### Scenario: Aliases are unique across providers
- **WHEN** the full set of aliases across all descriptors is collected
- **THEN** no alias appears in more than one descriptor

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
`ProviderId` SHALL be declared as the string literal union `"alpha_vantage" | "fred" | "finnhub" | "brave" | "exa"`. The registry array SHALL be typed such that TypeScript fails the build if the array does not contain exactly one descriptor per `ProviderId` value. This catches the case where someone adds a new id to the union but forgets the registry entry (or vice versa).

#### Scenario: Compile-time exhaustiveness
- **WHEN** a developer adds a new value to the `ProviderId` union without adding a corresponding `PROVIDERS` entry
- **THEN** TypeScript compilation fails with a clear error

#### Scenario: Duplicate id rejected at build time
- **WHEN** two `PROVIDERS` entries share the same `id`
- **THEN** TypeScript compilation fails OR a startup assertion throws

### Requirement: Registry is pure and import-safe
The provider registry module SHALL have no side effects at import time, SHALL NOT read files or environment variables during module initialization, and SHALL NOT import any module that transitively triggers network or filesystem access. `hasCredential` is the only helper that touches env/config state, and it SHALL read them lazily on each invocation via the existing `getConfig()` cache.

#### Scenario: Importing the registry does not load config
- **WHEN** `import { PROVIDERS } from "./onboarding/providers.js"` runs in a test
- **THEN** no call to `loadEnv`, `loadFileConfig`, or `readFileSync` occurs as part of module evaluation

#### Scenario: hasCredential uses the cached config
- **WHEN** `hasCredential` is called after `loadConfig` has been invoked once
- **THEN** it uses the cached `Config` object rather than re-reading the file
