## Why

OpenCandle currently exposes the internal writer/follower lock model directly in the GUI, leaving users with read-only banners and disabled controls in a local single-user app. The lock still protects Pi session integrity, but the product should feel like every local GUI tab, GUI process, and TUI can participate normally while OpenCandle silently coordinates the authoritative session writer behind the scenes.

## What Changes

- Replace user-visible writer/follower/read-only/takeover language with plain connection states such as syncing, reconnecting, unavailable, or retrying.
- Preserve the single-writer safety invariant with per-session coordinator ownership, owner liveness checks, heartbeat refresh, and conservative stale-owner recovery.
- Add an authenticated local coordinator endpoint for forwarding session write intents from non-owner local GUI/TUI surfaces to the live owner.
- Treat chat prompts, direct tool invocations, run controls, and `ask_user` answers as idempotent session-scoped actions.
- Keep browser tabs and GUI surfaces interactive while the coordinator serializes writes and broadcasts updates; show per-action pending state during submission and disable only when no coordinator can be reached or safely recovered.
- Verify the behavior by running GUI and TUI surfaces together, including in the in-app Browser, and by using multiple agent/browser clients to send messages that stay synchronized.

## Capabilities

### New Capabilities

- `local-session-coordination`: Defines transparent local coordination, authenticated owner discovery, write proxying, conservative stale-owner recovery, session-scoped idempotent actions, and user-facing connection language.

### Modified Capabilities

- `pi-synced-gui`: Replace visible writer/follower requirements with transparent local coordination while preserving Pi session safety and TUI/GUI parity.

## Impact

- **GUI server:** Adds local owner discovery/proxying or equivalent coordinator APIs around existing writer lock handling.
- **GUI web app:** Removes writer/follower wording from visible UI and keeps controls interactive while session actions are routed, retried, or explicitly syncing.
- **TUI/Pi integration:** Participates in the same coordinator contract for session chat actions so TUI and GUI do not compete for direct session ownership.
- **Session safety:** Keeps one authoritative writer per session using owner liveness, heartbeat, authenticated forwarding, and action IDs.
- **Deferred follow-ups:** Global model/provider setup coordination and market-state mutation coordination are intentionally deferred because they require separate global-config and SQLite/transcript designs.
- **No hosted scope:** This remains local single-user coordination, not cloud sync, same-user malware defense, or multi-user collaboration.
