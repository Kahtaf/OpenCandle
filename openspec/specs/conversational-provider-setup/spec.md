# Conversational Provider Setup Specification

## Purpose
TBD - normalized from existing baseline requirements.

## Requirements

### Requirement: Startup prompts for LLM auth only, then auto-selects a default model when possible
On `session_start`, if the user has no configured LLM, the setup flow SHALL present the LLM sign-in choices (Google, OpenAI, Anthropic, paste API key, or advanced OAuth). It SHALL NOT prompt for Alpha Vantage, FRED, Finnhub, Brave, Exa, or any other data provider during first run. After a successful sign-in or API-key entry, the flow SHALL look up the connected provider's `defaultModelId` in the LLM-provider registry. If a default is declared AND an exact-match model is present in `ctx.modelRegistry.getAvailable()`, the flow SHALL call `api.setModel(<that model>)` and return ready — no model-picker dialog appears. Only when no default matches (or none is declared) SHALL the existing `selectModel` picker be shown.

#### Scenario: First-ever startup with no LLM, default model available
- **WHEN** `session_start` fires AND no LLM is configured AND the user completes sign-in for a provider whose registry entry declares a `defaultModelId` AND that model is in `getAvailable()`
- **THEN** the user sees exactly one setup screen (sign-in options) followed by the sign-in itself
- **AND** no model picker dialog appears
- **AND** the setup flow returns `"ready"` and the user is dropped into chat

#### Scenario: First-ever startup with no LLM, no default model match
- **WHEN** `session_start` fires AND the user completes sign-in AND no `defaultModelId` is declared OR the declared model is not in `getAvailable()`
- **THEN** the existing model picker dialog appears once
- **AND** the user picks a model
- **AND** the setup flow returns `"ready"`

#### Scenario: Startup with LLM already configured
- **WHEN** `session_start` fires AND the LLM is already configured from a previous session
- **THEN** no setup screen appears at all
- **AND** the user is dropped directly into chat

#### Scenario: No data-provider prompts during startup
- **WHEN** any first-run startup path completes
- **THEN** no prompt for Alpha Vantage, FRED, Finnhub, Brave, or Exa has appeared

#### Scenario: LLM sign-in cancelled
- **WHEN** the user cancels LLM sign-in during startup
- **THEN** the extension shuts down gracefully with an actionable message (same behaviour as current `runLlmSetup` startup-mode shutdown path)

### Requirement: Welcome message is seeded once via `ctx.sendMessage` gated on `welcomeShownAt`
When a session is the first ever for this OpenCandle installation (indicated by `OnboardingState.welcomeShownAt` being absent), AND `ctx.hasUI === true`, the extension SHALL call `ctx.sendMessage({ customType: "opencandle-welcome", content: [{ type: "text", text: <body> }], display: true })` after `runOpenCandleSetup` returns `"ready"`. The `<body>` SHALL be in the agent's voice, SHALL suggest at least three concrete example prompts (e.g., `analyze NVDA`, `quote TSLA`, `how's bitcoin?`), SHALL briefly mention that the LLM alone already covers most workflows, and SHALL mention `/connect` as the way to add data providers later. After seeding, the extension SHALL write `welcomeShownAt: <ISO timestamp>` to onboarding state. The welcome SHALL NOT appear on subsequent sessions of the same installation.

#### Scenario: First-ever session seeds the welcome
- **WHEN** `session_start` completes AND `onboardingState.welcomeShownAt === undefined` AND `ctx.hasUI === true`
- **THEN** `ctx.sendMessage` is called exactly once with `display: true` and `customType: "opencandle-welcome"`
- **AND** the content text suggests at least three concrete example prompts
- **AND** the content text mentions `/connect`
- **AND** `onboardingState.welcomeShownAt` is set to the current ISO timestamp

#### Scenario: Subsequent sessions do not repeat the welcome
- **WHEN** `session_start` completes AND `onboardingState.welcomeShownAt` is already set
- **THEN** `ctx.sendMessage` for the welcome is NOT called

#### Scenario: Headless runs skip the welcome
- **WHEN** `session_start` completes AND `ctx.hasUI === false` (e.g., the test harness)
- **THEN** the welcome is not seeded
- **AND** `welcomeShownAt` is NOT written (the welcome can still appear on the user's next UI session)

#### Scenario: Welcome uses sendMessage, not notify
- **WHEN** the welcome is seeded
- **THEN** the mechanism is `ctx.sendMessage(...)`, NOT `ctx.ui.notify(...)`
- **AND** the resulting message appears in the chat transcript (visible in scrollback)

### Requirement: Per-provider onboarding state uses a discriminated union and supports partial presence
`src/onboarding/state.ts` SHALL expose an `OnboardingState` type with the shape:
```
interface OnboardingState {
  version: number;                                           // bumped to 2
  welcomeShownAt?: string;                                   // ISO 8601
  providers: Partial<Record<ProviderId, ProviderOnboardingEntry>>;
}

