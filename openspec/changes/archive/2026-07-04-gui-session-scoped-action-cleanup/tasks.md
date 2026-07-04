## 1. Single Send Path

- [x] Remove or return 410 from the legacy `/api/chat/run` active-session mutation route.
- [x] Update client chat sends so a missing `sessionId` is an error path, not a fallback to the active session.
- [x] Route chat run, stop, retry/regenerate, `ask_user.answer`, `ask_user.cancel`, and `tool.invoke` through explicit `sessionId` plus coordinator `actionId` semantics.
- [x] Ensure transport retry reuses the same `actionId`, while a deliberate repeated user action mints a fresh `actionId`.
- [x] Add grep-level proof or a route-table snapshot test that no GUI mutation route or client call site resolves the active session implicitly.

## 2. Cross-Session Concurrency

- [x] Preserve one active run per session while allowing runs in multiple different sessions at the same time.
- [x] Add GUI-server unit tests for stop/retry/ask_user actions targeting a non-focused session.
- [x] Add GUI-server unit tests proving stop/cancel affects only the owning session.
- [x] Add GUI-server unit tests proving `ask_user` answers route to the owning session while the browser focus is elsewhere.
- [x] Extend `tests/e2e/gui-browser.test.ts` with one browser test that drives two sessions concurrently.

## 3. TUI Parity Confirmation

- [x] Add a scripted check showing a GUI-created session appears in the TUI/Pi session list or recent-session continuation flow and can be continued from there.
- [x] Record the discovered behavior in the implementation PR evidence without proposing a new resume mechanism.
- [x] Confirm no SQLite schema migration is required.
- [x] Confirm no Pi session format change is required.

## 4. Validation

- [x] Run focused GUI server and browser tests for the scoped action cleanup.
- [x] Run `openspec validate gui-session-scoped-action-cleanup --strict` before archival in the implementation PR.
- [x] Run `npm test`.
- [x] Run `npx tsc --noEmit`.
- [x] Run `npx biome ci .`.
