## Why

Router prior-turn context now includes recent user and assistant text. That improves follow-up routing, but it also makes conversational text a separate privacy surface from structured memory. Users need a local `/forget` control that removes matching conversational context and matching structured memory before the LLM router sees future turns.

## What Changes

- Add a `/forget` command that accepts a topic, ticker, or free-text phrase.
- Scrub matching structured memory rows and prevent matching prior-turn text from being included in future router context.
- Emit a session-visible confirmation describing what was forgotten without echoing sensitive text.
- Keep deletion local to OpenCandle/Pi state; no provider-side deletion is implied.

## Impact

- **Code:** `src/pi/`, `src/runtime/session-coordinator.ts`, `src/memory/`
- **Tests:** command behavior, prior-turn scrub, structured-memory scrub, non-matching context retained
- **Dependencies:** none expected
