# PR Notes: GUI Session-Scoped Actions

- Legacy `/api/chat/run` route is unavailable with HTTP 410: `tests/unit/gui-server/server-route-guards.test.ts`.
- Browser chat sends require explicit `sessionId` and reuse `actionId` for transport retry: `tests/unit/gui-web/use-chat-run.test.ts`.
- Browser ask-user and tool actions require explicit session identity and mint action IDs at call time: `tests/unit/gui-web/use-gui-connection.test.ts`.
- Server coordinator routes require `sessionId` plus `actionId` before mutation: `tests/unit/gui-server/server-route-guards.test.ts`.
- Ask-user actions do not fall back to the focused/current session: `tests/unit/gui-server/session-actions.test.ts`.
- Tool invocation browser messages use explicit session/action IDs: `tests/unit/gui-server/invoke-tool.test.ts`.
- Different sessions can run concurrently while same-session action exclusion remains: `tests/unit/gui-server/local-session-coordinator.test.ts` and `tests/e2e/gui-browser.test.ts`.
- GUI-created sessions remain TUI-continuable without SQLite schema or Pi session format changes: `tests/unit/gui-server/session-resume.test.ts` and `docs/internal/pr-evidence/feat-gui-session-scoped-actions/tui-resume-transcript.md`.
- Browser runtime evidence for two concurrent sessions with a stop targeting the background session is in `docs/internal/pr-evidence/feat-gui-session-scoped-actions/browser-concurrent-stop-log.json` plus desktop/mobile screenshots.
