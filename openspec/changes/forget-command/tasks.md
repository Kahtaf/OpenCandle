## 1. Command Contract

- [ ] 1.1 Define `/forget <topic>` parsing, empty-input behavior, and confirmation text.
- [ ] 1.2 Define matching rules for tickers, phrases, and saved preference keys.

## 2. State Scrub

- [ ] 2.1 Remove or mask matching structured memory/preferences from SQLite-backed OpenCandle memory.
- [ ] 2.2 Ensure future `priorTurns` derivation excludes matching user/assistant text.
- [ ] 2.3 Preserve unrelated session and memory rows.

## 3. Verification

- [ ] 3.1 Add unit tests for memory deletion/masking.
- [ ] 3.2 Add extension tests proving router context no longer contains forgotten text.
- [ ] 3.3 Run `npm test`.
