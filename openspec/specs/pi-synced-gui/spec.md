# pi-synced-gui Specification

## Purpose
Defines how the browser GUI stays synchronized with Pi sessions, model and provider settings, session history, and writer/follower process roles.
## Requirements
### Requirement: Peer GUI Surface
The system SHALL provide a local GUI as a peer surface to the TUI, using Pi/OpenCandle session primitives as the canonical source of chat history, tool events, and resume state.

#### Scenario: GUI resumes TUI-created session
- **WHEN** a user opens the GUI after creating a session in the TUI
- **THEN** the GUI lists that session and can resume it without copying history into a browser-owned store

#### Scenario: TUI resumes GUI-created session
- **WHEN** a user creates or continues a session in the GUI and later opens the TUI
- **THEN** the TUI can read the same Pi/OpenCandle session history and continue the thread

### Requirement: Canonical Browser State Boundary
The GUI SHALL NOT treat IndexedDB, localStorage, TanStack Query cache, or any browser-local persistence as canonical chat history.

#### Scenario: Browser cache is cleared
- **WHEN** a user clears browser storage and reloads the GUI
- **THEN** previous sessions and messages remain available from Pi/OpenCandle session storage

#### Scenario: Browser caches UI preferences
- **WHEN** the GUI stores layout preferences, selected panel state, or draft UI state in browser storage
- **THEN** those preferences do not replace or fork canonical session history

### Requirement: Chat-First Layout
The GUI SHALL present chat as the primary first-screen workflow, with financial context available without displacing the main conversation.

#### Scenario: Desktop layout
- **WHEN** the GUI is opened on a desktop viewport
- **THEN** the main chat occupies the central workspace and a right-side financial context panel is visible or one click away

#### Scenario: Mobile layout
- **WHEN** the GUI is opened on a mobile viewport
- **THEN** chat remains the primary view and session history plus financial context are accessible through mobile-appropriate drawers, tabs, or panels

### Requirement: Session History and Resume
The GUI SHALL provide visible session history and resume controls on both desktop and mobile.

#### Scenario: Desktop session history
- **WHEN** a user opens the desktop GUI
- **THEN** prior sessions are available from the main shell without requiring a direct URL or terminal command

#### Scenario: Mobile session history
- **WHEN** a user opens the mobile GUI
- **THEN** prior sessions are reachable through a mobile control and can be resumed

### Requirement: Financial Context Projection

The GUI SHALL derive the financial context panel from the visible route session history, tool events, and current run state rather than from independent browser-only state.

#### Scenario: Quote tool updates context

- **WHEN** a stock quote tool result appears in the visible route session
- **THEN** the financial context panel reflects the visible route session's active symbol and latest quote data from that result

#### Scenario: Reconnect rebuilds context

- **WHEN** the browser reconnects or reloads during an existing route session
- **THEN** the financial context panel is rebuilt from canonical state for that route session

### Requirement: Writer and Follower Safety
The GUI SHALL preserve single-writer session safety internally while presenting local GUI, browser, and TUI chat surfaces as normal clients that route supported session actions through the local session coordinator.

#### Scenario: Session is coordinated by another live local surface
- **WHEN** the GUI opens a session currently coordinated by another local OpenCandle surface
- **THEN** the GUI can read the session and submit supported session write intents through that coordinator
- **AND** it does not present the session as follower/read-only during normal operation

#### Scenario: Coordinator is available
- **WHEN** the GUI submits a session prompt and a live coordinator is available
- **THEN** the action is executed by the coordinator or proxied to it
- **AND** transcript updates are broadcast back to connected local surfaces

#### Scenario: Session state replaces process-wide role
- **WHEN** the GUI switches between sessions with different local coordinator owners
- **THEN** the GUI evaluates readiness, syncing, busy, or unavailable state for the selected target session
- **AND** it does not reuse one process-wide writer/follower role to enable or disable every session action

#### Scenario: Coordinator owner is alive but delayed
- **WHEN** the GUI submits a write intent and the recorded coordinator PID is still alive but heartbeat is late
- **THEN** the GUI shows a neutral syncing or reconnecting state
- **AND** it does not attempt a user-facing takeover or create a competing writer

### Requirement: Local GUI Boundary
The GUI SHALL remain local and single-user for this change.

#### Scenario: GUI starts locally
- **WHEN** the user runs the GUI command
- **THEN** the GUI serves a local browser app backed by the local OpenCandle runtime

#### Scenario: Hosted behavior is requested
- **WHEN** hosted multi-user sharing or cloud sync is needed
- **THEN** that behavior is deferred to a separate change

