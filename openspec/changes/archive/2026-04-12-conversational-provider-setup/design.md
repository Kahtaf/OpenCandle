## Context

OpenCandle's current startup flow lives in `src/pi/setup.ts` and runs on every `session_start` event from `src/pi/opencandle-extension.ts`. It has two phases:

1. **`runLlmSetup`** — forces sign-in to Google/OpenAI/Anthropic via Pi's `LoginDialogComponent`, or accepts a pasted API key. Blocking. The agent cannot start chat without an LLM. This phase is correct in intent — an LLM is genuinely required — but the copy, header chrome, and modal flow feel like Pi, not OpenCandle.
2. **`runFinanceSetup`** — a one-shot "Connect market data providers? [Yes/Skip]" gate. If the user picks Yes, the flow pops a browser window for Alpha Vantage signup, waits for paste, then pops another browser window for FRED signup, waits for paste, then completes. Only two of the five credentialed providers are handled (Alpha Vantage and FRED). The other three — Finnhub, Brave Search, Exa — have no onboarding path; users must edit `~/.opencandle/config.json` or set env vars directly.

The per-tool experience when a credential is missing is inconsistent: `finnhub.ts` throws `"Finnhub API key may be invalid or expired"` on 401, `web-search.ts` throws similar for Brave 401, `exa-search.ts` silently falls back to the keyless MCP path, and Alpha Vantage/FRED simply return errors that bubble up through workflows as analyst failures. None of these surface to the user as "you could fix this in 30 seconds."

OpenClaw (a sibling Pi-based product, see `github.com/openclaw/openclaw`) solved the same problem by moving setup out of the Pi modal system entirely. Their `openclaw onboard` CLI is purpose-built, each provider has a setup descriptor in a plugin registry (`src/plugins/setup-registry.ts`), and reconfiguration happens via sectioned commands (`openclaw configure --section web`). Their TUI chat is where most of the ongoing setup conversation lives — the agent itself offers step-by-step instructions when a credential is missing.

OpenCandle is pre-launch. There are no existing users, no deployed `onboarding.json` files in the wild, and no product expectations to preserve. This change replaces the current wizard wholesale with a conversational, just-in-time, registry-driven system before any of those constraints exist.

## Goals / Non-Goals

**Goals:**
- Startup experience under 60 seconds for a user who just wants to chat: sign in with an LLM, see a warm welcome, start asking questions.
- Zero data-provider decisions during first run. The user learns about Alpha Vantage, FRED, Finnhub, Brave, and Exa *in the moment* they would benefit from them, not upfront.
- Universal pattern: every credentialed provider follows the same missing-credential → agent offer → user choice → outcome flow. No per-provider special cases in any code path.
- Single source of truth for provider metadata. Adding a sixth provider later means adding one registry entry, not touching setup, `/connect`, tool credential checks, or the orchestrator.
- Sectioned, reconfigurable setup via `/connect` — not a monolithic wizard that users fear re-running.
- Non-technical user as the implicit persona for every copy decision. No raw error messages, no jargon, no references to env vars or file paths in the agent's voice.

**Non-Goals:**
- Re-auth flow for expired LLM OAuth tokens (separate future change — "failure-as-invitation").
- Footer status line indicators showing provider health.
- Restyling `LoginDialogComponent` internals. OAuth sign-in is allowed to look Pi-like for ~10 seconds during the callback dance.
- Migration of existing `OnboardingState.financeSetupStatus` values. Product is pre-launch; schema change is clean-break.
- Changes to any free provider (Yahoo Finance, CoinGecko, Reddit, SEC EDGAR, Fear & Greed). Those have no credential and are unaffected.
- Changes to workflow orchestration beyond adding a single interception hook for `credential_required` results.
- Dashboard/UI for provider status. `/connect` is a terminal command.

## Decisions

### Decision 1: Provider registry as a static descriptor array, not a plugin system

**Choice:** A single module `src/onboarding/providers.ts` exports a `PROVIDERS` array of `ProviderDescriptor` records. One entry per credentialed provider (Alpha Vantage, FRED, Finnhub, Brave, Exa). All setup pathways import this module and iterate it.

**Shape:**
```
interface ProviderDescriptor {
  id: ProviderId;                    // "alpha_vantage" | "fred" | "finnhub" | "brave" | "exa"
  displayName: string;               // "Alpha Vantage"
  category: ProviderCategory;        // "fundamentals" | "macro" | "news" | "web_search"
  signupUrl: string;                 // URL to open in runProviderConnect
  freeTier: boolean;                 // for UI copy
  envVar: string;                    // "ALPHA_VANTAGE_API_KEY"
  configPath: readonly string[];     // ["providers", "alphaVantage", "apiKey"]
  unlocks: readonly string[];        // ["fundamentals", "DCF", "earnings history"]
  fallbackDescription: string | null; // "Yahoo snapshot data only" or null if no fallback
  snoozeDurationDays: number;        // 7 for all providers in this change
  instructionsHint: string;          // one-line human copy: "Free, ~30 seconds, signup opens in your browser"
}
```

**Rationale:** OpenClaw uses a full plugin setup registry because they have ~100 providers across extensions. OpenCandle has five, bounded, in-repo. A static array keeps the code trivial to read, trivially type-safe, and avoids the discovery/jiti-loader machinery OpenClaw needed. The registry can evolve to a plugin system later if add-on providers (per `docs/build-a-tool.md`) start needing credential onboarding — but that's a future change.

