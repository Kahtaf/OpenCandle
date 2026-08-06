## ADDED Requirements

### Requirement: Static hosted runtime needs no OpenCandle server

The system SHALL provide a hosted OpenCandle build that is deployable as static
assets and SHALL execute OpenCandle application runtime work on the user's
device without an OpenCandle application server or server database. A separate
auditable Worker MAY relay only fixed provider requests that fail direct-browser
CORS proofs; it SHALL NOT store credentials, requests, responses, or sessions.

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

The hosted runtime SHALL create Pi's canonical `Agent` and `SessionManager`
through the same OpenCandle session core as the local GUI and TUI, including command dispatch,
extension lifecycle, model and thinking controls, retries, context accounting,
and compaction. It SHALL run the real Pi model/agent loop and OpenCandle
routing, tools, workflow, and evidence code for enabled capabilities. It MUST
NOT replace the agent session with a partial hosted shim, direct UI fetches, or
a hosted-only answer generator.

#### Scenario: Hosted chat turn runs through Pi

- **WHEN** a user submits a hosted chat prompt with a configured browser-safe
  model and at least one enabled tool
- **THEN** the runtime creates a Pi user entry, executes the Pi agent loop,
  records tool and assistant entries, and streams canonical chat events
- **AND** the resulting session can be replayed after reload

#### Scenario: Long hosted chat reaches the compaction threshold

- **WHEN** a hosted session reaches Pi's automatic context-compaction threshold
- **THEN** the same Pi agent/session-core compaction lifecycle used locally runs
  in the browser-hosted Node process
- **AND** canonical compaction entries survive checkpoint and reload

### Requirement: Model discovery and execution use canonical Pi internals

Hosted web, local web, and local TUI SHALL derive model choices from the same
Pi-backed OpenCandle model catalog and SHALL use Pi provider implementations
for model execution. Hosted web MAY filter providers by proven browser
capability, but MUST NOT maintain hosted-only model IDs, provider protocols, or
fallback routing. The selected provider and model SHALL drive both OpenCandle
routing and Pi agent streaming.

When a supported model API lacks browser CORS, hosted web SHALL route Pi's
unchanged provider request through the negotiated fixed relay's raw streaming
endpoint. The relay SHALL enforce exact model host, path, method, header,
credential, origin, size, time, and rate-limit policies and SHALL NOT persist or
interpret the request, response, credential, or session.

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

#### Scenario: Pi model stream crosses the fixed relay

- **WHEN** Pi sends an OpenAI, Anthropic, or Google model request from hosted web
- **THEN** the shared hosted fetch adapter carries that request through the
  provider-restricted raw relay endpoint
- **AND** Pi consumes the upstream stream with its normal provider, retry,
  cancellation, thinking, and error behavior intact

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

### Requirement: Credential admission and workflows use shared execution paths

Every API-key entry surface SHALL use the shared provider validation probe and
shall accept a key only after that probe succeeds. Hosted probes MUST traverse
the same bounded relay policy required by the corresponding Pi provider; local
GUI and TUI retain their direct native transport. Hosted workflows and manual
tool invocations SHALL render canonical streamed/durable result cards from the
shared event contract, not only their prompt or plan text.

#### Scenario: Hosted key probe is required before save

- **WHEN** a user enters a model or supported provider key in hosted setup
- **THEN** the shared validation probe reaches the allowed provider endpoint
  through the relay where browser CORS requires it
- **AND** a rejected, malformed, or unavailable key is not represented as
  configured on any surface

#### Scenario: Workflow produces result cards

- **WHEN** a hosted user runs a browser-capable workflow with a configured
  model and its required tools
- **THEN** canonical tool, progress, result, error, and completion events render
  through the shared workflow/chat card components
- **AND** the transcript does not stop at workflow step prompts
