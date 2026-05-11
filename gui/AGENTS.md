# OPENCANDLE GUI

Local browser workbench for OpenCandle. The server owns the Pi session writer role and the browser is a read-side UI over session entries.

## COMMANDS
```bash
npm run gui       # starts gui/server/server.ts on 127.0.0.1:14567
```

## STRUCTURE
```
gui/server/
├── server.ts       # HTTP, WebSocket, Pi session bootstrap
├── projector.ts    # pure session entries -> DashboardState projection
├── invoke-tool.ts  # direct UI tool invocation, persisted to session history
├── writer-lock.ts  # single-writer advisory lock
└── websocket.ts    # minimal dependency-free WS framing

gui/web/
├── src/components/ui/    # llmchat-inspired reusable primitives
├── src/components/chat/  # composer, messages, prompts, history rows
├── src/features/         # chat, sessions, catalog, onboarding, renderers
├── tailwind.config.cjs   # GUI Tailwind theme and plugin config
└── vite.config.js        # browser bundle build
```

## CONVENTIONS
- Keep `src/` free of imports from `gui/`.
- Keep feature modules thin; put reusable controls in `gui/web/src/components/ui/` or `gui/web/src/components/chat/`.
- Projector logic must stay pure and deterministic; add unit cases per new projection rule.
- Direct tool invocation must validate Typebox args before `execute()`.
- Tool results from UI must carry `details.source = "ui"` so renderers can show the manual badge.
- Writer-only operations must reject when the process is in follower mode.
- Do not commit `gui/web/dist/` or `gui/web/node_modules/`; rebuild with `npm run gui:web:build`.
