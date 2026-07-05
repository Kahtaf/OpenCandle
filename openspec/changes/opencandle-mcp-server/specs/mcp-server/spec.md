## ADDED Requirements

### Requirement: MCP server serves the enabled tool catalog over stdio

`opencandle mcp` SHALL start an MCP server on stdio (official `@modelcontextprotocol/sdk`) listing every enabled tool from `getAllTools()` (`ask_user` is not in that catalog; it registers separately via the Pi extension), each with its existing name, description, and its Typebox parameters as the MCP `inputSchema`. Tools whose saved defaults carry the `__enabled: false` sentinel SHALL NOT be listed, using the same filter-and-strip handling as `src/pi/tool-adapter.ts` (`__enabled` is stripped before `wrapWithDefaults` and MUST NOT leak into tool args). Startup SHALL load `.env` and file config exactly as the CLI does, SHALL print a single stderr line naming providers with missing credentials, and SHALL write nothing to stdout outside the MCP protocol.

#### Scenario: Tool list mirrors the enabled catalog

- **WHEN** an MCP client sends `tools/list`
- **THEN** the response contains `get_stock_quote` with its Typebox-derived JSON Schema
- **AND** does not contain `ask_user` or any default-disabled tool

### Requirement: Tool calls execute through the shared session-less invoke path

MCP `tools/call` SHALL validate arguments with Typebox (`Value.Check`; on failure return an MCP tool error listing the specific `Value.Errors`, never a thrown protocol error), apply saved tool defaults via `wrapWithDefaults` (with `__enabled` stripped), and execute with a ctx of `{hasUI: false}` and **no** `askUserHandler` — the existing headless contract: `promptUser` returns `{answer: null, cancelled: true}` immediately when `!ctx?.hasUI`, so clarification-dependent tools return their standard non-interactive degraded result (setup-required/skipped messages) without hanging and without behavior changes. An `askUserHandler` MUST NOT be injected (it would flip the sentiment tools' `canAsk` into the interactive path). The invoke module SHALL be shared with (extracted from) the GUI tool-invoke path and MUST NOT import GUI server modules, create Pi sessions, or write transcripts. Results SHALL return the tool's text content plus its `details` as a JSON code block when the serialized details are under 50 KB.

#### Scenario: Valid call returns text and details

- **WHEN** a client calls `get_stock_quote` with `{"symbol": "AAPL"}` (mocked provider fetch in tests)
- **THEN** the result content contains the tool's text output and a JSON block of its details

#### Scenario: Invalid args are a tool error, not a crash

- **WHEN** a client calls `get_stock_quote` with `{"symbol": 42}`
- **THEN** the result is an MCP tool error naming the failing parameter path

#### Scenario: Clarification-dependent call degrades without hanging

- **WHEN** a served tool that would normally ask the user runs over MCP (ctx `hasUI: false`, no handler)
- **THEN** the call returns the tool's standard non-interactive result (setup-required or skipped message) without hanging
- **AND** the sentiment tools take their non-interactive degraded path, not the interactive skip path

### Requirement: Mutating tools carry annotations from an explicit map

The MCP server SHALL hold an explicit annotation map keyed by tool name (MCP annotations are per-tool; OpenCandle's mutating tools multiplex add/update/remove behind an `action` parameter, so hints apply to the whole tool): `manage_watchlist`, `track_portfolio`, `manage_alerts`, `daily_watchlist_report`, and `manage_notifications` carry `readOnlyHint: false`; of those, the four whose action space includes remove/delete (`manage_watchlist`, `track_portfolio`, `manage_alerts`, `manage_notifications`) also carry `destructiveHint: true`; every other served tool carries `readOnlyHint: true`. The map is defined in the MCP server module and MUST NOT be imported from `gui/server/` (its `marketStateToolMapping` is GUI-coupled and omits `manage_notifications`).

#### Scenario: Watchlist management is flagged

- **WHEN** a client lists tools
- **THEN** `manage_watchlist` carries `readOnlyHint: false` and `destructiveHint: true`

#### Scenario: Report tool is mutating but not destructive

- **WHEN** a client lists tools
- **THEN** `daily_watchlist_report` carries `readOnlyHint: false` without `destructiveHint`

### Requirement: MCP client documentation

Public docs SHALL include an MCP page with working registration examples for Claude Code (`claude mcp add opencandle -- opencandle mcp`) and Claude Desktop (config JSON), a note that provider credentials come from the same `.env`/`~/.opencandle` config as the CLI, and the caveat list (keyless tiers, delayed data, external-CLI sentiment setup).

#### Scenario: Docs page exists and is linked

- **WHEN** the docs site builds
- **THEN** the MCP page is present and linked from the docs navigation
