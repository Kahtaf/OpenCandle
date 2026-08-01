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

#### Scenario: Browser-capable feature has one implementation

- **WHEN** a GUI/TUI feature such as a tool workflow, ask-user prompt,
  market-state command, attachment, action marker, or live event can execute
  with hosted platform adapters
- **THEN** hosted web uses the same shared command/session/event implementation
- **AND** a browser capability filter may omit only the unavailable native or
  background portion with an explicit reason

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

### Requirement: Model discovery and execution use canonical Pi internals

Hosted web, local web, and local TUI SHALL derive model choices from the same
Pi-backed OpenCandle model catalog and SHALL use Pi provider implementations
for model execution. Hosted web MAY filter providers by proven browser
capability, but MUST NOT maintain hosted-only model IDs, provider protocols, or
fallback routing. The selected provider and model SHALL drive both OpenCandle
routing and Pi agent streaming.

#### Scenario: Browser-safe provider exposes its Pi models

- **WHEN** a first-class OpenCandle model provider is proven executable in the
  hosted browser runtime
- **THEN** hosted setup exposes every installed Pi catalog model for that
  provider using the shared provider labels and defaults
- **AND** no hosted source file must be edited when Pi adds another catalog
  model for that provider

#### Scenario: Selected model controls the complete turn

- **WHEN** a hosted user selects a provider and model and submits a prompt
- **THEN** the OpenCandle router and Pi agent stream both execute through that
  selected Pi model
- **AND** no OpenAI-only or hosted-only fallback silently handles either call

#### Scenario: Unproven Pi provider fails closed

- **WHEN** Pi supports a provider whose authentication or transport has not
  passed the hosted real-browser proof
- **THEN** local GUI and TUI retain their normal Pi support
- **AND** hosted web omits that provider and reports the browser boundary
  instead of exposing a choice that cannot execute

### Requirement: Browser runtime transport is fail closed

The browser runtime transport SHALL exchange messages only over the spawned
WebContainer process pipes and SHALL validate the allowlisted operation,
bounded payload, runtime epoch, and unguessable request identifier. It MUST NOT
place secrets in URLs, command arguments, generated bundles, responses, DOM
text, or logs.

#### Scenario: Forged runtime frame is ignored

- **WHEN** a process frame has the wrong operation, epoch, or request identifier
- **THEN** the host and runtime ignore it without performing an action or
  returning sensitive state

#### Scenario: Secret remains out of observable output

- **WHEN** a sentinel key is saved, restored, used for a turn, and cleared
- **THEN** it does not appear in the password field after restore, runtime
  health, chat events, logs, browser errors, URLs, or generated assets
