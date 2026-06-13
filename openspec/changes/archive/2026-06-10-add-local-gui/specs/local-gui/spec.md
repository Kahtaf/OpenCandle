# Capability: `local-gui`

## Purpose

A browser-served, single-user GUI for OpenCandle that mounts on the existing `createOpenCandleSession()` entry point and runs locally via `npm run gui`. Provides a three-pane shell (sessions sidebar | chat | dashboard) with a full-screen tools overlay and a slash palette.

Implementation note: v1 uses installed Pi APIs and OpenCandle-owned local WebSocket projection, session history, onboarding, dashboard, and finance-specific tool renderers. The current browser app is the React/Tailwind revamp captured in `openspec/changes/archive/2026-06-10-revamp-local-gui/`.

## Scope

In scope:
- Static-served browser bundle and a Node WS/HTTP server in `gui/server/` and `gui/web/`.
- Chat shell built as a native browser custom element around Pi web-ui message and editor components.
- Dashboard projector deriving state from session entries.
- Custom message renderers for `opencandle-*` signals and typed tool results.
- TradingView Lightweight Charts on stock-history detail.
- Empty-state cards and result-attached follow-up chips.
- Local-only binding (`127.0.0.1`).

Not in scope:
- Multi-user or hosted deployment.
- Tunnel exposure (Tailscale, Cloudflare Tunnel) and tunnel auth.
- Agent-emits-HTML.
- Onboarding tour, provider-just-connected toast.
- Indicator-rich charts, Plotly-style dashboards.

## Requirements

### Boot and process model

- The GUI SHALL boot via `npm run gui` and SHALL NOT replace or modify the TUI entry point (`npm start`).
- The GUI server SHALL construct exactly one `createOpenCandleSession()` per active session and SHALL release the session on graceful shutdown.
- The server SHALL bind to `127.0.0.1` only in v1; binding to `0.0.0.0` is rejected by config.
- The server SHALL serve `gui/web/dist/` over HTTP and expose a single WS endpoint at `/ws`.

### Three-pane shell

- The browser shell SHALL render three primary regions: session sidebar, chat, dashboard.
- The shell SHALL provide a top-bar with affordances: open tools overlay, open settings (providers tab of overlay), session controls.
- The chat region SHALL render Pi session entries received from the WS endpoint.
- The dashboard region SHALL subscribe to projector deltas over WS and render the panels defined in §Dashboard panels.

### Sessions sidebar

- The sidebar SHALL list every session in the Pi workspace, sourced from `SessionManager.listSessions(workspaceCwd)`.
- Each row SHALL display: session title (derived from first user message, truncated), last-active timestamp, message count, writer-status icon (📟 TUI, 🌐 GUI, 👻 idle).
- The sidebar SHALL provide a search input that filters by message text via SQLite FTS over the existing session storage.
- The sidebar SHALL support pinning/unpinning sessions; pin metadata persists in `~/.opencandle/pins.json` keyed by session id.
- The sidebar SHALL provide a "new session" button that creates a new Pi session and switches the active writer to the new session.

### Custom message renderers (chat)

- The chat SHALL register a renderer for every `opencandle-*` custom-entry/message type currently emitted by the extension. The set MUST include at minimum:
  - `opencandle-welcome`
  - `opencandle-disclaimer`
  - `opencandle-workflow`
  - `opencandle-router`
  - `opencandle-router-error`
  - `opencandle-router-prefs-dropped`
  - `opencandle-turn-gap`
- Adding a new `opencandle-*` type without a registered renderer SHALL fall back to a generic JSON-debug card and log a warning.
- The chat SHALL register typed tool-result renderers for at minimum: `get_stock_quote`, `get_option_chain`, `get_portfolio`, sentiment-summary.

### Dashboard projector

- The projector SHALL be a pure function from session entries to `DashboardState`. It SHALL NOT introduce any new tools, system-prompt content, or agent-visible state.
- On WS connect, the projector SHALL replay the active session's entries from start, emit one `state.snapshot`, then stream deltas.
- The projector SHALL re-derive on every reconnect; no persistent projector state is stored separately.

### Dashboard panels

The dashboard SHALL include the following panels:

- **Watchlist** — auto-grows from any `tool_result` for `get_stock_quote` (any source). Displays symbol, last quote, % change, sparkline. Each row supports manual pin/unpin and click-to-open chart detail.
- **Active Analyses** — one card per in-flight workflow opened via `opencandle-workflow` and not yet closed. Card displays workflow name, target symbol(s), analyst progress (`done/total`), elapsed time.
- **Recent Research** — chronological list of completed workflow runs. Each entry links to its session and scrolls chat to the synthesis message.
- **Data Quality** — projection of `opencandle-turn-gap` entries and `<credential_required>` skips from the most recent N turns. Each entry links to the corresponding provider tab in the overlay.

### Live quote polling

- A background poller SHALL refresh quotes for visible watchlist symbols every 30 seconds.
- The poller SHALL call `tools.get_stock_quote.execute()` directly and append results to the active session as a synthetic assistant tool call plus a `toolResult` message with `details.source = "background"`.
- The poller SHALL pause when no WS clients are connected and SHALL resume on first connect.
- The poller SHALL respect the existing `cache` and `rateLimiter` infrastructure; it does not bypass either.

### Charts

- Stock-history results SHALL render a TradingView Lightweight Charts candlestick on detail-click, with volume.
- v1 charts MUST NOT include indicator overlays beyond volume.
- The chart library is `lightweight-charts`; not `tradingview-charting-library`.

### Empty-state and promote patterns

- A new session with no messages SHALL display four action cards in the chat region: Analyze, Build Portfolio, Screen Options, Compare. Each card submits a slot form and dispatches the corresponding workflow.
- Typed tool-result renderers SHALL display up to four result-attached follow-up chips per result type (e.g., a quote result offers: View options chain, Add to watchlist, See sentiment, Compare).
- The chat composer SHALL open a slash palette on `/` keystroke at column 0 (see capability `tool-catalog`).

## Non-requirements (explicit)

- The GUI SHALL NOT introduce any new agent-callable tools.
- The GUI SHALL NOT modify the system prompt beyond the one-line tool-defaults notice (see capability `tool-catalog`).
- The GUI SHALL NOT change the rule-mode or LLM-mode router behavior.
- The GUI SHALL NOT modify the analyst orchestrator.
- The GUI SHALL NOT instruct the LLM to emit HTML or any frontend-rendered markup.

## Acceptance

- `npm start` (TUI) is byte-for-byte identical pre- and post-merge.
- `npm run gui` boots the server, opens the browser to the shell, and a fresh session reaches the empty-state cards.
- Sending `/analyze NVDA` streams chat output, opens an Active Analysis card, and on completion adds a Recent Research entry.
- Opening a UI-driven `get_stock_quote` from the slash palette adds a quote card in chat (with a "manual" badge) and updates the Watchlist on the dashboard.
- Opening the same Pi session from a TUI process while the GUI is the writer yields a follower TUI (read-only) with a banner showing the GUI as writer.