### Requirement: First-Run Provider Onboarding
The GUI SHALL provide actionable first-run onboarding when the required model or provider API key is not configured.

#### Scenario: No model API key is configured
- **WHEN** a first-time user opens the GUI without a configured model API key
- **THEN** the chat surface shows setup actions and does not remain indefinitely in a connecting state

#### Scenario: API key is added
- **WHEN** the user adds or tests an API key through GUI onboarding
- **THEN** the GUI updates provider/model readiness and returns the user to the pending chat workflow

### Requirement: Distinct Runtime States
The GUI SHALL distinguish onboarding, connecting, syncing, reconnecting, streaming, failed, and ready states without exposing internal writer/follower ownership as a normal user-facing mode.

#### Scenario: Agent stream is connecting
- **WHEN** a prompt has been submitted and the run is waiting for the stream to begin
- **THEN** the GUI labels the state as connecting and keeps setup states visually distinct

#### Scenario: Local coordinator is syncing
- **WHEN** the active browser tab is routing a write intent through another local coordinator or waiting for a live owner to reconnect
- **THEN** the relevant submitting control shows transient syncing or reconnecting feedback
- **AND** the GUI does not describe the tab as follower-only or read-only follower mode

#### Scenario: Coordination fails
- **WHEN** the GUI cannot reach a live coordinator and recovery is unsafe or fails
- **THEN** the GUI shows a retryable unavailable state
- **AND** any disabled write controls use neutral connection language rather than writer/follower terminology

#### Scenario: Deferred non-session mutation is unavailable
- **WHEN** setup or market-state mutation coordination is outside the current session coordinator scope
- **THEN** the GUI may disable the relevant mutation controls in that window
- **AND** the disabled state uses neutral availability language rather than implying session write proxying exists

### Requirement: Accessible Shell Interactions
The GUI SHALL make primary shell interactions keyboard accessible and screen-reader legible.

#### Scenario: Command palette
- **WHEN** the user opens the command palette from the keyboard
- **THEN** focus moves into the palette and the user can select an action without a pointer

#### Scenario: Mobile drawer
- **WHEN** a mobile session or context drawer is opened
- **THEN** focus is contained within the drawer until it is closed

### Requirement: GUI mirrors provider setup and degradation state

The GUI SHALL render provider setup and degradation state using the shared provider registry/status probes. The provider setup surface SHALL be the Data providers section of the Settings page (the ⌘K catalog no longer carries a Providers tab). After the Reddit `rdt-cli` migration, the GUI SHALL treat Reddit as an external-tool provider with separate install and session checks.

#### Scenario: Reddit provider row shows external-tool setup

- **WHEN** the user opens Settings → Data providers
- **THEN** the Reddit row shows the `rdt-cli` install command `uv tool install rdt-cli`
- **AND** it does not render an API-key input
- **AND** it explains that Reddit uses the user's supported browser session through `rdt-cli`

#### Scenario: GUI first-time setup starts with install guidance

- **WHEN** Reddit sentiment is needed in the GUI and `rdt` is not installed
- **THEN** the GUI shows first-time setup guidance with `uv tool install rdt-cli`
- **AND** offers retry/continue after install, skip Reddit once, and always skip Reddit actions

#### Scenario: GUI first-time setup then asks for login

- **WHEN** `rdt` is installed but `rdt status` reports no usable Reddit session after an explicit check
- **THEN** the GUI asks the user to run `rdt login` or refresh their Reddit browser login
- **AND** offers retry/continue after login, skip Reddit once, and always skip Reddit actions

#### Scenario: Passive GUI polling does not read Reddit cookies

- **WHEN** the Reddit provider row's setup surface is open
- **THEN** passive polling may run `rdt --version`
- **AND** it SHALL NOT run `rdt status`, `rdt login`, `rdt search`, `rdt sub`, or `rdt read`

#### Scenario: Explicit GUI Reddit session check

- **WHEN** the user clicks the Reddit session check action
- **THEN** the GUI warns that `rdt-cli` may read browser cookies or saved `rdt-cli` credential state
- **AND** only then may OpenCandle run `rdt status`
- **AND** the result is displayed without cookie values or credential file contents

#### Scenario: GUI Reddit degradation banner

- **WHEN** a GUI chat turn would have used Reddit sentiment but `rdt-cli` is missing or the Reddit session is unavailable
- **THEN** the assistant turn includes an inline degradation banner or source-gap note
- **AND** the final synthesis can still use Twitter and web/news sources

