## MODIFIED Requirements

### Requirement: Prior-Turn Privacy and Forget Integration

The system SHALL provide a local `/forget` command that suppresses matching historical context before future router and agent prompts are assembled. Conversational text in `priorTurns` is not governed by the structured-memory `NEVER_TRUST_FROM_MEMORY` guard, so `/forget` SHALL apply the same deterministic matcher to prior-turn derivation, structured memory reads, saved market-state prompt-context summaries, and compaction or branch summaries that can become router-visible history. Suppression SHALL be read-time filtering, not destructive deletion; no suppressed content is ever deleted. (`/forget --remove <topic>` deletes only the forget-list entry itself, restoring visibility of previously suppressed content.)

#### Scenario: Forgotten prior turn is excluded whole

- **WHEN** a session contains a prior user or assistant turn mentioning "ASTS"
- **AND** the user runs `/forget ASTS`
- **THEN** `buildPriorTurns` in `src/runtime/session-coordinator.ts` SHALL exclude the entire matching turn from subsequent router input
- **AND** the turn SHALL NOT be masked, truncated around the match, or rewritten
- **AND** unrelated prior turns remain eligible for `priorTurns`

#### Scenario: Live turn is not filtered

- **WHEN** the user previously ran `/forget ASTS`
- **AND** the next live user turn says "look at ASTS again"
- **THEN** the current turn SHALL remain available to the router as fresh user-provided context
- **AND** only historical context matching the active forget entry SHALL be filtered

#### Scenario: Compaction summary is excluded like a normal turn

- **WHEN** a Pi compaction or branch summary entry contains text matching an active forget entry
- **THEN** that summary SHALL be excluded from prior-turn derivation before the router prompt is rendered
- **AND** the implementation SHALL NOT delete or regenerate existing compaction summaries as part of v1

## ADDED Requirements

### Requirement: Forget Command Topic Matching

OpenCandle SHALL support `/forget <topic>` where `topic` is a ticker, phrase, or free text. The topic SHALL be normalized by trimming whitespace, casefolding, and stripping one leading `$` before mode selection. If the normalized topic matches `^[A-Za-z]{1,5}$`, the entry kind SHALL be `ticker`; otherwise the entry kind SHALL be `phrase`.

Ticker entries SHALL match word-boundary occurrences, case-insensitively, of either the bare symbol or the `$SYMBOL` cashtag. Ticker matching SHALL NOT match inside longer words. Ticker matching SHALL NOT match company-name aliases in v1; for example, forgetting `ASTS` does not match the phrase "AST SpaceMobile" unless the symbol token is also present. Acronym collisions are the user's responsibility. Both ticker and phrase matching SHALL operate on the raw stored text, including markdown syntax characters such as backticks; markdown is not stripped or rendered before matching, so a phrase that spans a markdown boundary (for example, text containing backticks between its words) does not match unless the stored characters match.

Phrase entries SHALL match by case-insensitive substring search on the normalized phrase and target text.

#### Scenario: Ticker does not match inside longer word

- **WHEN** the user runs `/forget ASTS`
- **AND** a prior turn contains "blasts off"
- **THEN** the prior turn SHALL NOT match the forget entry

#### Scenario: Ticker matches a parenthesized acronym token

- **WHEN** the user runs `/forget $IV`
- **AND** a prior turn contains "implied volatility (IV)"
- **THEN** the prior turn SHALL match the forget entry because `IV` appears as a word-boundary token
- **AND** the implementation SHALL treat this acronym collision as the user's responsibility

#### Scenario: Phrase with punctuation matches by substring

- **WHEN** the user runs `/forget rates: higher-for-longer`
- **AND** historical text contains "Rates: higher-for-longer remains my base case"
- **THEN** the text SHALL match the phrase entry case-insensitively

#### Scenario: Phrase spans a markdown code span

- **WHEN** the user runs `/forget cash flow`
- **AND** historical markdown text contains "review `cash flow` assumptions"
- **THEN** the text SHALL match the phrase entry even though the words appear inside a markdown code span

#### Scenario: Cashtag and bare ticker tokens match

- **WHEN** the user runs `/forget ASTS`
- **THEN** historical text containing "ASTS", "$asts", or "asts calls" SHALL match
- **AND** historical text containing "AST SpaceMobile" without an `ASTS` token SHALL NOT match in v1

### Requirement: Durable Forget List Storage

