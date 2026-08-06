## ADDED Requirements

### Requirement: Hosted device uses Pi-compatible canonical sessions

In hosted mode, OPFS-backed Pi session entries SHALL be the canonical session
record for that browser profile. Browser caches, derived UI state, and
projectors SHALL remain rebuildable and non-canonical. This hosted-device rule
MUST NOT change the local GUI or TUI requirement that Pi filesystem sessions
are canonical.

#### Scenario: Clearing derived hosted state preserves session

- **WHEN** hosted React/query caches and derived projector state are cleared but
  canonical OPFS session entries remain
- **THEN** reopening the session reconstructs the same transcript and run state

#### Scenario: Clearing all hosted data removes device sessions

- **WHEN** the user explicitly confirms the hosted clear-all action
- **THEN** OPFS Pi sessions, OpenCandle state, secrets, and derived caches are
  removed from that browser profile
- **AND** the UI warns before clearing that hosted sessions are device-local

### Requirement: Hosted and local sessions are explicitly portable

Hosted mode SHALL export Pi-compatible session JSONL and SHALL import validated
Pi-compatible JSONL. Portability SHALL be explicit rather than pretending a
browser profile and local filesystem share one live session directory.

#### Scenario: Hosted session continues in local TUI

- **WHEN** a hosted session export is imported into local OpenCandle
- **THEN** the local TUI can open and continue its Pi session tree
- **AND** prior OpenCandle custom entries remain available

