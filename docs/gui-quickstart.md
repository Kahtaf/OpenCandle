---
title: GUI Quickstart
description: Run the local OpenCandle browser workbench and understand writer/follower behavior.
---

# OpenCandle GUI Quickstart

1. Install dependencies from the repo root with `npm install`.
2. Start the local GUI with `npm run gui` from a checkout, or `opencandle gui` from an installed package.
3. Open `http://127.0.0.1:14567`.
4. If the model setup panel appears, connect a model first. Chat cannot run without model access.
5. Start with a keyless market-data prompt such as `What is AAPL trading at?`, then try `/analyze NVDA` or the empty-state action cards.
6. Open the catalog with `⌘K` on macOS, `Ctrl+K` on Windows/Linux, or the top-bar catalog button. Use Tools to run a single tool, Workflows to submit a workflow prompt, and Providers to inspect missing credentials.

The GUI binds to `127.0.0.1:14567` by default. Override with `OPENCANDLE_GUI_HOST` and `OPENCANDLE_GUI_PORT`; set `OPENCANDLE_GUI_HOST=0.0.0.0` only when you intentionally want LAN or Tailscale access.

The GUI shares Pi sessions through a writer/follower lock so only one process mutates a session at a time. Pi is the bundled local agent runtime that owns model setup and saved sessions; the writer/follower lock is the GUI's guard against two browser servers editing the same session at once. The writer can run chat, save provider/model setup, toggle tools, and manage sessions. Followers can serve the browser and read session state, but mutating actions return "Read-only follower mode".

Check the running role with:

```bash
curl http://127.0.0.1:14567/health
```

`{"ok":true,"role":"writer"}` means this process owns the writer lock. `{"ok":true,"role":"follower"}` means the server is healthy but another live process owns the lock.

## Tailscale Access

For remote viewing, keep the local GUI running and expose it with Tailscale Serve from the machine that is running OpenCandle. Use your own Tailscale node address or hostname:

```bash
tailscale serve --bg http://127.0.0.1:14567
```

Depending on your Tailscale setup, the shared URL is shown by `tailscale serve status`.

If the page returns `502`, the tunnel is up but the local GUI is not listening. Restart `npm run gui` or `opencandle gui` and verify `curl http://127.0.0.1:14567/health` returns `{"ok":true,...}`. If it returns `role:"follower"`, stop the existing writer or use the follower for read-only viewing.

## Investigator Workflow

The GUI is a local investigation workbench. It keeps the transcript, tool catalog, provider setup, session history, and financial context close together so the user can see what evidence the agent is using.

- Chat carries the question, tool calls, and synthesis.
- Catalog exposes workflows, individual tools, and provider setup without guessing prompt syntax.
- Session history keeps prior investigations reachable through Pi session state.
- Context and tool result cards make prices, filings, macro data, sentiment, and portfolio facts inspectable.
- Writer/follower locking keeps one local process responsible for mutating a session.

## What You Can Do From The GUI

- Ask a normal finance question, such as `Should I add NVDA if I already own AAPL and TSLA?`
- Launch a workflow from the catalog, such as Comprehensive Analysis, Compare Assets, Portfolio Builder, or Options Screener.
- Run one tool directly when you only need a quote, option chain, filing lookup, or macro series.
- Connect provider keys from the Providers tab instead of editing config files.
- Inspect tool cards and the drawer to see arguments, results, sources, and warnings.
- Reopen previous sessions and continue the investigation.
- Answer focused follow-up questions when OpenCandle needs a ticker, goal, horizon, budget, or risk preference before proceeding.

Workflow catalog entries prefill a structured chat prompt. They do not switch the GUI into a separate mode; the result still appears in the same chat timeline with the same tool cards and session history.

The financial context panel summarizes relevant local context from the current session, such as watchlist entries, holdings, recent symbols, and provider status. Treat it as a navigation aid, not a separate source of truth.

## When To Use The GUI

Use the GUI when you want to inspect tool output visually, browse prior sessions, run an individual tool from the catalog, or see provider setup status without remembering command syntax.

Use the TUI when you want the fastest keyboard loop, slash commands, or a plain terminal transcript. See [TUI](./tui.md).

For GUI internals, see [System Architecture](./system-architecture.md). For GUI validation, see [Testing and Evals](./testing-and-evals.md).
