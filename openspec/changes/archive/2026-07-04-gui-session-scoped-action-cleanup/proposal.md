# Change: GUI Session-Scoped Action Cleanup

## Why

The archived `gui-concurrent-session-runtime` change proved the GUI can load and run route-addressed sessions, but the shipped code still keeps a legacy active-session mutation path. The next implementation slice should remove that ambiguity and align every GUI mutation with the transparent local session coordinator's session-scoped `actionId` envelope.

## What Changes

- Remove the legacy active-session mutation path from GUI server routes and client calls.
- Require chat run, stop, retry/regenerate, `ask_user` answer/cancel, and direct `tool.invoke` mutations to target an explicit `sessionId`.
- Require supported mutations to flow through the coordinator `actionId` envelope defined by `local-session-coordination`.
- Prove cross-session concurrency: one active run per session, many sessions active concurrently, and stop/cancel/ask-user actions scoped to their owning session.
- Add a scripted parity confirmation that GUI-created sessions remain continuable from the TUI session list/recent-session flow using shared Pi session storage.
- Confirm no SQLite schema migration or Pi session format change is needed.

## Non-Goals

- No queued same-session prompts.
- No follower/takeover UX or user-facing ownership language changes; the `local-session-coordination` spec owns coordinator presentation language.
- No lock-format, coordinator metadata, or action-envelope format changes; `local-session-coordination` is the authority for envelopes, locks, recovery, and dedupe semantics.
- No new TUI resume mechanism beyond the behavior supported by the current Pi/OpenCandle session layer.

## Discovery Notes

- Current OpenCandle code uses `SessionManager.continueRecent(cwd, sessionDir)` for the TUI continuation path in `src/pi/session-storage.ts`.
- Existing GUI/TUI resume tests prove GUI-created sessions are visible through shared Pi session storage and continuable by `SessionManager.continueRecent`.
- Pi's public session docs also document `pi -c`, `/resume`/`pi -r`, and `pi --session <path|id>`; this change specs only the shared-list/recent continuation behavior already demonstrated in this repo.