OpenCandle SHALL persist forget entries in the memory SQLite database so active entries apply across sessions and processes. The implementation SHALL add an additive v9 to v10 schema migration that creates a durable table such as `forget_entries(id, kind TEXT CHECK(kind IN ('ticker','phrase')), pattern TEXT, created_at)`. The migration SHALL preserve all existing data and SHALL NOT reset the database on version mismatch.

#### Scenario: Forget entry persists across sessions and processes

- **WHEN** the user runs `/forget ASTS` in one OpenCandle session
- **AND** OpenCandle starts a later session or another process using the same memory database
- **THEN** the later router and prompt-context assembly paths SHALL apply the active `ASTS` forget entry

#### Scenario: v9 database migrates to v10 without data loss

- **WHEN** OpenCandle opens a representative v9 database containing existing workflow, preference, and market-state data
- **THEN** the database SHALL migrate additively to v10
- **AND** `forget_entries` SHALL exist
- **AND** all pre-existing rows SHALL remain present

### Requirement: Structured Memory Suppression

Structured memory and preference rows matching an active forget entry SHALL be excluded from router-visible and analyst-visible prompt-context assembly and memory retrieval. Matching rows SHALL NOT be deleted by `/forget`; they SHALL be filtered at read time by the same matcher used for prior turns.

#### Scenario: Saved preference no longer appears in prompt context

- **WHEN** a saved preference mentions "ASTS"
- **AND** the user runs `/forget ASTS`
- **THEN** future rendered prompt context SHALL NOT include that saved preference
- **AND** the underlying preference row SHALL remain stored unless deleted through a separate user action

### Requirement: Saved Market-State Summary Suppression

Saved market-state prompt-context builders SHALL exclude AI-visible watchlist, portfolio, alert, and report summary entries that match an active forget entry. `/forget` SHALL NOT delete watchlist, portfolio, alert, or report rows from SQLite and SHALL NOT hide them from the GUI or TUI management surfaces.

#### Scenario: Forgotten ticker is omitted from serialized saved-state context

- **WHEN** `ASTS` is present in the user's watchlist
- **AND** the user runs `/forget ASTS`
- **THEN** the serialized prompt context for future model calls SHALL contain no "ASTS" from saved market-state summaries
- **AND** the `ASTS` watchlist row SHALL remain visible and manageable in the GUI

### Requirement: Forget Confirmation and Listing Contract

On successful `/forget <topic>`, the session SHALL show a confirmation that states the kind and count of active patterns added or already present, plus counts of suppressed item categories. The confirmation SHALL NOT echo the matched text or the topic itself beyond the user's own typed command. `/forget` with no argument SHALL list active forget entries, including patterns and the count of items each suppresses, because the user explicitly requested the list.

#### Scenario: Success confirmation does not echo topic text

- **WHEN** the user runs `/forget ASTS`
- **THEN** the session MAY show a confirmation such as "Forgotten: 1 ticker pattern. 3 prior turns and 1 saved preference will no longer be shared with the model."
- **AND** the confirmation SHALL state the pattern kind and suppressed-item counts
- **AND** the confirmation SHALL NOT repeat "ASTS" or any matched historical text outside the user's typed command

#### Scenario: Empty forget command lists active entries

- **WHEN** the user runs `/forget` with no argument
- **THEN** the session SHALL list active forget entries with their stored patterns, kinds, and suppression counts
- **AND** this listing SHALL show patterns because the user requested the active forget list

### Requirement: Forget Undo

OpenCandle SHALL support `/forget --remove <topic>` to delete the matching forget entry from the durable forget list. The command surface SHALL NOT add a separate `/remember` command for v1.

#### Scenario: Removing a forget entry restores future history eligibility

- **WHEN** the user has an active forget entry for `ASTS`
- **AND** the user runs `/forget --remove ASTS`
- **THEN** the durable forget entry for `ASTS` SHALL be deleted
- **AND** future router and prompt-context assembly SHALL stop filtering historical context solely because of that removed entry

### Requirement: Forget Limitations Are Explicit

The `/forget` command SHALL document the v1 limitations: no deletion of watchlist, portfolio, alert, or report rows; no provider-side or model-side deletion; no transcript redaction; and no prevention of future user re-introduction of the topic.

#### Scenario: Historical transcripts remain visible

- **WHEN** a prior GUI or TUI transcript turn contains a forgotten topic
- **AND** the user runs `/forget <topic>`
- **THEN** GUI and TUI continue to display historical turns containing the topic
- **AND** transcript redaction SHALL be documented as a possible follow-up change

#### Scenario: Providers and models are not deletion targets

- **WHEN** the user runs `/forget <topic>`
- **THEN** OpenCandle SHALL NOT imply provider-side deletion or model-side deletion
