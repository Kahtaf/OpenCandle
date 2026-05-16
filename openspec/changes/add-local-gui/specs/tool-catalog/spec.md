# Capability: `tool-catalog`

## Purpose

Make every OpenCandle tool, workflow, and provider visible, configurable, and promotable in the GUI. Replace the implicit "tools are in the agent's context" model with an explicit catalog the user can see and act on. Built entirely from existing metadata (`AgentTool.{name,label,description,parameters}`, `ProviderDescriptor.*`, `src/workflows/*`); no metadata SHALL be duplicated.

## Scope

In scope:
- A full-screen tools overlay with three tabs: Tools, Workflows, Providers.
- Per-tool enable/disable and persistent defaults.
- Direct UI invocation of tools, with results landing in chat history.
- Slash palette in the chat composer covering Pi commands, tools, and workflows.
- Result-attached follow-up chips on typed tool results.
- A `tool_defaults` table in the existing memory SQLite store and a `wrapWithDefaults` execute-time merge.

Not in scope:
- MCP-style installation of third-party tools.
- Workflow customization beyond slot-form inputs (e.g., choosing which analysts run).
- Provider preference ordering UI.
- Cache TTL / rate-limit overrides.

## Requirements

### Catalog rendering

- The Tools tab SHALL iterate `getOpenCandleToolDefinitions()` and render one card per tool.
- Cards SHALL be grouped by domain (`market`, `fundamentals`, `macro`, `options`, `portfolio`, `sentiment`, `technical`, `interaction`) inferred from source path.
- Each card SHALL display: `label`, `description`, required-provider chips with status pills, "last used" timestamp (sourced from session-entry index), and controls described below.
- A card SHALL NOT duplicate metadata; everything visible is read directly from `AgentTool` and `PROVIDERS`.

### Per-tool controls

- Each tool card SHALL provide an enable/disable toggle. Disabled tools SHALL NOT be registered with `pi.registerTool` on the next session boot. When toggling at runtime, the UI SHALL inform the user that the change applies on session restart UNLESS Pi supports hot-swapping the tool registry (verified in tasks §0.3).
- Each tool card SHALL provide a defaults form generated from the tool's Typebox `parameters` schema:
  - `Type.String` → text input
  - `Type.Number` → number input
  - `Type.Boolean` → toggle
  - `Type.Union` of literals → select
  - `Type.Array` of primitives → repeater
  - `Type.Object` → nested fields
  - Field labels SHALL come from the Typebox `description` annotation; absence renders the JSON property name.
- Each tool card SHALL provide a "Run" button (direct UI invocation, see §Direct invocation).
- Each tool card SHALL provide a "Try in chat" button that submits a templated example prompt to the active session.

### Tool defaults — storage

- A new SQLite table `tool_defaults` SHALL be added to the existing `src/memory/` schema with columns `(tool_name TEXT, param_path TEXT, value_json TEXT, set_at TEXT)` and primary key `(tool_name, param_path)`.
- Reads/writes SHALL go through `src/memory/tool-defaults.ts`. The migration is idempotent.
- The reserved key `__enabled` SHALL be used for the enable/disable flag (`value_json: "true"|"false"`).

### Tool defaults — merge semantics

- A wrapper `wrapWithDefaults(tool, defaults)` SHALL deep-merge `defaults` and the call-time `args`, with `args` winning on every conflict.
- The same wrapper SHALL be applied at `pi.registerTool` time AND at UI direct-invocation time. The two paths SHALL NOT diverge in effective arguments.
- The system prompt SHALL include a single line per tool with active defaults, in the form: *"User has set defaults for `<tool_name>` (<param_path>: <value>). You may override when the user's request requires it."*

### Direct UI invocation

