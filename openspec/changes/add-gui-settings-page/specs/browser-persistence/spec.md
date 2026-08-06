# browser-persistence (delta)

## MODIFIED Requirements

### Requirement: Users can export, import, clear, and recover

The PWA SHALL provide validated export/import for Pi sessions and OpenCandle
state, a clear action covering sessions, state, secrets, caches, and runtime
snapshots, and explicit recovery for unsupported or corrupt data. These
controls SHALL be presented in the Settings page's Data & privacy section
(the hosted runtime footer strip carries status only and links there), and
the full clear action SHALL require typed confirmation in an app dialog
rather than a native browser confirm.

#### Scenario: Export clear import round trip

- **WHEN** a user exports a completed session and market state, clears all
  hosted data, and imports the export
- **THEN** the session transcript and supported market state return
- **AND** credentials do not return

#### Scenario: Invalid import is rejected atomically

- **WHEN** an import has an unsupported version, invalid session tree, corrupt
  SQLite snapshot, or unexpected files
- **THEN** the import is rejected with a bounded explanation
- **AND** existing hosted data remains unchanged
- **AND** validation completes before the active runtime is stopped

#### Scenario: Older code encounters a newer state schema

- **WHEN** a hosted build opens state written by a schema version newer than it
  supports
- **THEN** it refuses to open the state without resetting or overwriting it
- **AND** a recovery backup remains available for export or a newer build

#### Scenario: Full clear requires typed confirmation

- **WHEN** the user activates the full clear action from Settings → Data & privacy
- **THEN** an app dialog states what will be deleted and requires typing the
  confirmation word before the destructive control enables
- **AND** cancelling leaves all hosted data unchanged
