## 1. Coordinator Ownership and Recovery

- [x] 1.1 Add tests for per-session coordinator metadata parsing, heartbeat freshness, endpoint discovery, protocol version, process identity, and startup fallback scope.
- [x] 1.2 Extend the existing writer lock metadata to include canonical session id or fallback scope, owner pid, owner process identity discriminator, heartbeat timestamp, endpoint, and protocol version.
- [ ] 1.3 Replace the current process-wide GUI writer/follower role with per-session coordinator state in server controllers and browser boot/session-switch state.
- [x] 1.4 Change stale recovery so a late heartbeat from a still-live matching owner process does not permit lock stealing.
- [x] 1.5 Add recovery tests proving a live delayed owner is not stolen, a dead owner can be recovered, and an ambiguous/reused PID is not auto-stolen.
- [ ] 1.6 Add a neutral manual recovery path for ambiguous or corrupted ownership metadata that does not expose writer/follower/takeover terminology.
- [ ] 1.7 Add heartbeat refresh and release behavior for active coordinators, including long-running streams, tool calls, and synthesis.
- [ ] 1.8 Add verification that a long stream outlives the stale grace window without another process recovering the session.
- [x] 1.9 Serialize startup fallback scope to canonical session identity migration so two keys cannot produce two owners for one session.

## 2. Authenticated Local Proxy

- [x] 2.1 Choose and document the coordinator transport before implementation: authenticated loopback HTTP, Unix socket, or Pi-native IPC.
- [ ] 2.2 Add tests proving arbitrary browser pages cannot submit prompts, tool invocations, run controls, or transcript writes to the coordinator.
- [x] 2.3 Implement coordinator capability/token generation and validation tied to local coordinator metadata, within the local single-user threat model.
- [x] 2.4 Preserve existing trusted browser-session checks before GUI browser actions are forwarded to the coordinator.
- [ ] 2.5 Add tests for forwarding a non-owner GUI prompt to a live local coordinator without exposing writer/follower language.
- [ ] 2.6 Ensure proxy requests received by non-owner processes fail without forwarding loops and are evaluated per target session.

## 3. Session-Scoped Idempotent Actions

- [x] 3.1 Define a session action envelope with `sessionId`, `actionId`, action type, payload, and source surface.
- [ ] 3.2 Add action-id dedupe tests for session prompts, direct tool invocation, run controls, and `ask_user` answers/cancels.
- [x] 3.3 Implement coordinator-side dedupe for accepted session action IDs with retention at least as long as the retry/recovery horizon selected in implementation.
- [ ] 3.4 Persist action IDs in transcript metadata, a durable per-session action store, or an equivalent tested mechanism before enabling automatic retry across owner recovery.
- [x] 3.5 Update GUI write call sites to reuse action IDs only for retries of the same user action and mint fresh IDs for intentional repeats.
- [ ] 3.6 Update TUI chat write call sites to use the same action envelope after GUI proxying is stable.
- [x] 3.7 Return a neutral busy/retry state for a second prompt submitted while a session run is active, rather than silently queueing or starting a competing run.

## 4. GUI UX Language and State

- [x] 4.1 Replace visible writer/follower/read-only/takeover language in chat, diagnostics, and reconnect banners with neutral syncing/reconnecting/unavailable language.
- [x] 4.2 Keep composer controls available while a supported session action can be proxied; show per-action pending/syncing state during submission.
- [ ] 4.3 Disable write controls only when no coordinator can be reached and recovery is unsafe or fails, with retryable local availability messaging.
- [x] 4.4 Update unit and browser tests that currently assert follower/read-only text or disabled follower controls.
- [x] 4.5 Keep setup mutation controls honestly disabled when global setup coordination is unavailable in this window, using neutral availability language and without introducing setup proxying.
- [x] 4.6 Keep market-state mutation controls honestly disabled when saved-state coordination is unavailable in this window, using neutral availability language and without introducing market-state proxying.
- [ ] 4.7 Update GUI boot/reconnect/session-switch state so browser controls use per-session coordination state rather than a single process-wide role string.

## 5. TUI and Multi-Client Verification

- [ ] 5.1 Add GUI browser regression coverage for two browser tabs submitting through one coordinator without exposing writer/follower wording.
- [ ] 5.2 Add TUI coordinator listener or chosen IPC support so a GUI Browser client can forward supported session actions to a TUI-owned session.
- [ ] 5.3 Add TUI transcript subscription, polling, or tailing so a non-owner TUI can render session updates accepted by a GUI owner.
- [ ] 5.4 Add a scripted TUI plus GUI smoke that opens the same session in TUI and in the GUI Browser, sends a message from each supported topology, and verifies both surfaces converge on the same transcript.
- [ ] 5.5 Add a multi-agent/client smoke where two automated GUI clients submit messages and the coordinator serializes admitted actions into one canonical transcript while returning busy/retry for non-admissible concurrent prompts.
- [ ] 5.6 Add stale-owner recovery verification where one owner process exits, another recovers, and the old dead-owner lock does not block the new surface.
- [ ] 5.7 Add delayed-live-owner verification where one owner stops heartbeating but remains alive, another surface attempts a write, and OpenCandle shows syncing rather than creating a competing writer.
- [ ] 5.8 Add authenticated-proxy verification where unauthorized browser-origin requests are rejected and authorized forwarded GUI/TUI actions succeed.
- [ ] 5.9 Document a manual Browser/TUI checklist fallback if any part of the cross-surface smoke cannot be fully automated initially.

## 6. Standard Verification and Rollout

- [ ] 6.1 Run `npm test`.
- [ ] 6.2 Run `npx tsc --noEmit`.
- [ ] 6.3 Run targeted GUI browser tests with the Browser-visible GUI session.
- [ ] 6.4 Run the TUI plus GUI Browser smoke from task 5.4 before marking implementation complete.
- [ ] 6.5 Update `CHANGELOG.md` under `[Unreleased]`.
- [ ] 6.6 Run `graphify update .` after implementation changes.
