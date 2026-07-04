## MODIFIED Requirements

### Requirement: Prior-Turn Context Window

The router SHALL receive the last 5 user/assistant turns of conversation history, the current investor_profile snapshot, and the 3 most recent `workflow_runs` summaries as part of its input context. Prior turns SHALL be retrieved from the active session branch (Pi `ReadonlySessionManager.getBranch()`) at input-event time, filtered to `role === "user"` and `role === "assistant"` message entries with non-empty text content, ordered oldest-to-newest, and sliced to the 5 most recent. Tool-result messages and empty-text turns SHALL be excluded. When the session has fewer than 5 qualifying prior turns, the router SHALL receive the full available history; an empty window is only permitted when the session has no prior qualifying turns.

#### Scenario: Context-dependent query uses prior turns

- **WHEN** the previous turn was "tell me about NVDA" and the current turn is "what about at $500?"
- **THEN** the router's `RouterInputContext.priorTurns` contains the NVDA user turn (and any subsequent assistant text turn) and the emitted `RouterOutput.entities.symbols` contains `"NVDA"`

#### Scenario: Prior turns retrieved at input-event time reflect strictly prior state

- **WHEN** the `pi.on("input")` handler invokes the router
- **THEN** the branch read at that moment contains all prior user/assistant turns but NOT the current turn's text (Pi emits the input event before appending the user message)

#### Scenario: Tool-result and empty-text turns excluded

- **WHEN** the branch contains tool-result messages and an aborted assistant turn with no text content
- **THEN** those entries SHALL NOT appear in `priorTurns`; only user and assistant message entries with non-empty text are included

#### Scenario: Fewer than 5 prior turns

- **WHEN** the session has only 2 qualifying prior turns
- **THEN** `priorTurns` contains those 2 entries, not a padded or empty array

#### Scenario: No prior turns

- **WHEN** the session is fresh and has no prior user/assistant messages
- **THEN** `priorTurns` is an empty array and the router still produces a valid route for the current turn

#### Scenario: Compacted session branch

- **WHEN** the session branch contains a compaction summary entry (Pi `type === "compaction"`) between root and leaf
- **THEN** the `priorTurns` extraction SHALL skip compaction entries (and branch summary entries) rather than attempt to parse their summary text as message content; `priorTurns` MAY be shorter than 5 when the post-compaction message window is narrower than 5, and this is correct behavior — no synthesized messages are injected to pad the window

#### Scenario: Assistant turn with tool calls but no text

- **WHEN** an assistant message entry contains only tool-call content blocks and no text block
- **THEN** that entry contributes nothing to `priorTurns` (it is dropped by the empty-text filter), and the neighboring text-bearing turns retain their positions in the window

## ADDED Requirements

### Requirement: Prior-Turn Shape

Each prior-turn entry SHALL be a `{ role: "user" | "assistant", text: string }` object. The `text` field SHALL contain the concatenated text content of the message. The router prompt renderer SHALL clip each turn's text to a fixed character limit and strip newlines to bound prompt growth. Assistant tool-call summaries SHALL NOT be included in v1.

#### Scenario: Assistant turn with mixed content blocks

- **WHEN** an assistant message contains a text block and a tool-call block
- **THEN** the prior-turn entry contains the text block's content only; the tool call is omitted

#### Scenario: Long text is clipped

- **WHEN** a prior user message exceeds the per-turn character limit
- **THEN** the router prompt renders a clipped version, preserving router-prompt size bounds

### Requirement: Prior-Turn Privacy and Forget Integration

The system SHALL document that conversational text in `priorTurns` is NOT governed by the structured-memory `NEVER_TRUST_FROM_MEMORY` guard and that priorTurns scrubbing is the responsibility of a future `/forget` command. The documentation SHALL name this as a known gap until `/forget` ships.

#### Scenario: Documentation declares the gap

- **WHEN** a contributor reads the router proposal, design, or router README
- **THEN** they find an explicit note that priorTurns is not filtered by the current memory privacy controls and that `/forget` is the designated follow-up primitive

#### Scenario: /forget (when implemented) scrubs priorTurns sources

- **WHEN** a future `/forget <topic>` command is implemented
- **THEN** its contract SHALL include removing or masking matching entries from the session branch or its priorTurns derivation so that subsequent router invocations do not see scrubbed content
