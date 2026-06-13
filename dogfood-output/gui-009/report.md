# Dogfood Report: OpenCandle GUI Plan 009

| Field | Value |
|-------|-------|
| **Date** | 2026-06-13 |
| **App URL** | http://127.0.0.1:14569 |
| **Session** | opencandle-gui-009 |
| **Scope** | Targeted regression pass for Plan 009 GUI server service extraction |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| **Total** | **0** |

## Paths Exercised

- WebSocket boot/bootstrap loaded in writer mode from an isolated cwd.
- Model selection changed from setup state to `gpt-5-mini`.
- Chat prompt submission created a user turn and surfaced an OpenAI organization-verification model error in the transcript.
- Watchlist route loaded through the GUI.
- `tool.invoke` over the GUI WebSocket added MSFT to the watchlist and returned `ok: true`.
- Reloaded watchlist rendered MSFT with the saved thesis.
- Background quote polling updated MSFT from awaiting quote to `$390.74`.
- Session rename updated the sidebar title to `Dogfood GUI 009`.
- New-session action returned to the home composer.
- Session delete over the GUI WebSocket removed the dogfood session and broadcast an empty sessions list.
- Single Ctrl+C stopped the isolated GUI server cleanly.

## TUI Harness Prompts

1. `Add MSFT to my watchlist with thesis 'dogfood tui harness' and then tell me what changed.`
   - Result: completed in 3 turns.
   - Tool sequence: `manage_watchlist`, `manage_watchlist`.
   - Final answer confirmed MSFT was added and checked at `$390.74`.

2. `What is on my current watchlist, and what thesis did I save for MSFT?`
   - Result: completed in 2 turns.
   - Tool sequence: `manage_watchlist`.
   - Final answer correctly retrieved thesis: `"dogfood tui harness"`.

## Observations

- No confirmed app regressions were found in the targeted Plan 009 paths.
- The `agent-browser` CLI became unresponsive after clicking the Delete chat menu item and again on `agent-browser close`. Direct WebSocket verification showed the server-side delete path worked. This was not recorded as an app issue because it was not reproduced outside the automation client.