- Direct UI invocation SHALL validate args against the tool's Typebox schema BEFORE execution and surface validation errors in the form.
- Direct UI invocation SHALL apply `wrapWithDefaults` and call `tool.execute()`.
- The result SHALL be appended to the active session as a synthetic assistant `toolCall` message plus a `toolResult` message tagged `details.source = "ui"`. Pi currently has no public `appendToolCall()` API, so this is the v1 session-history shape.
- The next LLM turn SHALL receive these entries in context.
- The dashboard projector SHALL handle UI-source and LLM-source tool entries identically.

### Workflows tab

- The Workflows tab SHALL iterate the workflows registered in `src/workflows/`: `comprehensive_analysis`, `portfolio_builder`, `options_screener`, `compare_assets`.
- Each workflow SHALL render a card with: name, description, slot form, "Run" button.
- "Run" SHALL submit the resolved prompt to the active chat session via the LLM-driven path. (No direct invocation for workflows in v1 — they orchestrate multiple LLM turns.)
- Slot-form defaults SHALL read from the existing `storage.getWorkflowPreferences("global")`.

### Providers tab

- The Providers tab SHALL iterate the `PROVIDERS` array and render one card per provider.
- Each card SHALL display: `displayName`, status pill (`Configured` / `Configured (via env)` / `Snoozed until <date>` / `Never-ask` / `Not configured`), `unlocks` as a bullet list, `fallbackDescription` when present, sign-up CTA linked to `signupUrl`, "Test key" button, "Disconnect" button.
- The connect flow SHALL invoke the existing `runProviderConnect(ctx, providerId)` primitive; the UI form replaces terminal prompts but the underlying state machine is unchanged.
- Snooze and never-ask states SHALL be visible AND clearable from the UI.

### Slash palette

- Pressing `/` at column 0 of the chat composer SHALL open a fuzzy palette modal anchored to the composer.
- Palette entries SHALL be the union of: registered Pi commands, workflows, tools.
- Each entry SHALL display: icon (category-derived), name, label, one-line description.
- Selection routes:
  - Pi command → submit as today (`/analyze NVDA` etc.).
  - Tool → open the tool form pre-focused; "Run" applies §Direct invocation.
  - Workflow → open the workflow slot form; "Run" submits the resolved prompt to chat.

### Result-attached follow-up chips

- Typed tool-result renderers SHALL display up to four chips below the result. The chips SHALL NOT mutate session state directly; each chip submits a templated prompt to the chat.
- Initial chip set per result type:
  - **Stock quote**: View options chain · Add to watchlist · See sentiment · Compare.
  - **Option chain**: View greeks · Filter by IV · Compare expiries · Add underlying to watchlist.
  - **Portfolio**: Rebalance · Risk view · Compare to benchmark · Update holdings.
  - **Sentiment summary**: View Reddit · View Twitter · View web hits · Run on related ticker.

## Non-requirements (explicit)

- The catalog SHALL NOT change tool implementations. All adjustments live in `tool-defaults-wrapper.ts` and the registration glue in `tool-adapter.ts`.
- Disabling a tool SHALL NOT delete user-set defaults for it.
- Enabling/disabling a tool SHALL NOT affect provider state; provider availability is managed in the Providers tab.
- The slash palette SHALL NOT bypass the LLM for workflows. Workflows always run through the LLM-driven path so analyst orchestration and slot resolution remain unchanged.

## Acceptance

- Opening the Tools tab renders one card per tool returned by `getOpenCandleToolDefinitions()`. Adding a new tool to `src/tools/` and re-running the GUI surfaces it without UI code changes.
- Setting a default for `get_options_chain.expiry = "next_monthly"` causes both UI direct invocations AND LLM tool-calls to receive that default unless the LLM explicitly overrides.
- Disabling `get_option_chain` filters it from the agent's tool list on next session boot. The system prompt no longer mentions the tool.
- Running `get_stock_quote NVDA` from the slash palette appends two entries to the active session (`tool_call` + `tool_result`, both tagged `source: "ui"`), renders a quote card with a "manual" badge in chat, and updates the Watchlist panel.
- Connecting AlphaVantage from the Providers tab updates every Tools-tab card whose required-provider chip referenced AlphaVantage, flipping the status pill from amber to green.