**Alternatives considered:**
- *Inline provider data inside `setup.ts`.* Rejected — precisely what we're trying to delete.
- *Plugin-discovered registry (OpenClaw style).* Rejected — over-engineered for five providers.
- *JSON config file.* Rejected — loses type safety; `configPath` and `id` both benefit from discriminated union types.

### Decision 2: Credential signaling is a layered contract — `ProviderCredentialError` at the provider, tagged text block at the tool, Pi `tool_result` hook at the extension

**Choice:** Three layers of signaling, each with a clear responsibility:

**Layer A — Provider (`src/providers/*.ts`).** Providers remain pure fetchers. When a credential is missing or stale, they throw a typed error:
```
export class ProviderCredentialError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly reason: "missing" | "stale",
    readonly httpStatus?: number,
  ) { super(`credential_required:${provider}:${reason}`); }
}
```
This replaces the current ad-hoc throw sites (`finnhub.ts:116`, `web-search.ts:237`). Providers do not know about registries, tool result shapes, or LLM context.

**Layer B — `wrapProvider`.** The wrapper at `src/providers/wrap-provider.ts:30` currently catches *every* exception and returns `{ status: "unavailable" }`. That swallows `ProviderCredentialError`. The wrapper is updated with one new branch: `if (error instanceof ProviderCredentialError) throw error;` — re-throw so the error reaches the tool layer untransformed. Every other exception continues to be caught as `unavailable`.

**Layer C — Tool (`src/tools/*.ts`).** Every tool that depends on one of the five credentialed providers wraps its `execute()` body with a try/catch that handles `ProviderCredentialError` by returning a tool result whose `content` carries a tagged text block:
```
{
  content: [{
    type: "text",
    text: `[OPENCANDLE_CREDENTIAL_REQUIRED provider=alpha_vantage reason=missing unlocks="fundamentals, DCF, earnings" fallback=none]`
  }],
  details: { credentialRequired: { provider: "alpha_vantage", reason: "missing" } },
}
```
The tagged text block is the *LLM-facing contract*. It is what Pi provider adapters serialize into the model's conversation (confirmed in `@earendil-works/pi-ai/dist/providers/openai-completions.js:551`, `.../google-shared.js:179`, `.../anthropic.js:657`). The `details` field is auxiliary UI/test metadata only — the model does not see it.

**Layer D — Extension `tool_result` hook (`src/pi/opencandle-extension.ts`).** The OpenCandle extension registers a handler on Pi's `tool_result` event (`pi.on("tool_result", handler)`, see `@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:726`). The handler inspects every tool result from every tool — including OpenCandle's own and any add-on tools — looking for the `[OPENCANDLE_CREDENTIAL_REQUIRED ...]` tag in content, or the structured `credentialRequired` field in `details` as a backup. When detected, it runs the decision logic (see Decision 3) and either replaces the result with a skipped placeholder or pauses and prompts.

**Rationale:** Codex's review surfaced that the SessionCoordinator at `src/runtime/session-coordinator.ts:164` only queues user prompts for workflows — it never sees tool outputs. Pi already exposes a *real* tool-result interception hook at the extension level, which runs inside Pi's agent runtime (`runner.js:427`), seeing every tool result uniformly. Building a parallel interception point inside SessionCoordinator would be both technically wrong (wrong layer) and redundant with an existing Pi surface.

The layering also keeps each module's responsibilities clean: providers know about HTTP, wrap-provider knows about circuit breakers and stale caches, tools know about parameter validation and LLM-facing output shaping, and the extension knows about Pi lifecycle events and user interaction. Putting the credential check at the provider layer would force providers to depend on the registry; putting it at wrap-provider would force the wrapper to know about tool result shapes; putting it at the extension *only* would mean tools that hit 401s mid-execution have no structured way to communicate upward. The layered choice lets each part of the stack stay minimal.

**Alternatives considered:**
- *Tools check `hasCredential()` upfront before calling the provider.* Partially adopted — tools SHOULD check first to avoid pointless HTTP calls, but they MUST still catch `ProviderCredentialError` from the provider layer to handle stale (post-HTTP) cases. So both the upfront check and the catch exist; they're complementary.
- *Return `{ status: "credential_required" }` as a `details`-only marker.* Rejected — Codex verified Pi serializes `content`, not `details`. A `details`-only marker would not drive the LLM gap note.
- *Intercept in SessionCoordinator.* Rejected — wrong layer, does not see tool results.
- *Intercept inside each tool's try/catch and handle the prompt inline.* Rejected — every tool would re-implement the decision table, duplicating logic and making it untestable as a unit.

### Decision 3: The `tool_result` interception handler is a pure function driving side effects

**Choice:** The core decision logic lives in `src/onboarding/credential-interceptor.ts` as a pure function:
```
function resolveCredentialRequired(
  match: CredentialRequiredMatch,
  state: OnboardingState,
  sessionSet: Set<ProviderId>,
  now: Date,
): InterceptAction
```
where `InterceptAction` is a discriminated union: `{ kind: "skip", placeholder }` | `{ kind: "prompt", descriptor }` | `{ kind: "rerun" }`. This function is trivially unit-testable — every branch of the decision table is one test case with no Pi dependencies.