#### Scenario: GUI browser verification includes final synthesis

- **WHEN** implementation verification is performed before push
- **THEN** a real GUI browser test submits a natural sentiment prompt
- **AND** the screenshot or captured state shows the Reddit tool call, Reddit output or setup gap, and the final assistant synthesis

### Requirement: GUI sentiment cards render untrusted source evidence

The GUI SHALL render tweets, Reddit posts, comments, headlines, snippets, notable claims, and driver text derived from third-party source content as untrusted evidence. Reddit evidence normalized from `rdt-cli` SHALL follow the same untrusted rendering rules as the existing Reddit provider output.

#### Scenario: rdt-cli Reddit post/comment evidence

- **WHEN** a Reddit sentiment card renders posts or comments returned through `rdt-cli`
- **THEN** post titles, post bodies, comment bodies, author names, and driver labels are rendered as untrusted source evidence
- **AND** no `rdt-cli` credential path, cookie value, or raw stderr is rendered in the evidence card

### Requirement: GUI renders sentiment insights without obscuring sample size
The GUI SHALL render sentiment insight fields from tool details when present, including key positive drivers, key negative drivers, confidence, caveats, scoring sample size, and representative evidence count. The GUI SHALL distinguish representative preview items from the full scoring sample.

#### Scenario: Representative preview is smaller than scoring sample
- **WHEN** a sentiment tool result reports `sampleSize: 50` and 5 representative items
- **THEN** the GUI shows that 50 records contributed to the score
- **AND** it labels the 5 displayed items as representative evidence, not the full sample

#### Scenario: Insight fields are absent
- **WHEN** a legacy sentiment tool result has score/count fields but no `details.insight`
- **THEN** the GUI renders the existing score/count card
- **AND** it does not show empty driver, confidence, or caveat sections

### Requirement: GUI preserves untrusted-source boundaries for sentiment evidence
The GUI SHALL render tweets, Reddit posts, comments, headlines, snippets, notable claims, and driver text derived from third-party source content as untrusted evidence. The GUI SHALL NOT render third-party source text as instructions or trusted assistant-authored analysis.

#### Scenario: Driver text comes from source content
- **WHEN** a sentiment insight driver or notable claim is derived from a tweet, post, comment, headline, or snippet
- **THEN** the GUI labels or styles it as source evidence
- **AND** it does not present it as OpenCandle's own conclusion unless the assistant final answer separately synthesizes it

### Requirement: Catalog Payload Excludes Credential Secrets

The GUI catalog/provider payload SHALL never contain stored credential secret values. Provider configuration state SHALL be communicated as status metadata only.

#### Scenario: Configured provider serializes status, not the key

- **WHEN** the server serializes an API-key provider that has a saved credential
- **THEN** the payload carries configured status, credential source, and at most a masked hint (such as the last four characters)
- **AND** the raw API key value is absent from the payload

#### Scenario: Provider form offers replace-only input

- **WHEN** the user opens the provider setup form for a configured provider
- **THEN** the form shows a configured indicator and an empty replace-key input
- **AND** the saved key is never prefilled into any DOM field

#### Scenario: Saving a replacement key uses the existing save path

- **WHEN** the user enters and saves a replacement key
- **THEN** the existing provider save action persists it
- **AND** subsequent payloads still expose only status metadata

### Requirement: Catalog Tool Forms Derive From Served Schemas

The GUI catalog SHALL build tool invocation forms from the tool parameter schemas served in the catalog payload, so form definitions cannot drift from registered tools.

#### Scenario: Form fields come from the served parameter schema

- **WHEN** the user opens a tool's invocation form in the catalog
- **THEN** field names, types, required flags, enums, defaults, and descriptions derive from that tool's served parameter schema
- **AND** no hand-written per-tool field definition is consulted

#### Scenario: Overrides adjust presentation only

- **WHEN** a per-tool override exists for labels, placeholder examples, or curated defaults
- **THEN** the override refines presentation of schema-derived fields
- **AND** it cannot introduce fields absent from the served schema or reference a tool name that is not in the catalog payload

#### Scenario: No orphan form schemas

- **WHEN** the catalog renders its tool list and forms
- **THEN** every renderable form corresponds to a tool present in the served catalog
- **AND** entries for nonexistent tools (such as the former `predict_returns`) do not exist

### Requirement: Empty-State Suggestions Lead With Fast Prompts

The GUI empty-state prompt suggestions SHALL lead with fast, keyless prompts and SHALL label the multi-analyst workflow as a deep-research option.

#### Scenario: First suggestions are quick wins

