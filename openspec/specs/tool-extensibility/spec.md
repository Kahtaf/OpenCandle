# Tool Extensibility Specification

## Purpose
TBD - normalized from existing baseline requirements.

## Requirements

### Requirement: Add-on tool registry uses first-class naming
The addon tool registry in `tool-kit.ts` SHALL export `registerTools`, `getAddonToolDescriptions`, and use `addonToolRegistry` internally. The `PromptContextBuilder` option SHALL be renamed from `thirdPartyToolDescriptions` to `addonToolDescriptions`. The `buildToolCatalog()` heading SHALL be renamed from "Third-Party Tools" to "Add-on Tools". The `SessionCoordinator` SHALL import and use the renamed exports. The root `index.ts` SHALL re-export `registerTools` instead of `registerOpenCandleTools`. The previous "thirdParty" naming SHALL be removed entirely.

#### Scenario: Registering an add-on tool
- **WHEN** an add-on extension calls `registerTools(pi, [myTool])`
- **THEN** the tool is registered with Pi via `pi.registerTool()` AND recorded in the addon registry with its name and description

#### Scenario: Querying registered add-on tools
- **WHEN** `getAddonToolDescriptions()` is called after add-on tools have been registered
- **THEN** it returns an array of `{ name, description }` for all registered add-on tools

#### Scenario: System prompt displays add-on tools with correct heading
- **WHEN** add-on tools are registered AND `buildToolCatalog()` renders the tool-catalog section
- **THEN** the section includes an "Add-on Tools" heading (not "Third-Party Tools") listing each add-on tool

#### Scenario: No add-on tools registered
- **WHEN** no add-on tools have been registered
- **THEN** the tool-catalog section contains only built-in tool descriptions with no "Add-on Tools" heading

### Requirement: createTool helper validates conventions at definition time
`tool-kit.ts` SHALL export a `createTool()` function that accepts a tool configuration object and returns a valid `AgentTool`. It SHALL validate naming and description at creation time. It SHALL NOT validate `execute()` return shape at runtime.

#### Scenario: Valid tool creation
- **WHEN** `createTool()` is called with a snake_case verb-prefixed name, a non-empty description, a label, Typebox parameters, and an execute function
- **THEN** it returns a valid `AgentTool` object with all fields set

#### Scenario: Invalid tool name rejected
- **WHEN** `createTool()` is called with a name that is not snake_case or not verb-prefixed (e.g., `"twitterSentiment"`, `"sentiment"`)
- **THEN** it throws an error describing the naming convention

#### Scenario: Missing description rejected
- **WHEN** `createTool()` is called with an empty or missing description
- **THEN** it throws an error requiring a description

### Requirement: Duplicate tool name detection
When `registerTools()` registers a tool whose name already exists in the addon registry, it SHALL log a warning to stderr and overwrite the existing entry.

#### Scenario: Duplicate name warns
- **WHEN** `registerTools(pi, [toolA])` is called and a tool named `toolA.name` is already in the registry
- **THEN** a warning is logged to stderr containing the duplicate tool name AND the registry entry is overwritten with the new tool

#### Scenario: Unique names do not warn
- **WHEN** `registerTools(pi, [toolA])` is called and no tool with `toolA.name` exists in the registry
- **THEN** no warning is logged

### Requirement: Consumer smoke test validates published package exports
A test SHALL exist that builds the package first (`npm run build`), then imports `registerTools`, `createTool`, `getAddonToolDescriptions`, `cache`, `rateLimiter`, `httpGet`, and `Type` from the `opencandle/tool-kit` subpath export (resolving through `package.json` exports to `dist/tool-kit.js`), and verifies they are defined and callable. The test MUST NOT import from source paths (`../../src/tool-kit.js`) — it SHALL use the package subpath to catch `package.json` export map or build artifact breakage.

#### Scenario: All public exports are accessible via package subpath
- **WHEN** the package is built AND the smoke test imports from the `opencandle/tool-kit` subpath
- **THEN** all exported functions are defined and callable, confirming the `package.json` exports map and built artifacts are correct

