# browser-persistence Specification

## Purpose
TBD - created by archiving change browser-hosted-pwa. Update Purpose after archive.
## Requirements
### Requirement: Hosted Pi sessions are durable and format compatible

The hosted runtime SHALL persist canonical Pi session entries in OPFS using the
same session version, entry union, IDs, parent IDs, and `opencandle-*` custom
entries used by local OpenCandle. Derived React state, caches, and projectors
MUST NOT become the session source of truth.

#### Scenario: Session survives a full reload

- **WHEN** a hosted turn completes durably and the page is fully reloaded
- **THEN** the session list and transcript are rebuilt from OPFS-backed Pi
  entries
- **AND** the user and assistant messages, tool calls, sources, and run state
  match the completed turn

#### Scenario: Hosted session is accepted by local Pi

- **WHEN** a hosted session is exported
- **THEN** the exported JSONL passes the real Pi session reader
- **AND** local OpenCandle can continue the same session tree without a format
  migration

### Requirement: Hosted market state uses compatible SQLite semantics

The hosted runtime SHALL persist OpenCandle market, memory, workflow, and
diagnostic state through a synchronous WASM SQLite adapter whose schema
version, migrations, transactions, query results, and constraints conform to
the native `better-sqlite3` adapter for supported operations.

#### Scenario: Browser and native schema conformance

- **WHEN** the shared schema and migration conformance suite runs against both
  adapters
- **THEN** both expose the same schema version, tables, indexes, constraints,
  and representative read/write behavior

#### Scenario: Market state survives reload

- **WHEN** a user changes a hosted watchlist, portfolio, or other enabled market
  state and reloads the PWA
- **THEN** the last acknowledged durable state is restored from OPFS

### Requirement: Durability acknowledgement follows checkpoint

The hosted runtime SHALL report a Pi entry or state mutation as durable only
after the matching runtime bytes have been checkpointed to OPFS. A runtime
failure before checkpoint acknowledgement MUST NOT corrupt the last durable
snapshot.

#### Scenario: Runtime fails during checkpoint

- **WHEN** the runtime writes inside its process but the OPFS checkpoint fails
- **THEN** the UI reports that the action is not durable
- **AND** reboot restores the last acknowledged snapshot without applying a
  partial entry or database file

### Requirement: Browser secrets remain separate from research state

The hosted runtime SHALL store persistent provider/model credentials in a
dedicated browser secret store and SHALL offer a session-only mode. Session and
market-state exports MUST NOT contain credentials.

Credentials SHALL be stored per model provider, while the selected Pi provider
and model SHALL be durable non-secret setup state. Changing the selected model
MUST NOT erase credentials for other configured providers.

#### Scenario: Session-only key disappears

- **WHEN** a user selects session-only credential storage and closes the final
  PWA tab
- **THEN** reopening the PWA requires the key again
- **AND** saved sessions and market state remain available

#### Scenario: Session-only key remains tab scoped during writer failover

- **WHEN** a writer and follower tab are open with a session-only model key and
  the writer closes
- **THEN** the key is not transferred through the same-origin live
  coordination channel and the promoted follower requests model setup before continuing
- **AND** no durable browser archive or persistent credential store receives
  the key

#### Scenario: Export contains no key

- **WHEN** a user exports all hosted data after using a sentinel credential
- **THEN** the export contains no sentinel value or credential-bearing runtime
  environment

#### Scenario: Clearing a key removes it from the active process

- **WHEN** a user clears a configured model key while the hosted runtime is active
- **THEN** persistent and session-only credential storage are cleared
- **AND** the credential-bearing browser runtime is torn down before a keyless
  runtime is made available

#### Scenario: Multiple provider credentials survive model switching

- **WHEN** a user configures two browser-safe model providers, switches between
  their Pi models, and reloads the PWA
- **THEN** the selected provider and model are restored
- **AND** each provider retains its own configured or session-only credential
  state without exposing either key

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

### Requirement: Bootstrap and updates converge on durable browser state

The hosted PWA MUST make first launch, reload, service-worker activation,
writer promotion, and a return from offline converge on the last durable
session, model setup, and state checkpoint. Transient snapshots MUST NOT be
presented as a false first-run configuration or a valid ready state.

#### Scenario: Reload while durable credentials and model selection exist

- **WHEN** a user reloads a hosted PWA with a persistent configured provider
- **THEN** setup restores the selected model and configured state before the UI
  permits a conflicting first-run flow
- **AND** any bootstrap failure is recoverable and bounded

#### Scenario: Checkpoint acknowledgement is delayed or fails

- **WHEN** a hosted mutation cannot receive a checkpoint acknowledgement in its
  bounded window
- **THEN** the UI identifies whether the mutation is durable, pending, or
  retryable
- **AND** a subsequent bootstrap reconciles canonical OPFS state without
  claiming an unknown mutation succeeded

