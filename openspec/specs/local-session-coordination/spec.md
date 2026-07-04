# local-session-coordination Specification

## Purpose
TBD - created by archiving change transparent-local-session-coordinator. Update Purpose after archive.
## Requirements
### Requirement: Transparent Local Session Coordinator
OpenCandle SHALL coordinate local GUI server, browser, and TUI chat write intents through one authoritative local owner for each target session without exposing writer/follower ownership to the user.

#### Scenario: Non-owner local surface submits a prompt
- **WHEN** a local GUI or TUI surface submits a chat prompt for a session owned by another live local coordinator
- **THEN** OpenCandle forwards the prompt to the coordinator instead of disabling the surface as follower-only
- **AND** the user sees normal sending or syncing feedback, not writer/follower terminology

#### Scenario: Owner surface submits a prompt
- **WHEN** the surface handling the request already owns the target session
- **THEN** OpenCandle executes the prompt through the local session runtime directly
- **AND** other connected local surfaces receive the resulting transcript updates

#### Scenario: Multiple browser clients send to the same session
- **WHEN** two local browser tabs or agent-driven browser clients submit messages to the same session
- **THEN** the coordinator serializes the accepted session writes
- **AND** both clients observe the same canonical transcript order after synchronization

#### Scenario: Session run is already active
- **WHEN** a session run is active and another local surface submits a second prompt that cannot be admitted under the current single-active-run model
- **THEN** the coordinator returns a neutral busy or retryable state
- **AND** it does not queue the prompt silently or start a competing run

### Requirement: Per-Session Ownership and Conservative Recovery
OpenCandle SHALL evaluate local ownership per target session and SHALL NOT recover a session from a still-live owner process solely because the owner heartbeat is delayed.

#### Scenario: Owner process is alive but heartbeat is late
- **WHEN** a local surface needs to write and the recorded owner PID is still alive but heartbeat is stale
- **THEN** OpenCandle reports a retryable syncing or reconnecting state
- **AND** it does not create a competing writer for the same session

#### Scenario: Owner process is gone
- **WHEN** the recorded owner process identity is no longer alive or the owner is otherwise definitively abandoned
- **THEN** OpenCandle may recover ownership for that target session
- **AND** the original surface receives a retryable syncing or reconnecting result instead of automatically replaying an action whose acceptance status is unknown

#### Scenario: Owner PID is reused or abandonment is ambiguous
- **WHEN** OpenCandle cannot prove the recorded owner process identity is the original live owner or a definitively abandoned owner
- **THEN** it does not create a competing writer automatically
- **AND** it may offer a neutral manual recovery path that does not expose writer/follower ownership terminology

#### Scenario: Coordinator scope is per session
- **WHEN** one process owns session A and another process owns session B
- **THEN** forwarding and stale recovery are evaluated against the target session identity
- **AND** ownership of one session does not imply ownership of another session

#### Scenario: Session is not yet persisted
- **WHEN** a new session does not yet have a canonical persisted session id or file
- **THEN** OpenCandle may use the session directory as a startup-only coordinator scope
- **AND** it moves coordination to the canonical session identity once that identity exists using a serialized handoff that prevents two owners for the same session

### Requirement: Per-Session Coordination State
OpenCandle SHALL represent coordinator readiness per target session instead of exposing one process-wide writer/follower role as the authority for all actions.

#### Scenario: One process handles multiple sessions
- **WHEN** one GUI process owns session A, opens session B owned by another local coordinator, and views session C as read-only history
- **THEN** OpenCandle evaluates write routing against each target session independently
- **AND** a process-wide startup role does not determine whether all session actions are enabled or disabled

#### Scenario: Browser receives session state
- **WHEN** the GUI sends boot, reconnect, or session-switch state to the browser
- **THEN** the browser receives neutral per-session coordination state such as ready, syncing, reconnecting, busy, or unavailable
- **AND** the normal user-facing state does not depend on writer/follower role strings

### Requirement: Heartbeat Freshness During Active Work
OpenCandle SHALL refresh coordinator heartbeats throughout active session work so other surfaces can distinguish live work from abandoned ownership.

#### Scenario: Long-running stream is active
- **WHEN** a session run is streaming, invoking tools, or synthesizing a response
- **THEN** the owning coordinator refreshes its heartbeat before the stale grace window expires
- **AND** another local process does not recover the session while the owner process remains alive

#### Scenario: Owner process exits
- **WHEN** the owner process exits or can no longer be observed as alive
- **THEN** another local surface may recover the session after confirming abandonment
- **AND** recovery does not depend on a user-facing takeover action

### Requirement: Authenticated Local Coordinator Endpoint
OpenCandle SHALL authenticate forwarded local session write intents before the coordinator accepts them, within OpenCandle's local single-user threat model.

