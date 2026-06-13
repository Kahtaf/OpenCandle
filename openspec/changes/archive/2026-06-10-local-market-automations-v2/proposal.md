## Why

OpenCandle V1 now has durable market state for watchlists, portfolios, alert rules, alert events, daily report templates, and report runs. That gives the product memory, but it does not yet make alerts or reports feel alive: checks still happen when the user explicitly asks.

LangAlpha shows the useful next layer: automations are first-class records with due claiming, execution history, failure handling, manual trigger, and delivery metadata. OpenCandle should borrow that shape while staying a local/user-run application, not a hosted SaaS. The local version should be honest about its runtime guarantees: it can monitor while an OC process is running, and it can integrate with a user-managed OS scheduler later, but it should not imply broker-grade or always-on server monitoring.

## What Changes

- Add a V2 local automation runtime for due alert checks and scheduled daily reports.
- Add persistent automation run/check history so users can see what ran, what triggered, what failed, and what was delivered.
- Add local notification plumbing with in-app notifications as the baseline and optional desktop/webhook/chat adapters as delivery methods.
- Add a single-owner runner model that works with the existing GUI/TUI writer/follower contract and avoids duplicate alert events.
- Add provider capability checks so price, SMA, RSI, volume, and percent-move alerts are only enabled when the configured providers can supply the required quote/history inputs.
- Keep V2 local-first: no hosted multi-user scheduler, no hosted WebSocket fanout, no broker order placement, and no guarantee of monitoring while OpenCandle is closed.

## Capabilities

### New Capabilities

- **`local-market-automations`**: local scheduler/monitoring runtime, run history, notification queue, delivery attempts, and GUI/TUI parity for alert/report automation state.

### Modified Capabilities

- **`market-alerts-and-reports`**: V1 manual alert checks and daily reports gain a V2 runner path, local notification events, and execution history without changing the durable alert/report rule model.
- **`stateful-market-surfaces`**: GUI and TUI expose the same automation controls, notification center, event history, and runner status.

## Impact

- **Storage:** `~/.opencandle/state.db` gains local automation runtime tables or equivalent columns for runner leases, automation runs, alert check runs, notification events, and delivery attempts.
- **Runtime:** The active GUI/TUI writer process may run a heartbeat loop. A future `opencandle monitor` foreground command can use the same service for users who want a terminal-owned local monitor.
- **Tools:** Alert and report tools can list run history, manually trigger checks, pause/resume automations, and explain whether the local runner is active.
- **GUI/TUI:** Portfolio/watchlist/alert/report pages show runner status, recent runs, missed-due status, notification history, and manual check controls with feature parity.
- **Providers:** Alert creation/evaluation validates required provider inputs for each condition type. Unsupported indicator conditions remain disabled or need-review rather than silently pretending to monitor.

## Non-Goals

- No hosted SaaS scheduler or multi-user queue.
- No real-time WebSocket requirement for V2.
- No Slack/Discord workspace orchestration.
- No broker credential storage or executable trading.
- No guarantee that alerts fire while all OpenCandle processes are closed.
- No import adapters; imports remain deferred to the import roadmap.