The extension wires this pure function to Pi's `tool_result` hook. The wire-up handler is responsible for:
1. Detecting the `[OPENCANDLE_CREDENTIAL_REQUIRED ...]` tag in `ToolResultEvent.content` (or `details.credentialRequired` as fallback).
2. Calling `resolveCredentialRequired(match, state, sessionSet, new Date())`.
3. Acting on the result:
   - `kind: "skip"` → modify the `ToolResultEventResult` to replace `content` with the skipped placeholder text block.
   - `kind: "prompt"` → call `promptUser(ctx, opts)` (see Decision 4), act on the user's answer, then re-dispatch to `resolveCredentialRequired` if needed (e.g., if the user picked "connect now" and succeeded, the handler runs the tool again via Pi's re-dispatch path or, if that's not available, synthesizes a follow-up tool invocation; see Open Questions).

**Decision table (canonical):**

| State for provider | Session already prompted? | Action |
|---|---|---|
| `never_ask` | — | `skip` (silent degrade to placeholder) |
| `snoozed`, `snoozeUntil > now` | — | `skip` |
| `snoozed`, `snoozeUntil ≤ now` | no | `prompt` |
| `snoozed`, `snoozeUntil ≤ now` | yes | `skip` (honor first-answer this session) |
| `completed` AND `reason === "stale"` | no | `prompt` (this is the one stale-cred handling this change ships) |
| `completed` AND `reason === "missing"` | — | this combination is a bug; log and `skip` |
| missing entry | no | `prompt` |
| missing entry | yes | `skip` (honor first-answer this session) |

**Prompt-path outcomes:**

| User choice | Persistent state mutation | Tool result returned to LLM |
|---|---|---|
| Connect now → success | `{ status: "completed", lastPromptAt: now }` | Re-executed tool's fresh result |
| Connect now → cancel | none | `skipped` placeholder |
| Connect now → env-precedence conflict | none | `skipped` placeholder with an env-hint remediation string |
| Continue without | none | `skipped` placeholder |
| Snooze | `{ status: "snoozed", snoozeUntil: now + 7d, lastPromptAt: now }` | `skipped` placeholder |
| Never ask | `{ status: "never_ask", lastPromptAt: now }` | `skipped` placeholder |

**Rationale for the pure-function split:** Codex pointed out that the previous design put behavior into SessionCoordinator, which is the wrong layer. By extracting the decision logic into a pure function, the Pi extension wire-up is thin (just event translation + side effects) and the decision table is independently testable without mocking Pi. This is also how the twitter-login tool is structured — logic extracted into `runTwitterLogin`, registration is a thin wrapper.

**Rationale for "continue without" not being sticky:** If the user's "just this once" choice silently becomes a permanent "never ask me again", they'll wonder later why fundamentals stopped appearing in analyses. Snooze and never-ask are the explicit mechanisms for persistent silencing; "continue without" is per-run and explicit.

**Rationale for re-running the tool call on "connect now":** The workflow expected a real result. Returning "user just connected the credential, here's nothing" would leave the LLM improvising. Re-running is clean and the tool itself already uses caching + rate-limiting. The exact re-run mechanism depends on what Pi's `ToolResultEventResult` allows — if Pi does not support "replace this result by re-executing", we fall back to returning a special placeholder that includes the newly-connected key info and rely on the LLM's next turn to retry. See Open Questions.

### Decision 4: Extract `promptUser` from `ask_user.execute` and call it directly from the interception handler

