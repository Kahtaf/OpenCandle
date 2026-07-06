## Why

Router prior-turn context, structured memory, saved market-state prompt context, and Pi compaction summaries are all AI-visible history surfaces. Users need a deterministic local `/forget` control that suppresses matching historical context from future model prompts without deleting their saved market data or rewriting visible transcripts.

## What Changes

- Define `/forget <topic>` where `topic` is a ticker, phrase, or free text, with deterministic ticker and phrase matching.
- Persist forget entries in the OpenCandle memory SQLite database so suppression applies across sessions and processes.
- Filter four AI-visible history surfaces at read time: `priorTurns`, structured memory/prompt-context rows, saved market-state summaries, and compaction or branch summaries used for prior-turn derivation.
- Keep suppression non-destructive: saved watchlist, portfolio, alert, report, transcript, and memory rows stay on disk and in the GUI/TUI unless a separate user action deletes them.
- Define confirmation, listing, and undo behavior for `/forget`, `/forget` with no argument, and `/forget --remove <topic>`.

## Scope

The implementation is expected to touch `src/pi/`, `src/runtime/session-coordinator.ts`, `src/memory/`, and prompt-context assembly, but this change is specification-only. No implementation is delivered by this proposal.

## Memory Schema Ask

This proposal requests the memory SQLite schema change required by `AGENTS.md`: add an additive v9 to v10 migration for a durable `forget_entries` table, for example `forget_entries(id, kind TEXT CHECK(kind IN ('ticker','phrase')), pattern TEXT, created_at)`. The implementation PR must link this proposal as the ask-first authorization, include a migration test upgrading a representative v9 database constructed in a temporary directory, and prove no data loss. The original draft reserved v8 to v9, but `close-the-loop` now owns that additive migration for `analysis_reflections`.

## Non-Goals and Limitations

- No deletion of watchlist, portfolio, alert, daily-report, transcript, or provider data is implied.
- No transcript redaction: GUI and TUI continue to display historical turns containing the topic. Transcript redaction is a possible follow-up change.
- No provider-side or model-side deletion is implied.
- Forgetting does not prevent the user from re-introducing the topic; a new mention in a future turn is fresh context. The forget list filters history, not the live user turn.
