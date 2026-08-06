## ADDED Requirements

### Requirement: One hosted tab owns writes

The hosted PWA SHALL elect exactly one writer tab for a browser profile using
Web Locks or an equivalently exclusive browser primitive. Only the writer SHALL
own the browser runtime and checkpoint OPFS state.

#### Scenario: Second tab becomes follower

- **WHEN** a second tab opens while a healthy writer holds the runtime lock
- **THEN** the second tab identifies itself as a follower
- **AND** it does not boot a second writer runtime or open writable state
  handles

### Requirement: Followers remain active clients

Follower tabs SHALL receive bootstrap state and ordered canonical chat events,
and SHALL forward writer-only actions to the active writer with explicit
acknowledgement and failure handling. Credential-bearing actions SHALL NOT be
forwarded over the coordination channel; a follower MUST become the writer
before accepting model or provider keys.

#### Scenario: Follower submits a prompt

- **WHEN** a follower submits a prompt
- **THEN** the writer validates and executes the prompt once
- **AND** both tabs render the same resulting event sequence without duplicate
  Pi entries

#### Scenario: Concurrent prompts target one session

- **WHEN** two active tabs submit different prompts to the same session before
  its current run completes
- **THEN** the writer accepts one run and rejects the other with a bounded
  already-active error
- **AND** retrying an already completed logical action id does not perform a
  second model call or state mutation

#### Scenario: Follower attempts to save a credential

- **WHEN** a follower submits a model or provider API key
- **THEN** the action is rejected with guidance to use the active writer tab
- **AND** the credential is never placed on the BroadcastChannel

### Requirement: Writer failover is epoch safe

The hosted PWA SHALL attach a runtime epoch to coordination messages. On writer
loss, one follower SHALL acquire the lock, restore the last durable checkpoint,
and announce a new epoch. Messages from older epochs MUST be ignored.

#### Scenario: Writer tab closes during idle

- **WHEN** the writer closes and at least one follower remains
- **THEN** one follower becomes writer, restores durable state, and continues
  accepting actions

#### Scenario: Late event arrives from dead writer

- **WHEN** an event from the previous runtime epoch arrives after failover
- **THEN** all active tabs ignore it
- **AND** no transcript, tool, or market-state record is duplicated

#### Scenario: Writer changes during an unacknowledged follower action

- **WHEN** the writer epoch changes before a follower action receives an
  acknowledgement
- **THEN** the follower rejects the action promptly with bounded retry guidance
- **AND** it does not blindly replay an operation whose completion is unknown

### Requirement: Writer ownership converges without stranding active clients

The hosted PWA SHALL boot WebContainer only in the elected writer and SHALL
make every online tab an action-capable client through the coordination bridge.
Writer change handling MUST either complete an idempotent read against the new
writer or end the action with bounded, actionable state; it MUST NOT leave a
session, prompt, tool invocation, or cancellation indefinitely loading.

#### Scenario: Session navigation crosses a writer epoch

- **WHEN** a follower starts a session load while the old writer is yielding or
  closing
- **THEN** the load retries once against the newly announced writer when its
  effect is read-only
- **AND** the route renders the requested canonical session or a bounded error

#### Scenario: Writer is replaced during an active stream

- **WHEN** an active prompt, tool stream, or cancellation loses its writer
- **THEN** both tabs receive an explicit terminal or recovery state
- **AND** no follower continues to display an unbounded queued or running UI

#### Scenario: Credential entry is attempted from a follower

- **WHEN** a follower opens model or provider setup
- **THEN** the UI identifies the active writer before accepting a secret
- **AND** it either transfers ownership before entry or provides bounded
  guidance without putting the secret on BroadcastChannel