- **WHEN** a user views the empty-thread prompt suggestions
- **THEN** the first suggestions are fast keyless prompts such as quotes, comparisons, or filings
- **AND** `/analyze` is not the first suggestion

#### Scenario: Deep research is labeled as such

- **WHEN** the suggestions include the multi-analyst `/analyze` workflow
- **THEN** it is presented with deep-research framing that sets the expectation of a longer multi-step run

### Requirement: Session-Addressed GUI Chat Routes

The GUI SHALL treat `/sessions/<session-id>` as the authoritative visible chat target for session-route reads and chat sends that occur from that route.

#### Scenario: Direct historical route resolves by id

- **WHEN** the user opens `/sessions/<existing-session-id>` directly
- **THEN** the GUI loads that session by id from Pi/OpenCandle session storage
- **AND** it does not require a previous active-session selection or WebSocket activation message

#### Scenario: Existing session open is correlated

- **WHEN** the user opens an existing session from the sidebar
- **THEN** the route target is the selected session id
- **AND** the visible transcript is populated from a session-addressed bootstrap or a correlated acknowledgement for that id
- **AND** a late acknowledgement or snapshot for a different route does not replace the visible transcript

#### Scenario: New session waits for acknowledged identity

- **WHEN** the user starts a new conversation from the GUI
- **THEN** the GUI waits for the server to acknowledge the created session id before navigating to the session route
- **AND** no old session transcript is shown as the new conversation's canonical transcript
- **AND** creation failure leaves the current visible route unchanged except for an error state

#### Scenario: Session route chat send carries expected session

- **WHEN** the browser route is `/sessions/<session-id>` and the user submits a prompt
- **THEN** the browser sends the chat run to a session-addressed run endpoint for `<session-id>`
- **AND** the request body carries the same expected session id

#### Scenario: Session mismatch is rejected

- **WHEN** a session-addressed run request route and body name different session ids
- **THEN** the GUI server rejects the request with HTTP 409
- **AND** the error payload includes code `session_changed`
- **AND** the browser treats that response as a stale-session conflict instead of appending the prompt to the wrong transcript

### Requirement: Concurrent Route Sessions

The GUI SHALL permit independent chat runs in different route sessions while preserving one active run per individual session.

#### Scenario: Send in another session while one runs

- **WHEN** session A has an active assistant run
- **AND** the user navigates to session B
- **AND** the GUI can write to session B
- **THEN** the user can submit a prompt in session B without waiting for session A to complete

#### Scenario: Same-session overlapping run is rejected

- **WHEN** session A already has an active run
- **AND** the user submits another prompt to session A
- **THEN** the GUI rejects the second prompt with an explicit same-session busy state
- **AND** it does not append a second concurrent user prompt to session A
- **AND** it does not queue the second prompt unless a separate queueing requirement is added

#### Scenario: Run state remains route-scoped

- **WHEN** session A has an active run
- **THEN** session A's route shows the active run state
- **AND** session B's route does not become disabled solely because session A is running

### Requirement: Current-Route Auxiliary Panels

The GUI SHALL keep chat-adjacent panels that display tool calls, research evidence, sources, or run timelines scoped to the currently visible route session.

#### Scenario: Panel selection identity includes session

- **WHEN** the GUI stores a selected run, tool group, source list, research card, or transcript outline item for an auxiliary panel
- **THEN** that selection identity includes the owning `sessionId`
- **AND** the GUI does not match panel content across sessions by unscoped message id, run id, tool-call id, grouped-row id, title, or index

#### Scenario: Tool panel closes or clears on session change

- **WHEN** the research/tool timeline panel is open for a tool run in session A
- **AND** the user navigates to session B
- **THEN** the panel no longer displays session A tool calls as if they belonged to session B
- **AND** the GUI either closes the panel, clears the panel selection, or binds it only to an explicit session B selection whose identity includes session B

#### Scenario: Open panel updates from the current route session

- **WHEN** the research/tool timeline panel is open while viewing session A
- **AND** additional tool-call or tool-result events arrive for session A
- **THEN** the panel updates from session A's current grouped rows or session store
- **AND** late events from session B do not mutate the visible panel while session A remains the route session

#### Scenario: Auto-open is session-scoped

- **WHEN** session A starts or streams a tool run
- **AND** the browser is currently viewing session B
- **THEN** session A's tool run does not auto-open the research/tool panel over session B
- **AND** session B's panel state is changed only by session B content or by an explicit user action in session B

### Requirement: GUI Mutations Use Explicit Session Actions

