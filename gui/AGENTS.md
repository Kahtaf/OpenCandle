# OPENCANDLE GUI

Local browser workbench for OpenCandle. `gui/server/` owns the Pi session writer role, serves the built web bundle, and publishes chat/session state over HTTP + WebSocket. `gui/web/` is a read-heavy React client over that state, with a few explicit writer actions.

## COMMANDS
```bash
npm run gui                    # run the GUI server on 127.0.0.1:14567
npm run gui:web:build          # rebuild gui/web/dist after editing gui/web/src
npm run test:gui:browser       # Playwright smoke for the live GUI server
npm run gates                  # full agent handoff proof battery
npx tsx tests/screenshots/capture.ts <phase> [--viewport=...]  # screenshot harness using gui/web/dist
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Static serving, server boot | `gui/server/server.ts` | Server reads from `gui/web/dist`, not `gui/web/src` |
| HTTP endpoints, chat-run API | `gui/server/http-routes.ts` | Session-addressed; all private routes need trusted-session checks |
| WebSocket boot payload, live events | `gui/server/websocket.ts`, `gui/server/ws-hub.ts` | Same trusted-session checks as HTTP |
| Dashboard state is wrong | `gui/server/projector.ts` | Keep pure; add/update `tests/unit/gui-server/projector.test.ts` |
| Chat transcript rendering/state mismatch | `gui/shared/chat-events.ts`, `gui/shared/event-reducer.ts` | Shared contract; fix both server/browser assumptions together |
| Tool button/manual run behavior | `gui/server/invoke-tool.ts`, `gui/server/tool-metadata.ts` | UI tool results must stay distinguishable from model-driven runs |
| Writer/follower mode bugs | `gui/server/writer-lock.ts`, `gui/server/server.ts` | Follower mode must remain read-only |
| Model/API-key onboarding | `gui/server/model-setup.ts`, `gui/web/src/features/onboarding/` | Browser flow depends on server-emitted setup state |
| Chat prompt execution | `gui/server/http-routes.ts` | User chat prompts must use the Pi agent loop; reserve direct tool invocation for explicit GUI actions/background refresh |
| Browser layout/components | `gui/web/src/features/`, `gui/web/src/components/` | Reusable primitives live in `gui/web/src/components/ui/`; preserve existing visual language unless the user asks for redesign |
| GUI browser smoke coverage | `tests/e2e/gui-browser.test.ts` | Uses a live server at `OPENCANDLE_GUI_URL` |
| Screenshot capture flow | `tests/screenshots/capture.ts` | Requires a fresh `gui/web/dist` build |

## CONVENTIONS
- Treat `gui/shared/` as the contract layer. If you change event shape or reducer behavior, update both server producers and browser consumers.
- `gui/server/projector.ts` must stay pure and deterministic. No I/O, no hidden globals, no time-dependent behavior without explicit input.
- Direct UI tool invocation must validate args before `execute()` and must preserve `details.source = "ui"` so renderers can badge manual runs correctly.
- Writer-only actions must fail cleanly in follower mode. Do not add side effects that bypass the writer lock.
- Keep `gui/web/src` focused on presentation/state wiring. Put reusable primitives in `gui/web/src/components/ui/`; do not bury them in feature folders.

## TESTING
- For server or shared-state changes, run `npm test` and ensure the relevant `tests/unit/gui-server/*.test.ts` coverage moves with the change.
- UI changes require visual audits, before/after captures, rebuild first and use `tests/screenshots/capture.ts`. Then verify both for correctness.
- Any UI change requires browser verification with `@browser` or `npx agent-browser` in both desktop and mobile viewports, not just code inspection.
- Any UI change also requires an `impeccable` pass for UX correctness before closing the task — the `impeccable` skill at `.agents/skills/impeccable/` (agents load it via their skills mechanism).
- For React UI changes, run a `vercel-react-best-practices` pass before closing the task.