### Requirement: Providers throw `ProviderCredentialError` when credentials are missing or stale
A new exported class `ProviderCredentialError` SHALL be added at a shared location (e.g., `src/providers/provider-credential-error.ts`) with the shape:
```
export class ProviderCredentialError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly reason: "missing" | "stale",
    readonly httpStatus?: number,
  ) { super(`credential_required:${provider}:${reason}`); }
}
```
All five provider modules (`src/providers/alpha-vantage.ts`, `fred.ts`, `finnhub.ts`, `exa-search.ts`, and the Brave branch of `web-search.ts`) SHALL throw `ProviderCredentialError` when they detect a missing credential up front (no HTTP call) or an auth-error response (401/403 after HTTP call). They SHALL NOT throw ad-hoc `Error("API key may be invalid")` strings for credential problems after this change lands. The `reason` discriminator SHALL be `"missing"` when the credential was absent before the HTTP call, and `"stale"` when the HTTP call returned an auth error despite a credential being configured.

#### Scenario: Missing credential, no HTTP call
- **WHEN** `getAlphaVantageQuote()` is invoked AND `hasCredential("alpha_vantage")` returns `false`
- **THEN** the function throws `ProviderCredentialError` with `provider: "alpha_vantage"` and `reason: "missing"`
- **AND** no HTTP request is made

#### Scenario: Stale credential after auth error
- **WHEN** `getFinnhubCompanyNews()` makes a request with a configured key AND the response is HTTP 401
- **THEN** the function throws `ProviderCredentialError` with `provider: "finnhub"`, `reason: "stale"`, and `httpStatus: 401`
- **AND** does not throw a generic `Error("Finnhub API key may be invalid or expired")`

#### Scenario: Non-credential errors still throw plain Error
- **WHEN** a provider call fails with a 5xx or network error
- **THEN** the function throws a plain `Error` (not `ProviderCredentialError`)
- **AND** the `wrapProvider` helper catches that plain error as `status: "unavailable"`

### Requirement: `wrapProvider` re-throws `ProviderCredentialError` instead of catching it as unavailable
`src/providers/wrap-provider.ts` SHALL be modified so that the `catch` block detects `ProviderCredentialError` and re-throws it unchanged, rather than converting it into a `{ status: "unavailable" }` envelope. Every other exception type continues to be caught and converted as today.

#### Scenario: Credential error propagates through wrapProvider
- **WHEN** `wrapProvider("alpha_vantage", async () => { throw new ProviderCredentialError("alpha_vantage", "missing"); })` is called
- **THEN** the returned promise rejects with the `ProviderCredentialError` instance (not resolves with `status: "unavailable"`)

#### Scenario: Non-credential error still becomes unavailable
- **WHEN** `wrapProvider("alpha_vantage", async () => { throw new Error("network timeout"); })` is called
- **THEN** the returned promise resolves with `{ status: "unavailable", reason: "network timeout", provider: "alpha_vantage" }`

### Requirement: Tools catch `ProviderCredentialError` at their execute boundary and emit tagged-content tool results
Every tool under `src/tools/` that invokes one of the five credentialed providers (directly or via `wrapProvider`) SHALL wrap its core logic in a try/catch that detects `ProviderCredentialError`. On catch, the tool SHALL return a tool result whose `content` array contains a text entry beginning with a tagged line:
```
[OPENCANDLE_CREDENTIAL_REQUIRED provider=<id> reason=<missing|stale> unlocks="<comma-separated>" fallback=<description|none>]
```
followed by a natural-language description. The tool result's `details` field MAY carry a parallel structured object `{ credentialRequired: { provider, reason, ... } }` for UI/test assertions, but is NOT the LLM-facing contract.

A shared helper `withCredentialCheck(providerId, fn)` SHALL be available in `src/onboarding/tool-helpers.ts` to reduce per-tool boilerplate. Tools SHOULD use this helper rather than hand-writing the try/catch.