#### Scenario: Trusted local surface forwards an action
- **WHEN** a local GUI server or TUI forwards a session action to a coordinator endpoint
- **THEN** the request includes a trusted local capability associated with the coordinator metadata
- **AND** the coordinator accepts it only when the caller is authorized for that local session action

#### Scenario: Browser page targets coordinator directly
- **WHEN** an arbitrary browser page calls the coordinator endpoint without going through the trusted GUI server session
- **THEN** OpenCandle rejects the request
- **AND** no prompt, tool invocation, or transcript write is performed

#### Scenario: Same-user local process is malicious
- **WHEN** a same-user local process can read OpenCandle's local files or process memory
- **THEN** defending against that process is outside this local single-user coordination scope
- **AND** OpenCandle still avoids exposing coordinator capabilities to arbitrary browser pages

### Requirement: Session-Scoped Idempotent Actions
OpenCandle SHALL attach stable action identifiers to supported session mutating requests so reconnects and proxy retries cannot duplicate writes.

#### Scenario: Session action is retried after reconnect
- **WHEN** a session-scoped prompt, direct tool invocation, run control, or `ask_user` answer is retried with the same action id after a connection interruption
- **THEN** the coordinator applies it at most once for that session
- **AND** returns or broadcasts the accepted result for that action

#### Scenario: Accepted action is not automatically retried after owner recovery
- **WHEN** a dead-owner recovery may retry an action whose prior acceptance status is unknown
- **THEN** OpenCandle surfaces a retryable error to the non-owner surface
- **AND** it does not automatically retry the action across owner recovery in v1
- **AND** durable action-id persistence remains deferred until automatic retry across owner recovery is intentionally enabled

#### Scenario: User intentionally repeats an action
- **WHEN** the user deliberately submits the same prompt text again as a new action
- **THEN** the client mints a fresh action id
- **AND** the coordinator treats it as a distinct user intent rather than a duplicate retry

#### Scenario: Duplicate action arrives through proxy and direct paths
- **WHEN** the same action id reaches the coordinator through more than one local path within the dedupe retention window
- **THEN** OpenCandle deduplicates the duplicate request
- **AND** does not append duplicate user prompts, tool invocations, run controls, or `ask_user` answers

### Requirement: User-Facing Coordination Language
OpenCandle SHALL describe coordination failures and recovery using user-facing connection language rather than internal ownership roles.

#### Scenario: Coordinator is reconnecting
- **WHEN** the GUI or TUI is reconnecting to the local coordinator
- **THEN** the surface may show "Reconnecting", "Syncing", or equivalent neutral connection language
- **AND** it SHALL NOT show "writer", "follower", "read-only follower", or "take over" as the primary user-facing state

#### Scenario: Coordinator is unavailable
- **WHEN** no coordinator can be reached and recovery is unsafe or fails
- **THEN** OpenCandle shows a retryable local availability error
- **AND** any disabled controls explain that OpenCandle is reconnecting or unavailable, not that the user is in follower mode

#### Scenario: Deferred setup or market-state mutation is unavailable
- **WHEN** a setup or market-state mutation is not routable because global setup and saved-state coordination are outside this change
- **THEN** OpenCandle keeps the relevant mutation control honestly unavailable in that window
- **AND** the message uses neutral connection or availability language without claiming that the action will be proxied

### Requirement: Cross-Surface Verification Contract
OpenCandle SHALL verify transparent local coordination with real GUI and TUI surfaces, including Browser-driven GUI checks and multiple clients submitting messages.

#### Scenario: GUI and TUI use the supported v1 topology
- **WHEN** a TUI-owned session and GUI browser view target the same local session
- **THEN** the GUI can forward supported session actions through the TUI owner endpoint and observe the accepted transcript update after synchronization
- **AND** when a GUI-owned persisted session is joined from an interactive TUI with coordinator metadata, the TUI can forward prompts through the GUI owner and poll the session file for transcript updates
- **AND** a non-interactive non-owner TUI reports neutral syncing language instead of silently tailing or writing directly
- **AND** neither surface exposes writer/follower terminology during the supported successful flow

#### Scenario: TUI owns the session coordinator
- **WHEN** a TUI owns the target session and a GUI Browser client submits a supported session action
- **THEN** the GUI forwards the action through the TUI's local coordinator listener or chosen IPC transport
- **AND** the GUI observes the accepted transcript update after synchronization

#### Scenario: GUI owns the session coordinator
- **WHEN** the GUI owns the target persisted session and an interactive TUI opens the same session while coordinator metadata is available
- **THEN** the TUI forwards prompts to the GUI owner rather than acquiring a competing writer lock
- **AND** the TUI polls the persisted session file for new transcript entries
- **AND** broader live TUI tailing outside this interactive follower proxy remains deferred

#### Scenario: Multiple agents submit through GUI clients
- **WHEN** two automated agents or browser clients submit messages through local GUI clients for the same session
- **THEN** the resulting transcript is serialized by the coordinator
- **AND** all clients converge on the same transcript state
