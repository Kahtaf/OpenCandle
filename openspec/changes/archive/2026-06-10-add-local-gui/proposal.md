## Why

OpenCandle ships as a TUI today. Every capability — multi-analyst workflows, the tool surface across 7 domains, the structured signals already emitted (`opencandle-workflow`, `opencandle-router`, `opencandle-turn-gap`), the credential/onboarding state in `src/onboarding/providers.ts` — is rendered as terminal text. Three problems compound:

1. **The tool surface is invisible.** Every `AgentTool` already carries `label`, `description`, and a Typebox parameters schema with per-field descriptions. None of that reaches the user. Capabilities exist but are discoverable only by guessing the right prompt or reading source.
2. **Configuration is friction.** `/connect` is a sectioned terminal flow with snoozes, never-ask, env-var blocking, hard/soft tiers, and fallback descriptions. All correct; none of it always-visible.
3. **The session is structured data trapped in a stream.** The extension writes seven distinct `opencandle-*` custom-entry types per turn, plus a stream of typed tool results (`StockQuote`, `OptionChain`, portfolio P&L, sentiment summaries). Terminal flattens them; a GUI can render each as a first-class affordance.

A local single-user GUI on top of the existing `createOpenCandleSession()` entry point unlocks all three without rewriting anything in `src/`.

## What Changes

- **New `gui/server/` package** — a Node process that constructs `createOpenCandleSession()`, exposes a dependency-free WS + HTTP server to the browser, hosts the dashboard projector, and serves the static `gui/web/dist/` bundle. Boot via `npm run gui`. TUI (`npm start`) is unchanged.
- **New `gui/web/` package** — a local browser bundle served by `gui/server`. The original v1 shell has since been replaced by the React/Tailwind revamp in `openspec/changes/archive/2026-06-10-revamp-local-gui/`.
- **TUI ↔ GUI session sharing** via a writer/follower model. At most one writer per session at a time; all other processes are read-only followers that re-read session entries. Sidebar lists sessions via Pi's current `SessionManager.list(cwd)` API.
- **Dashboard projector** — pure read-side derivation of dashboard state from session entries (`tool_result`, `appendEntry`, custom messages). The agent does not know the dashboard exists; no new tools, no new system-prompt content. Panels: Watchlist (auto-grows from quote calls + manual pin), Active Analyses (workflow + analyst progress), Recent Research, Data Quality (`opencandle-turn-gap` projection).
- **Tool catalog** — renders `getOpenCandleToolDefinitions()` and `PROVIDERS` directly. Per-tool: enable/disable toggle, defaults form built from the Typebox schema, "Run" (direct invocation), "Try in chat" (auto-prompt). Per-provider: status, unlocks list, sign-up CTA, test/disconnect.
- **Direct tool invocation from the UI lands in chat history.** Pi does not expose a public `appendToolCall()` method. A UI-driven tool call therefore appends a synthetic assistant message containing a `toolCall`, followed by a `toolResult` message tagged `details.source: "ui"`. The dashboard projector picks it up identically to LLM-driven calls. The next LLM turn sees it in context.
- **Tool defaults** persist in a new `tool_defaults` table in the existing `src/memory/` SQLite store. A thin wrapper merges `userDefaults ⊕ args` at execute time so UI form and LLM tool-call agree on the same effective arguments. System prompt gets a one-line mention that defaults exist.
- **Slash palette** in the composer — typing `/` opens a fuzzy palette over tools + workflows (extending today's `/analyze`, `/connect`, `/setup` set).
- **Custom renderers** for the seven `opencandle-*` custom-entry/message types and for typed tool results (quote, options chain, portfolio, sentiment summary). Stock-history results render a TradingView Lightweight Charts candlestick on detail-click.
- **Promote patterns**: empty-state action cards (Analyze · Build Portfolio · Screen Options · Compare), result-attached follow-up chips (Compare to X · Options chain · Sentiment · Add to watchlist).
- **No agent-emits-HTML**. The system prompt is unchanged; the agent does not author UI. Rationale in `design.md`.

## Capabilities

### New Capabilities
- **`local-gui`**: a browser-served single-user GUI mounting on `createOpenCandleSession()`. Three-pane shell with a tools overlay, custom renderers for OpenCandle's structured signals, a dashboard projector, and a slash palette. TUI binary is unchanged.
- **`tool-catalog`**: a user-facing catalog of every `AgentTool` and `ProviderDescriptor` derived from existing metadata, with per-tool enable/disable, per-tool persistent defaults (`tool_defaults` SQLite table), direct UI invocation that lands in chat history with a `source: "ui"` marker, and a slash palette in the chat composer.
- **`session-multi-process`**: a writer/follower contract for sharing one Pi session across TUI and GUI processes. At any moment one process holds the writer role and runs the agent loop; others tail session entries read-only via Pi's session-event stream. Switching the writer is explicit (a process voluntarily releases or the user chooses in the UI).

### Modified Capabilities
- None in v1. `intent-routing`, `conversational-provider-setup`, `provider-registry`, and `analyst-stance` are consumed read-only; the dashboard projector and tool catalog are pure read-sides over their existing emissions.

## Impact

- **Code (new):**
  - `gui/server/{server.ts, projector.ts, quote-poller.ts, tunnel.ts, package.json}`
  - `gui/web/{shell.ts, chat/, dashboard/, tools-overlay/, package.json}`
  - `src/memory/tool-defaults.ts` — schema + read/write for the new SQLite table
  - `src/runtime/tool-defaults-wrapper.ts` — `wrapWithDefaults(tool, defaults)` used by both LLM and UI invocation paths
- **Code (touched):**
  - `src/pi/tool-adapter.ts` — apply the defaults wrapper at registration time
  - `src/memory/sqlite.ts` — migration adding `tool_defaults`
  - `src/system-prompt.ts` — one-paragraph addition describing that user-set defaults exist
  - `package.json` — new `gui` + `gui:dev` scripts
- **Tests (new):**
  - `tests/unit/runtime/tool-defaults-wrapper.test.ts`
  - `tests/unit/gui-server/projector.test.ts` — replay session entries, assert dashboard state shape
  - `tests/e2e/gui/` — Playwright over `npm run gui`, smoke tests for shell, slash palette, direct invocation
- **Tests (modified):**
  - `tests/harness/manual-run.ts` — verify a UI-invoked tool call appends `source: "ui"` orphan entries (gated behind a harness mode flag)
- **Dependencies (new, GUI-only):**
  - browser bundler (Vite)
  - browser test runner support through `playwright-core`
- **Dependencies (unchanged):** core agent runtime, providers, tools — no version bumps required.
- **Flags:** none. GUI is opt-in by running `npm run gui`. TUI behavior is invariant.
- **Migrations:** `tool_defaults` table added to the existing memory SQLite via a migration step at startup. Backward-compatible (absence == no defaults).

## Open follow-ups (deferred from v1)

- Onboarding tour and provider-just-connected toast notifications.
- Saved/exportable analyses (PDF/Markdown export, shareable permalinks).
- Workflow customization UI (which analysts run for `/analyze`).
- Provider preference ordering UI (currently determined by `withFallback`).
- Indicator-rich TradingView charts (Lightweight Charts → full Charting Library).
- Hosted/multi-user mode and tunnel auth (Cloudflare Access / Tailscale ACL).
- MCP-style third-party tool installation surfaced in the catalog.
- Agent-emits-HTML if a future use case justifies the cost (see `design.md §3`).
