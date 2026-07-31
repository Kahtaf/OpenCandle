## ADDED Requirements

### Requirement: Static hosted runtime needs no OpenCandle server

The system SHALL provide a hosted OpenCandle build that is deployable as static
assets and SHALL execute OpenCandle application runtime work on the user's
device without an OpenCandle application server, credential relay, provider
proxy, or server database.

#### Scenario: Static deployment boots the runtime

- **WHEN** a user opens the hosted build from a compliant static origin
- **THEN** the app boots its browser runtime without contacting an OpenCandle
  application server
- **AND** runtime health states whether its external browser-runtime dependency
  is available

#### Scenario: Hosted runtime dependency is unavailable

- **WHEN** the browser runtime cannot boot
- **THEN** existing local data remains readable and exportable
- **AND** the app reports that research execution is unavailable without
  claiming the local process is still running

### Requirement: Product surfaces share one domain and event core

Hosted web, local web, and local TUI SHALL use the same OpenCandle routing,
planning, analysts, tools, workflows, evidence normalization, Pi session-entry
semantics, and canonical chat-event contract. Platform-specific behavior SHALL
be supplied through explicit runtime, persistence, secret, and transport
adapters.

#### Scenario: Same session events render in hosted and local web

- **WHEN** an equivalent canonical Pi entry sequence is opened in hosted web
  and local web
- **THEN** both surfaces project it through the same `ChatEvent` contract and
  reducer
- **AND** they produce equivalent message, tool, source, and run state

#### Scenario: Local products keep native composition

- **WHEN** the local GUI or local TUI starts after hosted mode is added
- **THEN** it continues to use native Node, filesystem Pi sessions, and native
  SQLite
- **AND** it does not load browser runtime or PWA persistence dependencies

### Requirement: Hosted turns use the real Pi agent loop

The hosted runtime SHALL run the real Pi model/agent loop and OpenCandle
routing, tools, workflow, and evidence code for enabled capabilities. It MUST
NOT replace the agent loop with direct UI fetches or a hosted-only answer
generator.

#### Scenario: Hosted chat turn runs through Pi

- **WHEN** a user submits a hosted chat prompt with a configured browser-safe
  model and at least one enabled tool
- **THEN** the runtime creates a Pi user entry, executes the Pi agent loop,
  records tool and assistant entries, and streams canonical chat events
- **AND** the resulting session can be replayed after reload

### Requirement: Browser runtime transport is fail closed

The browser runtime transport SHALL authenticate every message by exact origin,
exact source, allowlisted operation, bounded payload, runtime epoch, and
unguessable request identifier. It MUST NOT use wildcard response targets or
place secrets in URLs, command arguments, generated bundles, responses, DOM
text, or logs.

#### Scenario: Forged runtime message is ignored

- **WHEN** a message has the wrong origin, source, operation, epoch, or request
  identifier
- **THEN** the host and runtime ignore it without performing an action or
  returning sensitive state

#### Scenario: Secret remains out of observable output

- **WHEN** a sentinel key is saved, restored, used for a turn, and cleared
- **THEN** it does not appear in the password field after restore, runtime
  health, chat events, logs, browser errors, URLs, or generated assets

