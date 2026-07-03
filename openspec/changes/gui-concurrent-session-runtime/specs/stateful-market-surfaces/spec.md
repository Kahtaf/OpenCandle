## MODIFIED Requirements

### Requirement: GUI Mutations Remain Session Visible

OpenCandle SHALL record GUI-originated market-state mutations in the explicitly targeted GUI route session transcript as structured state-change or synthetic tool-result entries.

#### Scenario: GUI watchlist mutation is visible to the next agent turn

- **WHEN** the GUI adds a symbol to a watchlist from a session-scoped surface
- **THEN** OpenCandle persists the row in SQLite
- **AND** appends a session-visible entry to the explicit target session containing the domain, action, instrument id, target id, and source `ui`
- **AND** a subsequent agent turn in that same target session can see the recent action in session context
- **AND** the mutation does not append transcript entries to another browser route merely because it is globally active or was previously focused

#### Scenario: Follower GUI does not silently mutate without transcript visibility

- **WHEN** the GUI is in follower mode for the explicit target session and cannot append session-visible entries there
- **THEN** mutation controls are disabled, prompt for writer takeover, or route the mutation through a writer-owned append path for that target session
- **AND** OpenCandle does not silently persist GUI changes that the target session transcript cannot observe

#### Scenario: TUI mutation remains transcript visible

- **WHEN** a TUI or agent-tool flow mutates market state
- **THEN** the mutation is visible through the normal tool result or structured state-change entry
- **AND** GUI and later chat turns can reconcile the persisted row with the conversation history

#### Scenario: Transcript does not become source of truth

- **WHEN** session entries and SQLite market state disagree
- **THEN** SQLite market state is authoritative for saved watchlists, portfolios, alerts, and report configuration
- **AND** transcript entries are audit/context evidence for a specific target session, not the primary market-state store