The GUI SHALL send every transcript-affecting mutation to an explicit target session and SHALL use the coordinator `actionId` envelope defined by the `local-session-coordination` capability for supported local session actions.

#### Scenario: Legacy active-session mutation path is unavailable

- **WHEN** a GUI server route would mutate chat or transcript state without an explicit target `sessionId`
- **THEN** the route is removed or returns HTTP 410
- **AND** the server does not resolve the mutable current active session as the target for that mutation

#### Scenario: Client mutation calls carry session identity

- **WHEN** the browser sends a chat run, stop, retry/regenerate, `ask_user` answer, `ask_user` cancellation, or direct `tool.invoke` request
- **THEN** the request includes the target `sessionId`
- **AND** the request is rejected before mutation if the target session cannot be identified

#### Scenario: Coordinator action id envelope is used

- **WHEN** a supported GUI mutation is submitted
- **THEN** it flows through the coordinator's `actionId` envelope for that target session
- **AND** transport retries reuse the same `actionId`
- **AND** a deliberate repeated user action mints a fresh `actionId`

#### Scenario: No implicit active-session mutation remains

- **WHEN** maintainers inspect GUI server mutation routes and browser mutation call sites
- **THEN** grep-level proof or a route-table snapshot shows no chat run, stop, retry/regenerate, `ask_user`, or direct `tool.invoke` mutation resolves the active session implicitly
- **AND** read-only bootstrap, listing, and navigation paths are the only code paths allowed to consult active browser focus without creating a transcript mutation

### Requirement: Cross-Session Action Concurrency

The GUI SHALL allow independent sessions to run concurrently while preserving one active run and one action target per session.

#### Scenario: Different sessions can run concurrently

- **WHEN** session A has an active run
- **AND** the browser submits a prompt to session B with a distinct `sessionId`
- **THEN** session B can start and stream without waiting for session A
- **AND** session A and session B maintain independent run state

#### Scenario: Same session remains single active run

- **WHEN** session A already has an active run
- **AND** another prompt targets session A
- **THEN** OpenCandle rejects the second prompt with a neutral same-session busy or retryable state
- **AND** it does not queue the prompt silently
- **AND** it does not start a competing same-session run

#### Scenario: Stop or cancel targets only one session

- **WHEN** session A and session B both have active or pending work
- **AND** the browser sends stop or cancel for session A
- **THEN** only session A's targeted run or pending action is affected
- **AND** session B continues unchanged
- Shipped stop semantics (v1): "stop" for a chat run is a client-side abort
  of session A's SSE stream — the browser stops rendering and re-enables the
  composer, while the server-side model turn runs to completion and its
  result persists to session A's transcript. Only `ask_user` cancel
  interrupts server-side work. Server-side chat-run interruption is a
  documented follow-up, not a v1 behavior.

#### Scenario: Retry or regenerate stays with the original session

- **WHEN** a failed or completed run in session A exposes retry or regenerate
- **AND** the browser focus has moved to session B
- **THEN** activating that control targets session A
- **AND** the action is blocked by session A's same-session run exclusion if session A is already active
- **AND** session B's transcript and run state are unchanged

#### Scenario: Ask-user answer targets prompt owner

- **WHEN** session A has a pending `ask_user` prompt
- **AND** the browser is currently focused on session B
- **AND** the user answers or cancels the session A prompt
- **THEN** the answer or cancellation is routed to session A's coordinator action
- **AND** session B's run state and transcript are unchanged

### Requirement: GUI-Created Sessions Remain TUI-Continuable

OpenCandle SHALL preserve TUI parity for GUI-created sessions through the current shared Pi/OpenCandle session storage behavior without requiring a schema or session-format change.

#### Scenario: GUI session appears in shared session continuation

- **WHEN** a session is created and written through the GUI
- **THEN** the session appears in the shared Pi/OpenCandle session list or recent-session continuation flow for the same project/session directory
- **AND** the TUI can continue that session through the supported list or recent-session flow
- **AND** the transcript contains the same user, assistant, tool-call, tool-result, error, interruption, and OpenCandle custom entries expected by Pi session readers

#### Scenario: Parity confirmation is scripted

- **WHEN** implementation validation runs for this change
- **THEN** a scripted check creates or identifies a GUI-created session and confirms the TUI/Pi continuation behavior above
- **AND** the result is recorded as implementation evidence

#### Scenario: No storage migration is introduced

- **WHEN** this cleanup is implemented
- **THEN** it does not require a SQLite schema migration
- **AND** it does not require a Pi session format change

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

