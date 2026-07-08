# Tasks

Follow AGENTS.md (TDD, CHANGELOG, `graphify update .`). Zero tool behavior changes — the server is an adapter. The shared invoke module must be importable from both `gui/server/invoke-tool.ts` and the MCP server without either importing the other.

## 1. Shared invoke module (TDD)

- [ ] 1.1 Failing unit tests for a new `src/runtime/invoke-tool-by-name.ts` (name it exactly): resolves a tool by name from `getAllTools`; Typebox validation failure returns structured errors (paths + messages); defaults applied via `wrapWithDefaults` with the `__enabled` sentinel filtered and stripped (per `src/pi/tool-adapter.ts:36-39` — the GUI path currently leaks it; do not copy that quirk); executes with ctx `{hasUI: false}` and no `askUserHandler` (the 5th ctx arg uses the repo's existing `as unknown as` cast convention); a clarification-dependent tool returns its non-interactive result without hanging.
- [ ] 1.2 Extract the validation/execution core from `gui/server/invoke-tool.ts` into the new module; the GUI path delegates to it (GUI-specific transcript/session/writer-lock behavior stays in `gui/server/`). The GUI shim must reproduce the exact legacy validation-error string (`${path || "/"} ${message}` entries joined by `"; "`) from the structured errors so existing GUI invoke tests pass unmodified.

## 2. MCP server (TDD)

- [ ] 2.1 Add `@modelcontextprotocol/sdk` as a production dependency; verify `package:contents:check` passes with it.
- [ ] 2.2 Failing unit tests (drive the server in-process via the SDK's transports or direct handler calls): `tools/list` mirrors the `getAllTools()` catalog; `__enabled: false` tool excluded; annotation map per spec (including the `daily_watchlist_report` non-destructive case and `manage_notifications`); `tools/call` happy path (mocked `globalThis.fetch` fixture), invalid-args tool error, clarification-dependent tool degrades non-interactively, >50 KB details omitted from the JSON block.
- [ ] 2.3 Implement `src/mcp-server.ts` + `mcp` dispatch in `src/cli-main.ts` beside the `gui`/`monitor` handlers (~lines 180-186), before the TUI default path; startup `loadEnv()`/config load + stderr missing-credentials line; nothing on stdout outside the protocol.

## 3. Docs

- [ ] 3.1 New docs page (registration for Claude Code and Claude Desktop, credentials note, caveats — including that `[OPENCANDLE_CREDENTIAL_REQUIRED]`/`[OPENCANDLE_SOFT_DEGRADED]` tagged content reaches MCP clients raw because Pi's tool_result interception hook doesn't exist over MCP); link from docs navigation; first-mention external links per docs conventions.
- [ ] 3.2 README: one-line mention in the feature list.

## 4. Verification

- [ ] 4.1 `npm test`, `npx tsc --noEmit`, `npx biome ci .` green.
- [ ] 4.2 Live evidence: register the server with Claude Code on this machine, run one real `get_stock_quote` call through it, and paste the client-side result excerpt into the PR. Also verify `opencandle mcp` works from a packed-tarball install (`test:packed-install` covers packaging; do one manual packed run of the command).
- [ ] 4.3 CHANGELOG `[Unreleased]` entry.
- [ ] 4.4 `graphify update .`; `npx openspec validate opencandle-mcp-server --strict`.
