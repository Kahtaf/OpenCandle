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
