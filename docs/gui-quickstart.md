# OpenCandle GUI Quickstart

1. Install dependencies from the repo root with `npm install`.
2. Start the local GUI with `npm run gui`.
3. Open `http://127.0.0.1:14567`.
4. Start with `/analyze NVDA` or use the empty-state action cards.
5. Open the catalog with `⌘K` or the top-bar catalog button. Use Tools to run a single tool, Workflows to submit a workflow prompt, and Providers to inspect missing credentials.

The GUI is local-only in v1 and binds to `127.0.0.1`. It shares Pi sessions through a writer/follower lock so only one process mutates a session at a time.

## Tailscale Access

For remote viewing, keep the local GUI running and expose it with Tailscale Serve from the machine that is running OpenCandle. Use your own Tailscale node address or hostname:

```bash
tailscale serve --bg http://127.0.0.1:14567
```

Depending on your Tailscale setup, the shared URL is shown by `tailscale serve status`.

If the page returns `502`, the tunnel is up but the local GUI is not listening. Restart `npm run gui` and verify `curl http://127.0.0.1:14567/health` returns `{"ok":true,"role":"writer"}`.

## UI Structure

The revamped GUI follows llmchat's package shape where it helps OpenCandle: small UI primitives, composable chat pieces, and thin feature modules.

- `gui/web/tailwind.config.cjs` and `gui/web/postcss.config.cjs` enable the Tailwind pipeline.
- `gui/web/src/components/ui/` owns reusable primitives such as buttons, badges, inputs, cards, textareas, keyboard hints, and checkboxes.
- `gui/web/src/components/chat/` owns reusable chat pieces such as the composer, empty prompt suggestions, transcript message rows, and history rows.
- `gui/web/src/features/` owns product behavior and wires those components to Pi session state.

- `chat/` owns the transcript, composer, stream controls, and empty states.
- `sessions/` owns desktop and mobile chat history.
- `context-panel/` owns the financial context projection.
- `catalog/` owns tools, workflows, and providers.
- `renderers/` owns first-class financial tool cards plus raw inspection.

The visual/primitives reference is llmchat's UI package:
`https://github.com/trendy-design/llmchat/tree/main/packages/ui`

That package is inspiration only. OpenCandle does not depend on llmchat and does not copy its persistence/runtime model.

## Verification

Before calling the GUI ready, run:

```bash
npm test
npm --workspace @opencandle/gui-web run build
```

Then test the app in a browser at desktop and mobile widths. At minimum, send prompts that exercise stock quotes, quote comparison, options chain, SEC filings, macro/FRED data, and news/search so the corresponding tool cards and the financial context panel render from saved session state.

With `npm run gui` already running, the repeatable browser smoke is:

```bash
npm run test:gui:browser
```

Set `OPENCANDLE_GUI_URL` to target a non-default local URL.
