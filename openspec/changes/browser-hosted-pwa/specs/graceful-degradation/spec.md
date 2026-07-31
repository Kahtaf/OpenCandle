## ADDED Requirements

### Requirement: Hosted capability gaps are explicit before execution

The hosted UI and Pi context SHALL expose the active model, direct providers,
enabled tools, unavailable capability groups, network state, and runtime state
before or during a turn. Unavailable tools MUST NOT be presented as executable.

#### Scenario: User requests an unavailable quote tool

- **WHEN** a hosted user asks for research that requires a provider unavailable
  in serverless browser mode
- **THEN** OpenCandle states the missing capability and names an available local
  OpenCandle surface when appropriate
- **AND** it does not fabricate data or silently substitute an unrelated tool

#### Scenario: Hosted chat attachments are unavailable

- **WHEN** the hosted runtime cannot carry image or saved-state attachments
  through the Pi prompt contract
- **THEN** the composer omits attachment controls and the runtime rejects any
  attachment-bearing request explicitly
- **AND** it never silently discards attached content

### Requirement: Offline mode separates reading from research

When offline, the PWA SHALL keep durable sessions and export available while
disabling model and live-provider actions. Returning online SHALL re-evaluate
capabilities without requiring data reset.

#### Scenario: Network is lost with no active run

- **WHEN** the browser goes offline
- **THEN** existing local transcripts remain readable
- **AND** prompt and provider actions show an explicit network requirement

#### Scenario: Network returns

- **WHEN** connectivity returns and the runtime health check passes
- **THEN** direct providers and model actions become available according to the
  current capability manifest

### Requirement: Runtime failures preserve local data

A hosted runtime boot, provider, model, or checkpoint failure SHALL produce a
bounded recoverable error and MUST NOT clear or overwrite the last durable
session, state, or credentials.

#### Scenario: Runtime boot fails

- **WHEN** browser-hosted Node fails to boot
- **THEN** the PWA offers retry and export
- **AND** existing durable data remains unchanged