#### Scenario: Tool catches missing-credential and emits tagged content
- **WHEN** a tool that depends on Alpha Vantage is executed AND `hasCredential("alpha_vantage")` is false AND the provider throws `ProviderCredentialError`
- **THEN** the tool's return value has `content[0].text` beginning with `[OPENCANDLE_CREDENTIAL_REQUIRED provider=alpha_vantage reason=missing ...]`
- **AND** the tool does NOT rethrow

#### Scenario: Tool catches stale-credential and emits tagged content with reason=stale
- **WHEN** a tool call receives a `ProviderCredentialError` with `reason: "stale"` from a provider
- **THEN** the tool's return value has `content[0].text` containing `reason=stale`

#### Scenario: Tool does not catch non-credential errors
- **WHEN** a tool call receives a plain `Error` (not `ProviderCredentialError`) from a provider
- **THEN** the tool does NOT emit a credential-required tag
- **AND** the error continues to propagate or be handled by existing error logic

#### Scenario: withCredentialCheck helper is used by tools
- **WHEN** tool files under `src/tools/` that depend on credentialed providers are audited after this change
- **THEN** they either call `withCredentialCheck(providerId, fn)` or hand-write an equivalent try/catch per the requirement

### Requirement: Soft-tier providers emit `[OPENCANDLE_SOFT_DEGRADED ...]` tags when falling back silently
When a soft-tier provider (Finnhub, Brave, Exa per the `provider-registry` capability) is invoked without a credential, the tool SHALL use the provider's fallback path (the keyless Exa MCP endpoint for Exa, DuckDuckGo for Brave, or the sentiment-summary's continue-without-news path for Finnhub) AND SHALL include a subtle tag in the returned `content` describing the degradation:
```
[OPENCANDLE_SOFT_DEGRADED provider=<id> fallback=<short-desc> remediation="run /connect <alias> to enable"]
```
This tag is distinct from `OPENCANDLE_CREDENTIAL_REQUIRED` — it does NOT trigger a just-in-time prompt. The interception handler accumulates these tags across the workflow and surfaces them as gap notes in the final answer.

#### Scenario: Brave degrades silently with tag
- **WHEN** a web_search tool call reaches the Brave branch AND `hasCredential("brave")` is false AND a DuckDuckGo fallback succeeds
- **THEN** the tool returns the DDG results normally
- **AND** the tool result `content` includes a line beginning with `[OPENCANDLE_SOFT_DEGRADED provider=brave ...]`
- **AND** no `ProviderCredentialError` is thrown

#### Scenario: Exa degrades silently with tag when key is missing
- **WHEN** an Exa search is invoked AND `hasCredential("exa")` is false AND the keyless MCP path succeeds
- **THEN** the tool returns the MCP results normally
- **AND** the result `content` includes `[OPENCANDLE_SOFT_DEGRADED provider=exa fallback=mcp ...]`

#### Scenario: Soft-degraded tag does not trigger a prompt
- **WHEN** the interception handler (Pi `tool_result` hook) sees only `[OPENCANDLE_SOFT_DEGRADED ...]` tags in a tool result
- **THEN** it does NOT call `promptUser`
- **AND** it does NOT mutate any provider state
- **AND** it records the degradation in a per-workflow accumulator for the final gap-note synthesis

### Requirement: The Pi `tool_result` extension hook drives credential interception
The OpenCandle extension SHALL register a handler on Pi's `tool_result` event (`pi.on("tool_result", handler)`, available in `@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`). The handler SHALL inspect every tool result's `content` for the tags `[OPENCANDLE_CREDENTIAL_REQUIRED ...]` and `[OPENCANDLE_SOFT_DEGRADED ...]`, AND SHALL also check `details.credentialRequired` / `details.softDegraded` as a structured backup path. When a credential-required tag is found, the handler SHALL delegate to the pure function `resolveCredentialRequired(match, state, sessionSet, now)` and act on its result (skip, prompt, or rerun). When a soft-degraded tag is found, the handler SHALL record it in a per-session accumulator without prompting. The handler SHALL NOT be registered inside `src/runtime/session-coordinator.ts` — it is an extension-level hook, not a SessionCoordinator feature.