type ProviderOnboardingEntry =
  | { status: "completed"; lastPromptAt: string }
  | { status: "snoozed";   lastPromptAt: string; snoozeUntil: string }
  | { status: "never_ask"; lastPromptAt: string };
```
The state is persisted at the existing `getOnboardingPath()` location. Providers missing from the map are treated as "never prompted" (the implicit initial state).

#### Scenario: Default state has empty providers map and no welcomeShownAt
- **WHEN** `loadOnboardingState()` is called AND no state file exists
- **THEN** it returns `{ version: 2, providers: {} }` with `welcomeShownAt` absent

#### Scenario: Completed entry has no snoozeUntil
- **WHEN** `markProviderCompleted("fred")` is called AND state is then read
- **THEN** `providers.fred` is `{ status: "completed", lastPromptAt: <ISO> }` with no `snoozeUntil` field

#### Scenario: Snoozed entry has snoozeUntil
- **WHEN** `markProviderSnoozed("finnhub", 7)` is called
- **THEN** `providers.finnhub` is `{ status: "snoozed", lastPromptAt: <ISO>, snoozeUntil: <ISO> }`
- **AND** `snoozeUntil` equals `lastPromptAt + 7 * 24 * 3600 * 1000` ms

#### Scenario: Never-ask entry has no snoozeUntil
- **WHEN** `markProviderNeverAsk("brave")` is called
- **THEN** `providers.brave` is `{ status: "never_ask", lastPromptAt: <ISO> }`

#### Scenario: Partial presence is legal
- **WHEN** `loadOnboardingState()` reads a state file where only some providers have entries
- **THEN** `providers[<missing>]` returns `undefined`
- **AND** no error is raised
- **AND** `shouldPrompt(<missing>)` returns `true`

#### Scenario: Snooze expiry re-opens prompts
- **WHEN** the current time is past `providers.finnhub.snoozeUntil` AND `shouldPrompt("finnhub", now)` is called with the current time
- **THEN** it returns `true`

#### Scenario: Never-ask is permanent
- **WHEN** a provider is marked `never_ask` AND `shouldPrompt(<provider>)` is called at any future time
- **THEN** it returns `false`

#### Scenario: Completed is permanent until stale
- **WHEN** a provider's status is `completed` AND `shouldPrompt(<provider>)` is called without a stale signal
- **THEN** it returns `false`
- **WHEN** the same provider's status is `completed` AND a stale credential signal is passed in
- **THEN** `shouldPrompt` returns `true`

#### Scenario: Unknown fields in loaded state are ignored
- **WHEN** `loadOnboardingState()` reads a file containing fields not in the current schema
- **THEN** those fields are silently ignored AND the parsed state is still returned

#### Scenario: Corrupt state file falls back to default
- **WHEN** `loadOnboardingState()` reads a file that fails JSON parsing
- **THEN** it returns the default state without throwing

### Requirement: Credentialed providers have a tier and are handled differently by the interception flow
The just-in-time setup flow SHALL distinguish "hard" and "soft" providers (as declared in the `provider-registry` capability). Hard providers (Alpha Vantage, FRED) pause the workflow and show the four-option prompt when their credential is missing or stale. Soft providers (Finnhub, Brave, Exa) SHALL NOT pause the workflow — they SHALL use their fallback silently and surface a gap note in the final assistant output.

#### Scenario: Hard provider missing credential pauses the workflow
- **WHEN** a tool call requires Alpha Vantage AND its credential is missing AND no session-level dedup or snooze suppresses the prompt
- **THEN** the workflow pauses AND the user sees the four-option prompt

#### Scenario: Soft provider missing credential does not pause
- **WHEN** a tool call requires Brave AND its credential is missing AND the fallback (DuckDuckGo) is available
- **THEN** no user prompt appears
- **AND** the tool returns its fallback result
- **AND** the tool result `content` includes a subtle tag `[OPENCANDLE_SOFT_DEGRADED provider=brave fallback=ddg remediation="run /connect search"]`

#### Scenario: Soft provider gap note appears in final output
- **WHEN** a workflow completes with one or more soft-degraded providers AND the user has NOT marked those providers `never_ask`
- **THEN** the final assistant output includes a short note (e.g., under a `**Data gaps**` section) describing which fallback was used AND the `/connect` remediation
- **AND** the note is neutral, not apologetic or error-styled

#### Scenario: Soft provider silence when never-ask is set
- **WHEN** a workflow completes with a soft-degraded Brave provider AND `providers.brave.status === "never_ask"`
- **THEN** the final output MAY still describe the omission BUT does NOT include the `/connect` remediation link for that provider

### Requirement: At most one hard-provider prompt fires per workflow invocation
When a single workflow invocation triggers credential_required conditions for multiple hard providers in the same session (e.g., `analyze NVDA` needs both Alpha Vantage and FRED and neither is configured), the interception handler SHALL prompt at most once. The first hard provider by `PROVIDERS` declaration order triggers the prompt; any subsequent hard-provider credential-required signals in the same workflow invocation SHALL be silently converted to `skipped` placeholders so the user is not double-interrupted.

#### Scenario: First hard provider prompts, second does not
- **WHEN** a workflow invocation produces `credential_required` for Alpha Vantage first, then for FRED
- **THEN** Alpha Vantage triggers the four-option prompt
- **AND** FRED's signal is converted to a `skipped` placeholder without prompting
- **AND** the final output mentions both gaps

#### Scenario: Cap does not leak across workflow invocations
- **WHEN** a user runs `analyze NVDA` (prompted for Alpha Vantage, picked "continue without") and then runs `analyze TSLA` later in the same session
- **THEN** the second workflow does NOT re-prompt for Alpha Vantage (session-level dedup still applies)
- **AND** the cap is per-invocation, not state that persists

### Requirement: Just-in-time prompt offers exactly four options with deterministic outcomes
When the interception handler shows a missing-credential prompt for a hard provider, it SHALL call the exported `promptUser` helper with a four-option select shape. The option copy SHALL be derived from the provider descriptor (`displayName`, `unlocks`, `fallbackDescription`, `snoozeDurationDays`, `instructionsHint`). The user's answer SHALL be mapped to a `PromptChoice` by prefix match on the first word of each option label (`"Connect"`, `"Continue"`, `"Snooze"`, `"Never"`).

| Option label prefix | State mutation | Workflow outcome |
|---|---|---|
| Connect (now) | On success: `{ status: "completed", lastPromptAt: now }` | Re-run the original tool call; use the fresh result if Pi supports re-dispatch, otherwise return a `"key saved — next turn will use it"` placeholder |
| Continue (without …) | No mutation | Return `skipped` placeholder |
| Snooze (…) | `{ status: "snoozed", snoozeUntil: now + snoozeDurationDays, lastPromptAt: now }` | Return `skipped` placeholder |
| Never (ask again) | `{ status: "never_ask", lastPromptAt: now }` | Return `skipped` placeholder (with remediation suppressed downstream) |

#### Scenario: Connect now success path
- **WHEN** the user picks the option beginning with "Connect" AND `runProviderConnect("alpha_vantage")` succeeds
- **THEN** the provider state becomes `{ status: "completed", lastPromptAt: <now> }`
- **AND** the tool call is re-executed (or a clear fallback placeholder is used if Pi does not support re-dispatch)
- **AND** the LLM context receives either the fresh successful tool result OR the fallback placeholder

#### Scenario: Connect now cancelled
- **WHEN** the user picks "Connect now" AND then cancels the browser/input flow
- **THEN** the provider state is NOT mutated
- **AND** the LLM context receives a `skipped` placeholder (as if the user had picked "continue without")
- **AND** session dedup prevents a second prompt for the same provider

#### Scenario: Connect now blocked by env var
- **WHEN** the user picks "Connect now" AND the target credential is currently provided by an environment variable
- **THEN** the browser does NOT open and no paste is requested
- **AND** the user sees a plain-language notification explaining that the environment variable takes precedence and must be unset first
- **AND** the provider state is NOT mutated
- **AND** the LLM context receives a `skipped` placeholder with a remediation string that explains the env-var situation

#### Scenario: Continue without mutates nothing
- **WHEN** the user picks the option beginning with "Continue"
- **THEN** the onboarding state is unchanged
- **AND** the LLM context receives a `skipped` placeholder

#### Scenario: Snooze uses descriptor duration
- **WHEN** the user picks the snooze option for Finnhub AND `snoozeDurationDays === 7`
- **THEN** `providers.finnhub.snoozeUntil` is set to exactly 7 days from `providers.finnhub.lastPromptAt`

#### Scenario: Never ask is permanent
- **WHEN** the user picks the "Never" option for Brave
- **THEN** `providers.brave.status === "never_ask"` persists across sessions

### Requirement: Skipped results use tagged text in tool-result `content`, not JSON in `details`
When the interception handler produces a skipped placeholder, the substitution SHALL place a tagged text block in the tool result's `content` array. The tag format SHALL be a single line: `[OPENCANDLE_SKIPPED provider=<id> reason=<reason> remediation="<copy>"]`, followed by a natural-language paragraph describing what was omitted. The `details` field MAY carry a parallel structured object for UI/test assertions but is NOT the LLM-facing contract. Pi provider adapters serialize `content` to the LLM — `details` is invisible to the model.

The system prompt SHALL include exactly one instruction telling the model how to handle the tagged block: surface a neutral gap note under a `**Data gaps**` heading in the final answer, quoting the `remediation` string verbatim, EXCEPT when the remediation string contains `(silenced)`, in which case omit the remediation link.

#### Scenario: Tagged block appears in content
- **WHEN** the interception handler replaces a tool result with a skipped placeholder
- **THEN** the result's `content[0].text` begins with `[OPENCANDLE_SKIPPED provider=<id> ...]`
- **AND** a following line describes the omission in natural language

#### Scenario: System prompt references skipped handling
- **WHEN** the system prompt is built
- **THEN** it includes exactly one instruction on how to handle `[OPENCANDLE_SKIPPED ...]` tags in tool results
- **AND** the instruction says to put gap notes under a `**Data gaps**` heading in the final answer

#### Scenario: Gap note appears in final output
- **WHEN** `analyze NVDA` runs with Alpha Vantage missing AND the user picks "continue without"
- **THEN** the final assistant output contains a `**Data gaps**` section
- **AND** that section mentions fundamentals were omitted
- **AND** that section quotes the remediation string (e.g., `run /connect financials`)
- **AND** no error or stack trace appears in the output

#### Scenario: Never-ask suppresses the remediation link
- **WHEN** a workflow completes with a skipped Brave provider AND `providers.brave.status === "never_ask"`
- **THEN** the remediation string passed to the tagged block contains `(silenced)`
- **AND** the model's final output describes the omission but does NOT include the `/connect` remediation text for Brave

### Requirement: `/connect` command is a discoverable, reconfigurable setup surface using friendly aliases
The extension SHALL register a Pi command `connect` that supports three invocations:
- `/connect` with no argument SHALL open a picker listing every provider in the registry with human labels and current state (completed / snoozed-until / never-ask / not configured)
- `/connect <argument>` SHALL call `resolveProviderFromArgument(<argument>)` from the provider registry. When it returns a single descriptor, the flow proceeds directly. When it returns an array (category group), a sub-picker appears. When it returns `undefined`, a clear error notification lists valid aliases and category names
- In all single-provider cases, the command handler SHALL call `runProviderConnect(providerId)`

After a successful connect, the onboarding state SHALL be updated to `completed` for that provider.

#### Scenario: Bare /connect opens picker with human labels
- **WHEN** the user types `/connect` with no argument
- **THEN** a picker appears listing all five providers
- **AND** each line uses the provider's `displayName` followed by a short phrase describing what it unlocks (e.g., `"Alpha Vantage — company financials and valuation"`)
- **AND** each line shows the current state (`Configured`, `Snoozed until <date>`, `Never-ask`, or `Not configured`)

#### Scenario: /connect financials jumps to Alpha Vantage
- **WHEN** the user types `/connect financials` AND `"financials"` is in Alpha Vantage's aliases AND no other provider claims it
- **THEN** the flow proceeds directly to Alpha Vantage connect without a picker

#### Scenario: /connect search opens sub-picker
- **WHEN** the user types `/connect search` AND both Exa and Brave match the alias OR both are in the same web_search category
- **THEN** a sub-picker appears listing just those two providers

#### Scenario: /connect <plain id> targets that provider
- **WHEN** the user types `/connect finnhub`
- **THEN** the flow proceeds directly to Finnhub connect

#### Scenario: /connect with unknown argument reports error
- **WHEN** the user types `/connect not_a_real_thing`
- **THEN** a clear error notification explains the valid aliases and provider ids
- **AND** no connect flow starts

#### Scenario: Successful /connect updates state
- **WHEN** `/connect fred` completes successfully
- **THEN** `providers.fred.status === "completed"` AND `providers.fred.lastPromptAt` is set

### Requirement: `runProviderConnect` handles env-var precedence and distinguishes validation failure modes
The shared `runProviderConnect(ctx, providerId)` function SHALL, before opening the browser, call `getCredentialSource(providerId)` from the provider registry. If the source is `"env"`, it SHALL NOT open the browser and SHALL NOT prompt for a key. Instead it SHALL show a plain-language notification explaining that the environment variable takes precedence and MUST be unset for `/connect` to take effect, and return `{ status: "blocked_by_env" }`.

After a successful paste, `runProviderConnect` SHALL make a lightweight validation request against the provider's API before persisting. The validation SHALL distinguish three outcomes:
1. Success — key works. Persist to `~/.opencandle/config.json`, refresh the cached `Config`, mark state `completed`, return `{ status: "connected" }`.
2. Authentication failure — the provider returned a 401/403 or auth-specific error. Show a clear message explaining the key is invalid, offer retry (re-paste) or cancel. Do NOT persist.
3. Transient failure — network error, 5xx, or timeout. Show a neutral message explaining the provider may be unavailable, offer `"save anyway"`, `"retry validation"`, or `"cancel"`. The `"save anyway"` path persists the key but does NOT mark state `completed`.

#### Scenario: Env-precedence short-circuit
- **WHEN** `runProviderConnect(ctx, "alpha_vantage")` is called AND `ALPHA_VANTAGE_API_KEY` is set in the environment
- **THEN** no browser opens AND no input prompt appears
- **AND** a notification explains the env-var situation
- **AND** the function returns `{ status: "blocked_by_env" }`
- **AND** no file is written
- **AND** onboarding state is unchanged

#### Scenario: Valid key persists
- **WHEN** the user pastes a key AND validation succeeds
- **THEN** the key is written to the file config at `descriptor.configPath`
- **AND** the in-memory `Config` cache is refreshed
- **AND** `providers.<id>.status === "completed"`
- **AND** the function returns `{ status: "connected" }`

#### Scenario: Auth-failing key prompts retry
- **WHEN** the user pastes a key AND validation returns a 401/403 or auth-specific error
- **THEN** the user sees a message explaining the key was rejected
- **AND** is offered retry or cancel
- **AND** the key is NOT persisted to disk
- **AND** state is NOT marked completed on cancel

#### Scenario: Transient validation failure offers save-anyway
- **WHEN** the user pastes a key AND validation returns a 5xx or network error
- **THEN** the user sees a neutral message saying the provider could not be reached
- **AND** is offered save-anyway / retry / cancel
- **AND** the save-anyway path persists the key BUT does NOT mark state `completed`

#### Scenario: Cancel after invalid paste mutates nothing
- **WHEN** the user pastes a key AND picks cancel at any stage
- **THEN** `~/.opencandle/config.json` is unchanged
- **AND** `providers.<id>` is NOT marked completed

### Requirement: API-key entry path uses an OpenCandle-branded dialog, not Pi's LoginDialogComponent
When the user chooses "paste an API key" during LLM startup, the setup flow SHALL NOT use Pi's `LoginDialogComponent`. Instead, it SHALL use a simple OpenCandle-voiced flow built on `ctx.ui.input`, with a descriptive preamble and OpenCandle-branded copy. `LoginDialogComponent` SHALL remain in use for OAuth sign-in paths (Google, OpenAI, Anthropic) where it handles the callback dance.

#### Scenario: API-key entry uses OpenCandle dialog
- **WHEN** the user picks "paste an API key" during startup
- **THEN** the resulting prompt does NOT render `LoginDialogComponent`
- **AND** the surrounding copy uses OpenCandle voice (not generic "Connect an AI model" wording)

#### Scenario: OAuth still uses LoginDialogComponent
- **WHEN** the user picks "Sign in with Google/OpenAI/Anthropic" during startup
- **THEN** `LoginDialogComponent` is still used for the callback flow
- **AND** the surrounding title/body chrome uses OpenCandle copy