**Choice:** `src/tools/interaction/ask-user.ts` currently embeds all of its UI logic inside the `execute` closure of the registered tool — the `ctx.ui.select`/`ctx.ui.input`/`ctx.ui.confirm` branches, the cancelled-result helper, the no-UI fallback, and the injected `askUserHandler` branch. Extract this into a new exported helper:
```
// src/onboarding/prompt-user.ts
export interface PromptOptions {
  question: string;
  questionType: "select" | "text" | "confirm";
  options?: string[];
  placeholder?: string;
}
export interface PromptResult {
  answer: string | null;
  cancelled: boolean;
}
export async function promptUser(
  ctx: ExtensionContext,
  opts: PromptOptions,
  handler?: AskUserHandler,
): Promise<PromptResult> { ... }
```
`ask_user.execute` becomes a thin 10-line wrapper that packages its params, calls `promptUser`, and formats the tool-result content. The `tool_result` interception handler (Decision 3's prompt-path) calls `promptUser` directly for the four-option prompt.

**Rationale:** Codex noted that Pi has no "execute a tool now" API — there is no way to synthesize an `ask_user` tool call from inside a `tool_result` handler the way the previous design described. The interception handler has a real `ctx` (it's called with `ExtensionContext` per Pi's handler signature), and it can call the same UI primitives that `ask_user` uses. Extracting `promptUser` means:
1. The interception handler can prompt the user without pretending to be a tool call.
2. The headless-harness `askUserHandler` injection point is preserved (the harness already uses it for automated flows — see `src/pi/opencandle-extension.ts` `OpenCandleExtensionOptions.askUserHandler`).
3. `ask_user` continues to work exactly as before, just internally thinner.

**Four-option prompt shape:** The prompt for Alpha Vantage (example) becomes:
```
promptUser(ctx, {
  question: "Connect Alpha Vantage to unlock fundamentals, DCF, and earnings history for this analysis?",
  questionType: "select",
  options: [
    "Connect now (free, ~30 seconds, opens signup in your browser)",
    "Continue with Yahoo snapshot data only for this run",
    "Snooze 7 days",
    "Never ask again",
  ],
})
```
The option strings are derived from descriptor fields by a helper `buildPromptCopy(descriptor)`. The answer is mapped back to the `PromptChoice` enum by prefix match on the first `n` characters of the option string (`"Connect"`, `"Continue"`, `"Snooze"`, `"Never"`) so copy edits don't break the mapping.

**Trade-off:** The interception handler now depends on `promptUser`, creating a cross-layer import (`src/pi/` → `src/onboarding/`). That's acceptable because onboarding is a pure dependency — it imports nothing from `src/pi/` — and the extension was always going to need the registry anyway.

### Decision 5: "First use" is per-session, per-provider, not per-lifetime

**Choice:** The orchestrator tracks an in-memory `Set<ProviderId>` of "providers already prompted this session." On `session_start` this set is empty. The first time a missing-credential envelope for provider X is intercepted in a session, it triggers the prompt; subsequent missing-credential envelopes for X in the same session are silenced (respecting the user's first-choice outcome).

This is combined with the on-disk state:
- Session-level: "prompted already this session" — ephemeral, resets on session start.
- Persistent: `providers[id].status` — lives across sessions.

**Rationale:** Without per-session tracking, a single `analyze NVDA` that touches Alpha Vantage four times (quote → fundamentals → DCF → earnings) would prompt four times. That's obviously bad. The session-scoped Set solves it.

**Rationale for not making "continue without" persistent:** Already covered in Decision 3. The persistent silencing mechanism is snooze/never-ask; "continue without" is a one-run decision. The session Set silences further prompts for the same provider within the same session after any non-connect outcome.

### Decision 6: Gap reporting uses a tagged text block in tool-result `content`, not a JSON envelope in `details`

**Choice:** When the interception handler resolves to `skip`, it replaces the tool result `content` with a tagged human-readable text block:
```
[OPENCANDLE_SKIPPED provider=alpha_vantage reason=credential_not_provided remediation="run /connect company-financials to unlock"]

Alpha Vantage data was not fetched for this request (fundamentals, DCF, earnings history). You can still use the rest of the analysis.
```
The first line is a structured tag the model can recognize. The second line is natural language so the tool result is still readable if the tag-handling instruction is ever missed. The `details` field carries a matching structured object for UI/test assertions but is not the LLM contract.

The system prompt (`src/system-prompt.ts`) gains exactly one instruction:

> Tool results may include a line beginning with `[OPENCANDLE_SKIPPED ...]`. When you see this, it means the named data source was deliberately skipped at the user's request. In your final answer, include a short neutral note at the end (formatted as a single bullet under a `**Data gaps**` heading) describing which data was omitted and quoting the remediation string verbatim. Do NOT treat the skipped line as an error or apologize — the user chose this outcome. If a skipped provider is marked `never_ask` (communicated via the `remediation` string containing `(silenced)`), still describe the omission but OMIT the remediation link — the user asked not to be pestered about it.

**Never-ask remediation suppression:** If the user has picked "never ask again" for a provider, the skipped placeholder's `remediation` string includes a trailing `(silenced)` marker. The system-prompt instruction tells the model to omit the `/connect` link for silenced entries. This avoids the "stop asking me — also here's a /connect suggestion forever" paper cut that Codex flagged.

**Rationale:** Codex verified that Pi provider adapters serialize `content` to the LLM, not `details` (see `@earendil-works/pi-ai/dist/providers/openai-completions.js:551` and siblings). A JSON envelope in `details` is invisible to the model, so the previous design's `{ status: "skipped", ... }` object would have silently failed to drive the gap note. The tagged text block is the correct LLM-facing contract.

**Alternatives considered:**
- *Inject the gap into the system prompt before each turn.* Rejected — requires a turn-boundary hook and couples gap reporting to prompt assembly, which is messier than letting the tool result speak for itself.
- *Return an actual Error-typed result that the model interprets as failure.* Rejected — the model will apologize and recommend retries, which is the opposite of the non-alarming UX we want.
- *Use structured `details` with a separate model-visible summary in `content`.* Adopted — `details` is kept for UI/tests, `content` carries the tagged block.

### Decision 7: `/connect` Pi command is the only user-triggered setup surface in v1 (agent tool deferred)

**Choice:** A single exported function `runProviderConnect(ctx, providerId): Promise<ConnectResult>` lives in `src/onboarding/connect.ts`. It:
1. Looks up the descriptor.
2. Checks the active credential source (env / file / absent) for this provider. If env is active, short-circuits with an advisory message explaining that the environment variable takes precedence and must be unset first (see Decision 12).
3. Opens `descriptor.signupUrl` in the user's browser via `openInBrowser`.
4. Prompts `ctx.ui.input()` with descriptor-specific placeholder copy.
5. Validates the pasted key by calling the provider's cheap-validation endpoint. Distinguishes auth failures (bad key — prompt retry/cancel) from transient network failures (outage — offer "save anyway" or cancel, per Decision 12).
6. On successful validation, saves via `saveFileConfig` to `descriptor.configPath` and refreshes the cached `Config` so subsequent tool calls see the new key immediately.
7. Updates `OnboardingState.providers[id]` to `completed`.
8. Returns `{ status: "connected" | "cancelled" | "blocked_by_env" }`.

This function is called from one entry point in v1: the **`/connect` Pi command** registered via `pi.registerCommand("connect", ...)`. Three invocations are supported:
- `/connect` — opens a picker listing all providers with friendly display labels and current state
- `/connect <alias>` — uses friendly aliases mapped in the registry (e.g., `financials`, `economy`, `news`, `search`) or plain provider ids (`alpha_vantage`, `fred`, `finnhub`, `brave`, `exa`)
- When an alias maps to a category with multiple providers, a sub-picker appears (e.g., `/connect search` shows Exa and Brave)

**Deferred to a future change: `connect_provider` as an agent tool.** The original plan was to register it via `createTool()` from `src/tool-kit.ts`, but:
1. `agentToolToPiTool` at `src/pi/tool-adapter.ts:15` drops the `ctx` argument when bridging add-on tools into Pi, so the tool cannot call `ctx.ui.input`/`ctx.ui.select` or open a browser through Pi's surfaces.
2. The name `connect_provider` (and any reasonable alternative like `connect_to_provider`) fails the snake-case-verb-prefixed allowed-name regex enforced by `createTool()` in `src/tool-kit.ts`.
3. Implementing it correctly requires the raw Pi tool pattern (`pi.registerTool(...)` directly, as in `src/tools/interaction/twitter-login.ts:67`), which is doable but raises a harder question: when should the model proactively offer `connect_provider` versus wait for the orchestrator-driven prompt? The two mechanisms can create duplicate prompts or fight each other if not carefully coordinated.

Since the `tool_result` interception + `/connect` command covers the core UX (contextual just-in-time prompts for hard providers, explicit user-triggered reconfiguration for everyone), the agent tool adds nothing load-bearing in v1. Defer to a follow-up change once we've observed real usage patterns.

**Rationale:** Shipping less is shipping sooner. The interception flow is already the reliable path for non-technical users (deterministic, testable, no model-improvisation risk). Letting the model also offer setup proactively is a nice-to-have that can be added cleanly after v1 lands.

**Alternatives considered:**
- *Register `connect_provider` as a raw Pi tool via `pi.registerTool` in v1.* Rejected for v1 scope reasons above; kept as the path forward for a future change.
- *Drop `/connect` entirely and rely only on the interception flow.* Rejected — users need an explicit way to reconfigure (replace a stale key, add one they snoozed, etc.) without triggering a workflow.

### Decision 8: Pi chrome — minimal scope of white-labeling

**Choice:**
- **OAuth path:** Keep `LoginDialogComponent` as-is. The surrounding setup title and body copy (currently `renderSetupHeader` in `setup.ts`) are replaced with OpenCandle voice. Users who choose Google/OpenAI/Anthropic sign-in will see ~10 seconds of a Pi-looking dialog; this is acceptable.
- **API-key path:** Build a minimal OpenCandle-branded entry flow using `ctx.ui.input` directly (no `LoginDialogComponent`). Single text input, descriptive preamble, masked display if feasible. Lives in `src/pi/setup.ts` or a new `src/onboarding/api-key-entry.ts`.
- **Setup header chrome:** Delete `renderSetupHeader`. The first-run experience becomes: pick sign-in method → do the sign-in → agent posts welcome in chat. No chrome between sign-in and chat.

**Rationale:** OpenClaw didn't restyle Pi either. The winning move is to *move the conversation out of the modal system entirely*, not to make the modal system look different. The modal system still exists (OAuth), but its footprint is minimized to the one thing it does well.

### Decision 9: `OnboardingState` schema uses `Partial<Record>` plus a `welcomeShownAt` flag

**Choice:**
```
interface OnboardingState {
  version: number;                                          // bumped to 2
  welcomeShownAt?: string;                                  // ISO 8601, set when the welcome is first seeded
  providers: Partial<Record<ProviderId, ProviderOnboardingEntry>>;
}

type ProviderOnboardingEntry =
  | { status: "completed"; lastPromptAt: string }
  | { status: "snoozed";   lastPromptAt: string; snoozeUntil: string }
  | { status: "never_ask"; lastPromptAt: string };
```

Missing `providers[id]` (or an absent `providers` map) is the implicit "never prompted" state. The loader accepts absent entries gracefully.

**Migration:** None. `ONBOARDING_VERSION` bumps from 1 to 2. If a user somehow has a v1 file, the loader ignores `financeSetupStatus` entirely and returns a default `{ version: 2, providers: {} }` (without `welcomeShownAt`, so the welcome re-shows exactly once).

**Rationale for `Partial<Record>`:** Codex correctly pointed out that the old shape `Record<ProviderId, ...>` mandates every key be present, which contradicts the spec scenario asserting missing entries are legal. `Partial<Record<...>>` is the right type.

**Rationale for the discriminated union:** The previous `{ status; snoozeUntil? }` was *not* a real discriminated union — TypeScript happily allowed `{ status: "completed", snoozeUntil: "2026-04-20" }` because `snoozeUntil?` is optional on the whole shape. Splitting into a proper union forces `snoozeUntil` to exist iff `status === "snoozed"` and `lastPromptAt` becomes required for all variants (reasonable — we always know when we wrote the entry). This catches invalid combinations at compile time, which matters when we serialize and deserialize.

**Rationale for `welcomeShownAt`:** Codex pointed out that using "empty providers map === first ever" would mean users who never touch provider setup keep seeing the welcome every session. An explicit `welcomeShownAt: string` field is unambiguous and persistent — once set, the welcome never re-seeds.

### Decision 10: Welcome message is seeded via `ctx.sendMessage({ display: true, ... })` with a `welcomeShownAt` gate

**Choice:** Pi's `ExtensionContext.sendMessage` exists and accepts `{ customType, content, display, details }` (confirmed at `@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:749`). The extension seeds the welcome by calling:
```
ctx.sendMessage({
  customType: "opencandle-welcome",
  content: [{ type: "text", text: WELCOME_BODY }],
  display: true,
});
```
Immediately after, the extension writes `welcomeShownAt: new Date().toISOString()` to onboarding state so subsequent sessions skip it.

The welcome body itself is a simple string (not markdown-heavy — this is a terminal):
```
Welcome to OpenCandle. I'm your AI copilot for market analysis.

Try something like:
  • analyze NVDA          — full deep-dive on a ticker
  • quote TSLA            — just the price and daily move
  • how's bitcoin?        — crypto
  • what's r/wallstreetbets saying about META? — social sentiment

You're running with just an LLM right now, which covers most of what
people want. For fundamentals, economic data, or premium news you'll
need a few free API keys — I'll offer to help when they'd actually
make a difference, or run /connect anytime.
```

**Gate:** The extension only seeds the welcome if BOTH:
1. `ctx.hasUI === true` (no welcome in headless harness runs).
2. `onboardingState.welcomeShownAt === undefined`.

**Rationale:** Codex verified that `sendMessage` is the right API and that "empty providers map as first-ever" was the wrong gating heuristic. Using an explicit `welcomeShownAt` flag makes the intent clear and avoids re-seeding for users who never connect providers. The `customType: "opencandle-welcome"` tag gives the UI a hook if we ever want to render the welcome differently from a normal assistant message.

**Alternatives considered:**
- *Use `sendUserMessage` and have the model reply.* Rejected — the welcome is *about* what the user can do; making the user "say" something to trigger it is backwards.
- *Inject the welcome body into the system prompt for the first turn only.* Rejected — this is the fallback if `sendMessage` is not available, but since it *is* available per the Pi types, the direct seed is cleaner.
- *Use `ctx.ui.notify`.* Rejected — that's what the current code does and it produces a transient banner that scrolls away, which is exactly what we're trying to fix.

### Decision 11: Two-tier provider policy — hard providers pause, soft providers silently degrade

**Choice:** Providers are divided into two tiers in the registry via a `tier: "hard" | "soft"` field:

**Hard tier — pause and prompt.** Missing these breaks workflows in ways that don't degrade gracefully.
- `alpha_vantage` — unlocks fundamentals/DCF/earnings. No equivalent free source.
- `fred` — unlocks macro data, rates, inflation. No equivalent free source.

**Soft tier — silent fallback + post-answer gap note.** Missing these is annoying but not broken.
- `finnhub` — news enrichment. `sentiment-summary` already treats this as optional (`src/tools/sentiment/sentiment-summary.ts:40`); other news sources continue to work.
- `brave` — tier-2 web search. Falls back to DDG seamlessly in `web-search.ts`.
- `exa` — tier-1 web search. Falls back to keyless MCP mode in `exa-search.ts:337`, which already works today without a key.

**Behavior difference:**
- **Hard** providers, on missing credential, throw `ProviderCredentialError`. Tools convert to `[OPENCANDLE_CREDENTIAL_REQUIRED ...]` tagged content. The interception handler runs the decision table and may prompt.
- **Soft** providers, on missing credential, log internally and return their fallback data normally. The tool result `content` includes a subtle `[OPENCANDLE_SOFT_DEGRADED provider=brave fallback=ddg remediation="run /connect search to enable Brave"]` tag. The interception handler sees the soft-degraded tag and records it in a per-session accumulator but does NOT prompt. At the end of the workflow (or at the end of each turn), the accumulator contents become a single combined gap note in the final answer.
- **At most one prompt per workflow invocation**, even for hard providers: if both Alpha Vantage and FRED are missing in the same `analyze NVDA` run, only the first hard provider (by registry order) prompts. The second is silently skipped with a gap note so the user isn't double-interrupted.

**Rationale:** Codex's Serious Concern #8 (universal prompt for all five is bad UX) is correct. For providers with usable fallbacks, interrupting the workflow to upsell is worse than the silent fallback the user is already getting today. The hard/soft split is the lowest-friction way to preserve "all providers are reachable and offerable" without nagging. The "one prompt per workflow" cap prevents double-interruption for the rare case where two hard providers are missing at once.

**Trade-off:** The user can go a long time without being prompted for Finnhub/Brave/Exa if they never type `/connect`. That's fine — the gap notes in workflow outputs teach them what's available. And `/connect` is mentioned in the welcome message.

**Alternatives considered:**
- *Universal prompting for all five.* Rejected per Codex — noisy for providers with fallbacks.
- *Only prompt for zero of them, rely entirely on `/connect`.* Rejected — non-technical users wouldn't learn about Alpha Vantage until they wondered why fundamentals were missing. The just-in-time prompt for hard providers is how they discover the full value.
- *Make the tier a runtime decision based on whether the current workflow actually uses the fallback.* Rejected — too clever, too hard to test, and the registry-driven static tier is good enough.

### Decision 12: `runProviderConnect` must handle env-var precedence and distinguish validation failure modes

**Choice:** Before opening the browser, `runProviderConnect` inspects the current credential source for the target provider via a new helper `getCredentialSource(providerId): "env" | "file" | "absent"`. If the source is `env`:
```
ctx.ui.notify(
  `${descriptor.displayName} is currently set via the ${descriptor.envVar} environment variable. ` +
  `To change it from here, unset that variable first and reopen /connect ${descriptor.id}. ` +
  `Otherwise, update ${descriptor.envVar} directly in your shell profile.`,
  "warning",
);
return { status: "blocked_by_env" };
```
No browser opens, no file write, no state mutation.

Validation after paste distinguishes three outcomes:
1. **Success** — key works. Persist, refresh, return `connected`.
2. **Auth failure (HTTP 401/403 or provider-specific auth error)** — bad key. Show a clear message, offer retry (re-paste) or cancel. Do NOT persist.
3. **Transient failure (HTTP 5xx, timeout, network error)** — cannot verify. Show a neutral message explaining the provider may be down, offer "save anyway" / "retry validation" / "cancel". The "save anyway" path persists the key but does not mark state `completed` — instead, it leaves state unchanged so the next workflow run will treat the credential as present (via file config) but the `completed` mark only appears after a successful real workflow call.

**Rationale:** Codex's Serious Concern #7 (env precedence) is a real bug: `src/config.ts:84-93` gives env vars precedence. Writing a new key to file config silently does nothing if `ALPHA_VANTAGE_API_KEY` is set. Detecting this upfront and telling the user plainly is the only honest UX. Codex's smaller point about auth vs network errors is correct — a provider outage should not block setup permanently.

**Trade-off:** "Save anyway" is a minor escape hatch that can mask real problems (the key might actually be bad). We gate it behind a "save anyway" label that implies uncertainty, and don't mark state completed so the user will see the tool's stale-credential behavior on next use if the key was actually bad.

### Decision 13: Auto-select a default model after LLM auth whenever the registry has one

**Choice:** The LLM auth-provider registry (different from the data-provider registry — this lives where OpenCandle interfaces with Pi's `modelRegistry`) gains a `defaultModelId` per provider. After a successful sign-in or API-key entry, `runLlmSetup`:
1. Refreshes `ctx.modelRegistry`.
2. Looks up `ctx.modelRegistry.getAvailable()` filtered to the just-connected provider.
3. If a `defaultModelId` is declared for that provider AND the model is available, calls `api.setModel(model)` directly and returns `"ready"` without showing a picker.
4. If no `defaultModelId` matches (or the registry has none), falls through to the existing `selectModel` picker.

Default mapping (subject to adjustment as models evolve):
- `google-gemini-cli` → `gemini-2.5-pro` (or whichever is listed as the current best default for Gemini CLI auth)
- `openai-codex` → `gpt-5.4` or `gpt-5.3-codex` (whichever is available first)
- `anthropic` → `claude-sonnet-4-6` (or current Sonnet)
- `google`, `openai`, `anthropic` (API key) → same defaults above

**Rationale:** Codex's Serious Concern #5 (startup doesn't actually drop into chat because model selection still happens) is correct — `runLlmSetup` forces a picker at lines 251, 309, 326. For non-technical users, "OAuth sign-in complete → pick a model from a list of 12" is exactly the kind of decision fatigue we're trying to remove. Auto-selecting a sensible default for each provider collapses this to one step for the common path. Users who want a different model can use whatever in-session model-switch mechanism Pi exposes (existing functionality, unchanged).

**Trade-off:** The default mappings are opinionated and will need maintenance as model lineups change. They live in one registry file and are easy to edit. If a user strongly prefers a different model, they still have the picker available via the "Advanced setup" path.

**Alternatives considered:**
- *Ask during startup "pick a default or use our recommendation".* Rejected — still a decision.
- *Let Pi choose whatever model is first in its default order.* Rejected — we don't control that order and it might pick a weaker model.
- *Do nothing, admit in the spec that model selection still happens.* Rejected — this is precisely the friction the whole change is meant to remove.

## Risks / Trade-offs

- **[Risk] The Pi `tool_result` hook may not support modifying the result to re-run the tool with a newly-connected credential.** The hook receives a `ToolResultEvent` and returns a `ToolResultEventResult`, but the exact mutation semantics (can you replace `content`? can you trigger a re-dispatch?) are documented only in the TypeScript types. **Mitigation:** Task 1.1 reads the Pi runner source at `runner.js:427` end-to-end to confirm what the handler can and cannot do. If re-dispatch is not supported, the "connect now" path falls back to: persist the key, emit a placeholder saying "key saved — please re-run", and rely on the user's next turn. Less ideal but functional.
- **[Risk] Tool credential checks before HTTP are duplicated across many tools.** Every tool under `src/tools/` that depends on one of the five providers needs to catch `ProviderCredentialError` at its `execute` boundary. **Mitigation:** Provide a small `withCredentialCheck(providerId, fn)` helper in `src/onboarding/tool-helpers.ts` that wraps a provider call and converts thrown `ProviderCredentialError` into the tagged-content tool result. Tools use it as `return withCredentialCheck("alpha_vantage", async () => { ... })`. The helper is tested once; the tools stay thin.
- **[Risk] The tagged text block convention (`[OPENCANDLE_CREDENTIAL_REQUIRED ...]`) is fragile — future edits to content formatting could break it.** **Mitigation:** (a) Define the tag format in one module (`src/onboarding/tool-tags.ts`) with a builder function and a parser function. Tools use the builder; the interception handler uses the parser. (b) Add a regression test asserting the builder → parser roundtrip. (c) The `details` field carries a parallel structured object as a backup detector; the interception handler checks both `content` tag AND `details.credentialRequired` and uses whichever is present.
- **[Risk] Soft providers' per-workflow gap-note accumulator requires a session-level or turn-level grouping that Pi may not expose cleanly.** **Mitigation:** Tasks 1.1 and 1.2 include confirming where in the Pi event lifecycle we can register "end-of-turn" or "end-of-workflow" hooks. If the only available granularity is per-tool-result, the gap notes get emitted per tool result (less elegant, still correct). If we have `turn_end`, we aggregate.
- **[Risk] Extracting `promptUser` from `ask_user` while preserving the `askUserHandler` injection path is a subtle refactor.** The harness (`tests/harness/manual-run.ts`) relies on the injection. **Mitigation:** Task 4 (types) and Task 7 (interception) include explicit tests that a harness-injected handler is consulted by `promptUser` even when called from the interception handler, not just from `ask_user.execute`.
- **[Risk] Non-technical users may dismiss prompts repeatedly without understanding the implications.** **Mitigation:** Copy lands hard on the value proposition ("unlocks DCF, earnings history, 10-year financials") and explicitly names what they'll lose ("Yahoo snapshot only"). Snooze is a way out that's less final than never-ask. Gap reports in the final output teach them what they missed without nagging.
- **[Risk] Non-technical users may not understand category aliases like `financials`, `economy`, `news`, `search`.** **Mitigation:** The picker shown by bare `/connect` uses human labels ("Alpha Vantage — company financials and valuation", "FRED — economic data and interest rates", etc.). The aliases are only a keyboard-shortcut affordance for users who already know them; the picker is the default.
- **[Trade-off] Pi modal chrome partially persists for OAuth sign-in.** Users who choose Google/OpenAI/Anthropic sign-in will see ~10 seconds of a Pi-looking dialog. **Mitigation:** We accept this. Users rarely sign in twice. The critical first-chat experience is Pi-free because OAuth happens once and lives in memory afterward. For subsequent sessions the user is just dropped into chat.
- **[Trade-off] Registry is a single hardcoded array.** Adding a provider requires a code change, not config. **Mitigation:** This is the right default for in-repo providers; add-on tool packages (see `docs/build-a-tool.md`) can evolve to dynamic registration later if needed. Out of scope for this change.
- **[Risk] Session-scoped "already prompted" set leaks memory if sessions are very long-lived.** **Mitigation:** The set holds at most 5 ProviderId strings. Bounded. Not a real risk.
- **[Risk] "Save anyway" during transient validation failure masks real bad keys.** **Mitigation:** The UX copy for the save-anyway option explicitly says "the key could not be verified — save and try anyway, or cancel". State is not marked `completed` so the next real tool call will surface the error. Acceptable trade-off vs. blocking the user when the provider is down.

## Open Questions

Most of the previous open questions were resolved by the Codex review and a follow-up read of Pi internals during task 1.1. Surviving:

1. **Resolved (task 1.1):** `ToolResultEventResult` (`types.d.ts:648` + `runner.js:427`) supports modifying `content`, `details`, `isError` only. There is no re-dispatch API. **Decision:** the "connect now" success path replaces the tool result's `content` with a `[OPENCANDLE_CONNECTED provider=<id>]` tagged block followed by a natural-language note saying the key was saved and the data will be fetched on the next turn. The system-prompt instruction (added in Task Group 12) tells the model to acknowledge the connection and either use any partial data already returned or explicitly re-invoke the tool on its next turn. A new tag builder `buildConnectedTag` is added to `tool-tags.ts`.
2. **Resolved (task 1.1):** `turn_end` exists at `types.d.ts:717`. Soft-degradation gap-note aggregation hooks onto it: the extension maintains a per-turn accumulator, `tool_result` handlers record soft-degraded providers into it, and the `turn_end` handler emits a single aggregated `[OPENCANDLE_SKIPPED ...]` tagged message via `pi.sendMessage({ customType: "opencandle-turn-gap", ... })` with `display: false` (so the model sees it without cluttering the user transcript) — OR inserts it as a sidecar via `ctx` when that's possible. Implementation task 11 resolves the exact delivery. Per-tool-result emission remains as a fallback if `turn_end` ordering does not play well.
3. **The validation endpoints listed in Decision 7 are educated guesses, not verified.** Task 6.6 confirms each one with a real call against the live API before wiring it in. Specifically: does FRED's `/series/observations?series_id=GNPCA&limit=1&api_key=<key>` work without a series being pre-selected by the user? Does Alpha Vantage's `GLOBAL_QUOTE` return an auth-specific error shape vs. a generic one? Does Exa's minimal call cost anything on paid plans? These are implementation details, not architecture, and can be resolved during task 6.
4. **Alias strings for `/connect` need final user-facing review.** Tentative set: `financials` (Alpha Vantage), `economy` (FRED), `news` (Finnhub), `search` (Exa or Brave → sub-picker). Plus plain provider ids. The picker shown by bare `/connect` is authoritative — aliases are shortcuts. Need to confirm with the product-facing persona that these words resonate; if not, adjust in the registry.
5. **Default-model mappings in Decision 13 need verification against the actual Pi `modelRegistry`.** Which model ids are exposed by `getAvailable()` for each auth provider after a fresh sign-in? The mappings assume names like `claude-sonnet-4-6` and `gpt-5.4` are stable; if Pi exposes them under different ids, the registry entries need to match.

## Migration Plan

None. OpenCandle is pre-launch. The `ONBOARDING_VERSION` bump ensures any test fixtures or dev-machine state files from v1 are treated as empty. No user data migration is needed.

**Rollback:** If the new system has a blocking bug in production (post-launch), rollback is a single-commit revert of this change. State files written in the new v2 format will be ignored by the old v1 loader (it parses `financeSetupStatus` and ignores unknown fields), so reverting does not corrupt existing state — it just loses the per-provider granularity.
