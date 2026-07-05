# `opencandle mcp` — Serve the Tool Layer over MCP

## Why

The MCP finance ecosystem is fragmented single-provider wrappers (the best-known server wraps one commercial API; keyless Yahoo/SEC wrappers sit in the low hundreds of stars each). No one offers a curated, cached, rate-limited, multi-provider-with-fallback finance toolset over MCP. OpenCandle already *is* that toolset — ~30 typed tools over `src/infra/` cache/rate-limit/fallback — and the repo already has a proven session-less execute-by-name path (`invokeToolFromUi` in `gui/server/invoke-tool.ts`: Typebox `Value.Check` validation → `wrapWithDefaults` → `execute` with `hasUI: false`). Serving this over MCP makes OpenCandle the finance data plane for Claude Code, Claude Desktop, Codex, and every other MCP client — distribution at near-zero product cost, with every MCP user a candidate for the full agent.

## What Changes

- New CLI command `opencandle mcp`: an MCP server over **stdio** using the official `@modelcontextprotocol/sdk` (new production dependency).
- Serves every enabled OpenCandle tool except the interactive `ask_user` tool: name and description as-is (snake_case tool names are MCP-legal), `inputSchema` taken directly from the tool's Typebox parameters (Typebox emits standard JSON Schema).
- Execution path: shared module extracted from the GUI invoke path — validate args with `Value.Check`/`Value.Errors`, apply saved tool defaults (`wrapWithDefaults`, filtering and stripping the `__enabled` sentinel the way `src/pi/tool-adapter.ts` does), execute with `hasUI: false` and **no** `askUserHandler`. That is the existing headless contract: `promptUser` returns `{answer: null, cancelled: true}` immediately when `!ctx?.hasUI`, so clarification-dependent tools take their standard non-interactive degraded path (setup-required / skipped messages) without hanging, with zero tool behavior changes. (Injecting a handler is wrong: it flips `canAsk` true in the sentiment tools and routes them into the interactive skip path.)
- Results: the tool's text content, plus its `details` serialized as a JSON code block when under 50 KB.
- Mutating market-state tools are served — this is a local, same-user surface — with MCP tool annotations from an **explicit map in the MCP server keyed by tool name** (MCP annotations are per-tool; OpenCandle's mutating tools multiplex add/update/remove behind one `action` param, so no per-action hint is possible): `manage_watchlist`, `track_portfolio`, `manage_alerts`, `daily_watchlist_report`, `manage_notifications` → `readOnlyHint: false`; `destructiveHint: true` for the four whose action space includes remove/delete (`manage_watchlist`, `track_portfolio`, `manage_alerts`, `manage_notifications`); every other served tool `readOnlyHint: true`.
- Startup: `loadEnv()` + config load exactly like the CLI; a one-time stderr line lists providers with missing credentials (doctor-style), so degraded tools are no surprise.
- Docs: a "Use OpenCandle from any MCP client" page with `claude mcp add opencandle -- opencandle mcp` and Claude Desktop config JSON.

## Non-Goals

- No HTTP/SSE transport, no network listener, no auth layer — stdio, local, same user only (v1).
- No `/analyze`-as-a-tool: comprehensive analysis needs a model, and the MCP server has none. (Agent-as-tool is a possible follow-up once evaluated.)
- No MCP resources/prompts surfaces in v1 — tools only.
- No changes to any tool's behavior, schema, or output; the server is a pure adapter.
- No Pi session, no transcript writes, no GUI coupling (the shared invoke module must not import `gui/server/`).
- No serving of runtime-registered addon tools (`registerTools` is Pi-session-scoped); the MCP catalog is the built-in `getAllTools()` set.

## Ecosystem caveats to encode

- Third-party text returned by sentiment/web tools already carries the untrusted-content labeling from the tool layer; the MCP server passes it through unchanged (the downstream client owns its own injection hygiene, but our labels survive).
- The external-CLI sentiment tools (`rdt-cli`/`twitter-cli`) degrade over MCP the same way they do in headless TUI runs: their standard setup-required messages are the tool result.
- OpenCandle's credential-interception UX rides Pi's `tool_result` extension hook, which does not exist over MCP: `[OPENCANDLE_CREDENTIAL_REQUIRED ...]` / `[OPENCANDLE_SOFT_DEGRADED ...]` tagged content reaches MCP clients raw. Document this on the MCP docs page as expected behavior.
- Addon tools registered at runtime via `registerTools` are Pi-session-scoped and are **not** served (add to Non-Goals below).

## Implementation facts (verified 2026-07-05; encode, don't rediscover)

- The catalog source is `getAllTools()` (`src/tools/index.ts`, ~30 tools); `ask_user` is not in it (it registers separately via `registerAskUserTool`), so its exclusion is automatic — state the source, don't hunt for an exclusion point.
- The 5th `ctx` argument to `execute(toolCallId, args, signal?, onUpdate?, ctx)` is a repo-wide `as unknown as` cast convention (see `gui/server/invoke-tool.ts:382-393`, `src/pi/tool-adapter.ts:18-27`); `wrapWithDefaults` (`src/runtime/tool-defaults-wrapper.ts`) forwards it. Follow the cast; don't fight the declared 4-param `AgentTool` type.
- `getDefaults` opens/closes the memory SQLite DB per call (`src/memory/tool-defaults.ts`); `tools/list`'s enabled-filter touches it once per tool. This is fine — do not "optimize" it into an import-time singleton (import-time DB opens would break `--version`-style fast paths).
- CLI dispatch: handle `mcp` alongside `gui`/`monitor` in `src/cli-main.ts` (~lines 180-186), before the TUI default path (`initTheme`/session/writer-lock); the parent process must write nothing to stdout (stdio transport purity — `loadEnv` and the cli guards already log to stderr only).
