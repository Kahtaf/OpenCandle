## 1. Spec correctness

- [x] 1.1 Verify current Pi package surface and remove unsupported assumptions (`pi-web-ui`, `listSessions`, orphan `appendToolCall`, SQLite `session.db`).
- [x] 1.2 Update proposal/design to use native web shell, `SessionManager.list(cwd)`, synthetic assistant tool calls, and polling/re-read follower fallback.

## 2. Tool defaults

- [x] 2.1 Add `tool_defaults` migration to `src/memory/sqlite.ts`.
- [x] 2.2 Implement `src/memory/tool-defaults.ts` read/write helpers.
- [x] 2.3 Implement `src/runtime/tool-defaults-wrapper.ts` with deep merge and args-wins semantics.
- [x] 2.4 Apply defaults and `__enabled` filtering in `src/pi/tool-adapter.ts`.
- [x] 2.5 Append active defaults to the composed system prompt.
- [x] 2.6 Add unit coverage for storage and wrapper behavior.

## 3. GUI server

- [x] 3.1 Add `npm run gui` and `npm run gui:dev` scripts.
- [x] 3.2 Implement `gui/server/server.ts` with local-only HTTP and `/ws`.
- [x] 3.3 Implement dependency-free WebSocket framing.
- [x] 3.4 Construct `createOpenCandleSession()` on startup and serve `gui/web/dist/`.
- [x] 3.5 Implement dashboard projector and unit tests for quote, workflow, and data-quality rules.
- [x] 3.6 Implement direct UI tool invocation with Typebox validation and `details.source = "ui"`.

## 4. Writer/follower

- [x] 4.1 Implement advisory `writer.lock` helper with pid liveness and stale recovery.
- [x] 4.2 GUI acquires writer role on boot and rejects writer-only operations in follower mode.
- [x] 4.3 Unit-test acquire, follower, release, and stale-lock recovery.

## 5. Browser UI

- [x] 5.1 Implement three-pane shell: sessions, chat, dashboard.
- [x] 5.2 Implement pinned disclaimer footer and empty action cards.
- [x] 5.3 Implement catalog overlay with Tools, Workflows, and Providers tabs.
- [x] 5.4 Implement slash/command palette and top-bar overlay triggers.
- [x] 5.5 Render manual badge for UI-originated tool results and update Watchlist via projector.

## 6. Documentation and verification

- [x] 6.1 Update `AGENTS.md`, add `gui/AGENTS.md`, and add `docs/gui-quickstart.md`.
- [x] 6.2 Add `CHANGELOG.md` entry.
- [x] 6.3 Run `npm test`.
- [x] 6.4 Run `npm run gui` and verify in a browser: empty state, `/analyze NVDA`, Tools overlay direct quote, Providers tab.