#### Scenario: Handler registered on session start
- **WHEN** the OpenCandle extension is loaded AND its initialization runs
- **THEN** `pi.on("tool_result", <handler>)` is called exactly once

#### Scenario: Ok results pass through untouched
- **WHEN** a tool returns a result with no `[OPENCANDLE_CREDENTIAL_REQUIRED ...]` or `[OPENCANDLE_SOFT_DEGRADED ...]` tag in `content`
- **THEN** the handler returns a `ToolResultEventResult` that does not modify the tool result
- **AND** the result passes through to the LLM context unchanged

#### Scenario: Credential-required tag with never-ask state is replaced with skipped placeholder
- **WHEN** a tool returns `content` containing `[OPENCANDLE_CREDENTIAL_REQUIRED provider=alpha_vantage ...]` AND `providers.alpha_vantage.status === "never_ask"`
- **THEN** the handler returns a `ToolResultEventResult` that replaces `content` with a `[OPENCANDLE_SKIPPED ...]` tagged block whose remediation string contains `(silenced)`

#### Scenario: Credential-required tag with missing state triggers prompt
- **WHEN** a tool returns `content` containing `[OPENCANDLE_CREDENTIAL_REQUIRED provider=alpha_vantage reason=missing ...]` AND no state entry exists for `alpha_vantage` AND no prompt has yet fired for that provider this session
- **THEN** the handler calls `promptUser` with the four-option shape derived from the provider descriptor
- **AND** only after the user answers does the handler return a `ToolResultEventResult`

#### Scenario: Per-session deduplication
- **WHEN** two tool calls in the same session both emit `[OPENCANDLE_CREDENTIAL_REQUIRED provider=alpha_vantage ...]`
- **THEN** only the first call triggers `promptUser`
- **AND** the second call is handled as if the user had already answered (using the state resulting from the first answer)

#### Scenario: Per-workflow cap for multiple hard providers
- **WHEN** a single workflow invocation produces credential_required tags for both Alpha Vantage and FRED
- **THEN** only the first-by-registry-order (Alpha Vantage) triggers `promptUser`
- **AND** the second is converted to a `skipped` placeholder without prompting

### Requirement: Skipped and degraded tool-result content use a single shared tag builder and parser
The tagged-content strings `[OPENCANDLE_CREDENTIAL_REQUIRED ...]`, `[OPENCANDLE_SOFT_DEGRADED ...]`, and `[OPENCANDLE_SKIPPED ...]` SHALL be generated and parsed by a single module, `src/onboarding/tool-tags.ts`, which exports:
- `buildCredentialRequiredTag(args): string`
- `buildSoftDegradedTag(args): string`
- `buildSkippedTag(args): string`
- `parseToolTag(text: string): { kind: "credential_required" | "soft_degraded" | "skipped"; ...fields } | undefined`

This keeps the format in one place and ensures the builder → parser roundtrip is a single testable contract.

#### Scenario: Builder and parser roundtrip
- **WHEN** `parseToolTag(buildCredentialRequiredTag({ provider: "alpha_vantage", reason: "missing", unlocks: ["fundamentals"], fallback: null }))` is called
- **THEN** it returns `{ kind: "credential_required", provider: "alpha_vantage", reason: "missing", unlocks: ["fundamentals"], fallback: null }`

#### Scenario: Parser ignores non-tagged lines
- **WHEN** `parseToolTag("this is a normal sentence")` is called
- **THEN** it returns `undefined`

#### Scenario: Parser is tolerant of extra fields
- **WHEN** `parseToolTag` receives a tag line with a field it does not recognize
- **THEN** it ignores the unknown field AND still parses the known fields
