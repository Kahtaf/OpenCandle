## ADDED Requirements

### Requirement: Canonical Chat Event Stream
The system SHALL expose a canonical chat event stream for GUI rendering and replay, covering run lifecycle, message lifecycle, tool lifecycle, errors, and session updates.

#### Scenario: Run starts
- **WHEN** a user sends a prompt from the GUI
- **THEN** the stream emits a `run.started` event with a run ID, session ID, and sequence number

#### Scenario: Run completes
- **WHEN** the agent finishes a prompt successfully
- **THEN** the stream emits `run.completed` after all message and tool completion events for that run

### Requirement: Ordered and Idempotent Events
Every chat event SHALL include a monotonic sequence number that lets the GUI apply events in order and ignore duplicates.

#### Scenario: Duplicate event arrives
- **WHEN** the GUI receives an event whose session sequence has already been applied
- **THEN** the GUI ignores that duplicate without rendering another message or tool card

#### Scenario: Replay rebuilds state
- **WHEN** the GUI rebuilds a chat from historical events
- **THEN** applying the event sequence produces the same rendered message/tool state as the live stream

### Requirement: Stable Tool Lifecycle
Tool rendering SHALL be keyed by stable tool call IDs and SHALL represent started, streaming, completed, and failed states without duplicating cards for the same call.

#### Scenario: Tool emits multiple updates
- **WHEN** a tool call emits started, delta, and completed events with the same tool call ID
- **THEN** the GUI updates one tool card rather than adding repeated cards

#### Scenario: Tool fails
- **WHEN** a tool call fails
- **THEN** the GUI renders a failed tool state with the error and keeps the surrounding chat readable

### Requirement: Assistant Message Streaming
The GUI SHALL render assistant text deltas progressively while preserving final message content from completion events.

#### Scenario: Text delta arrives
- **WHEN** the stream emits a `message.delta` event for an assistant message
- **THEN** the GUI appends the delta to that assistant message without re-rendering unrelated panels

#### Scenario: Message completes
- **WHEN** the stream emits `message.completed`
- **THEN** the GUI treats the completed content as authoritative for that message

### Requirement: First-Class Financial Tool Renderers
The GUI SHALL include first-class renderers for OpenCandle-specific financial tool outputs and a generic fallback for unknown tool outputs.

#### Scenario: Stock quote output
- **WHEN** a `get_stock_quote` result is rendered
- **THEN** the GUI shows a concise quote renderer with symbol, price fields present in the result, timestamps/staleness if available, and raw inspection access

#### Scenario: Options chain output
- **WHEN** an options chain result is rendered
- **THEN** the GUI shows an options-focused renderer rather than raw JSON by default

#### Scenario: Unknown tool output
- **WHEN** a tool output has no matching first-class renderer
- **THEN** the GUI renders a generic inspectable fallback without dropping the output

### Requirement: Renderer Registry
Tool output rendering SHALL be selected through a typed renderer registry rather than hardcoded conditional rendering spread across message components.

#### Scenario: Renderer matches tool output
- **WHEN** a tool result is available
- **THEN** the GUI asks the renderer registry for a matching renderer by tool name and output shape

#### Scenario: Renderer is added later
- **WHEN** a future OpenCandle tool gains a first-class renderer
- **THEN** the renderer can be added to the registry without rewriting the core message list reducer

### Requirement: Material Data Warnings
Financial renderers SHALL preserve material warnings, missing-provider states, stale-data indicators, and credential-required messages.

#### Scenario: Provider credential is missing
- **WHEN** a tool result indicates required provider credentials are missing
- **THEN** the renderer surfaces that condition instead of presenting the output as complete

#### Scenario: Data is stale or partial
- **WHEN** a tool result includes stale, partial, or degraded data metadata
- **THEN** the renderer visibly communicates that limitation

### Requirement: Browser Rendering Tests
The revamped GUI SHALL include browser-level tests that verify chat messages, tool outputs, session history, mobile navigation, and financial context render correctly.

#### Scenario: Prompt with tool call
- **WHEN** a browser test sends a prompt that triggers a stock quote tool call
- **THEN** the test verifies the assistant message, single quote tool card, and financial context update are visible

#### Scenario: Mobile history
- **WHEN** a browser test runs at a mobile viewport
- **THEN** the test verifies session history is reachable and a prior thread can be resumed

### Requirement: Stream Controls
The GUI SHALL provide controls for stopping an active stream and retrying or regenerating after a failed or completed run when the active surface has writer permission.

#### Scenario: Stop active stream
- **WHEN** an assistant response is streaming and the user activates stop
- **THEN** the GUI requests cancellation, stops accepting further deltas for that run, and preserves the partial transcript state

#### Scenario: Retry failed run
- **WHEN** a run fails
- **THEN** the GUI exposes a retry action that starts a new run without duplicating the failed tool cards

### Requirement: Message Actions
The GUI SHALL provide common message actions without cluttering the default transcript.

#### Scenario: Copy assistant output
- **WHEN** the user activates copy on an assistant message
- **THEN** the GUI copies the rendered assistant text in a deterministic plain-text form

#### Scenario: Inspect tool output
- **WHEN** the user expands raw inspection for a tool card
- **THEN** the GUI shows the raw tool input and output without replacing the first-class summary renderer

### Requirement: UI Inspiration Traceability
The GUI implementation SHALL document that llmchat's `packages/ui` is a visual/primitives reference only.

#### Scenario: Developer reads GUI docs
- **WHEN** a developer reads the GUI implementation notes
- **THEN** the docs point to `https://github.com/trendy-design/llmchat/tree/main/packages/ui` as inspiration and state that OpenCandle does not depend on llmchat
