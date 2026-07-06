---
title: GUI Quickstart
description: Run the local OpenCandle browser workbench and understand local session coordination.
---

# OpenCandle GUI Quickstart

![The OpenCandle GUI workbench with a chat thread, tool calls, and market context](./images/gui-workbench.png)

1. Start the local GUI with `opencandle gui` from an installed package, or `npm install` followed by `npm run gui` from a source checkout.
3. Open `http://127.0.0.1:14567`.
4. If the model setup panel appears, connect a model API key first. Chat cannot run without model access. If you want Pi sign-in instead of an API key, complete terminal `/setup` first and then refresh the GUI.
5. Start with a keyless market-data prompt such as `What is AAPL trading at?` or the empty-state action cards. When you want deep research, run `/analyze NVDA` — the multi-analyst debate takes a few minutes.
6. Open the catalog with `⌘K` on macOS, `Ctrl+K` on Windows/Linux, or the top-bar catalog button. Use Tools to run a single tool, Workflows to submit a workflow prompt, and Providers to inspect missing credentials.
7. Use the composer plus button to attach images or saved context such as your portfolio, watchlist, or latest report before sending a prompt.

The GUI binds to `127.0.0.1:14567` by default. Override with `OPENCANDLE_GUI_HOST` and `OPENCANDLE_GUI_PORT`; set `OPENCANDLE_GUI_HOST=0.0.0.0` only when you intentionally want LAN or [Tailscale](https://tailscale.com) access.

The GUI shares Pi sessions with the terminal UI and other local browser windows. OpenCandle coordinates those local surfaces behind the scenes so prompts, follow-up answers, and supported tool actions are forwarded to the active session owner when needed. During startup, session switches, or owner recovery, the UI may briefly report that OpenCandle is reconnecting or syncing the session; retry once the current run settles.

Check the running role with:

```bash
curl http://127.0.0.1:14567/health
```

`{"ok":true,...}` means the HTTP server is alive. The `role` field is diagnostic metadata for support logs; normal GUI use should not require choosing between process roles.

Other useful local endpoints:

- `GET /api/bootstrap` returns the initial catalog, setup state, sessions, prompts, and current snapshot.
- `GET /api/sessions` lists saved sessions.
- `GET /api/session/events` returns the current projected chat events.
- `POST /api/chat/run` streams one chat run.
- `GET /ws` provides live updates for setup, catalog, session, and ask-user events.

## Tailscale Access

For remote viewing, keep the local GUI running and expose it with Tailscale Serve from the machine that is running OpenCandle. Use your own Tailscale node address or hostname:

```bash
tailscale serve --bg http://127.0.0.1:14567
```

Depending on your Tailscale setup, the shared URL is shown by `tailscale serve status`.

If the page returns `502`, the tunnel is up but the local GUI is not listening. Restart `npm run gui` or `opencandle gui` and verify `curl http://127.0.0.1:14567/health` returns `{"ok":true,...}`.

## Investigator Workflow

The GUI is a local investigation workbench. It keeps the transcript, tool catalog, provider setup, session history, and financial context close together so the user can see what evidence the agent is using.

- Chat carries the question, tool calls, and synthesis.
- Catalog exposes workflows, individual tools, and provider setup without guessing prompt syntax.
- Session history keeps prior investigations reachable through Pi session state.
- Context and tool result cards make prices, filings, macro data, sentiment, and portfolio facts inspectable.
- Local session coordination keeps terminal and browser views in sync while one surface applies each action.

## What You Can Do From The GUI

- Ask a normal finance question, such as `Should I add NVDA if I already own AAPL and TSLA?`
- Launch a workflow from the catalog, such as Comprehensive Analysis, Compare Assets, Portfolio Builder, or Options Screener.
- Run one tool directly when you only need a quote, option chain, filing lookup, or macro series.
- Connect provider keys from the Providers tab instead of editing config files.
- Inspect tool cards and the drawer to see arguments, results, sources, and warnings.
- Reopen previous sessions and continue the investigation.
- Answer focused follow-up questions when OpenCandle needs a ticker, goal, horizon, budget, or risk preference before proceeding.

Workflow catalog entries prefill a structured chat prompt. They do not switch the GUI into a separate mode; the result still appears in the same chat timeline with the same tool cards and session history.

The "What the agent sees" drawer summarizes the latest routed turn before the saved-state shortcuts and session context: route/workflow, resolved symbols, slot provenance, prior-turn count, saved-state injection, attachment count, validation receipts, active analyst progress, recent quotes, research, and provider data gaps. Treat it as a transparency panel for the current session, not a separate source of truth.

## When To Use The GUI

Use the GUI when you want to inspect tool output visually, browse prior sessions, run an individual tool from the catalog, or see provider setup status without remembering command syntax.

Use the TUI when you want the fastest keyboard loop, slash commands, or a plain terminal transcript. See [TUI](./tui.md).

For GUI internals, see [System Architecture](./system-architecture.md). For GUI validation, see [Testing and Evals](./testing-and-evals.md).
