# preference-transparency

## ADDED Requirements

### Requirement: Persisted preferences are visible

Settings → Preferences SHALL list every row of the `user_preferences` store (namespace, key, human-readable value, source, confidence, updated time) and every row of the `tool_defaults` store (tool name, parameter path, value, set time), grouped under separate headings. Values SHALL render as plain readable text (scalars as-is, structured values as compact JSON). An empty store SHALL render a one-line empty state explaining that the agent saves preferences it learns from conversation. The section SHALL never render provider or model credentials.

#### Scenario: Extracted preference is listed

- **WHEN** the agent has previously persisted `risk_profile` into `user_preferences` and the user opens Settings → Preferences
- **THEN** the risk profile row renders with its value and source
- **AND** the row does not require a page reload to appear after being written mid-session

#### Scenario: Tool default is listed

- **WHEN** a `tool_defaults` row exists for a tool parameter
- **THEN** Settings → Preferences renders it under the tool defaults heading with the tool name, parameter path, and value

#### Scenario: Empty state

- **WHEN** both stores are empty
- **THEN** the section renders explanatory empty-state text and no table chrome

#### Scenario: No secrets in the payload

- **WHEN** the preferences listing payload is produced on any transport
- **THEN** it contains only `user_preferences` and `tool_defaults` rows, never API keys or credential material

### Requirement: Persisted preferences are deletable

Each listed preference row and tool-default row SHALL offer a delete action with an app-dialog confirmation. Deletion SHALL remove the row from durable storage so it no longer enters agent prompt context on subsequent turns. Bulk editing and value editing are out of scope; delete is the only mutation.

#### Scenario: Deleting a preference removes it from prompt context

- **WHEN** the user deletes the `risk_profile` preference and confirms
- **THEN** the row disappears from the list and from the `user_preferences` store
- **AND** the next agent turn's prompt context contains no risk-profile preference

#### Scenario: Delete is confirmed

- **WHEN** the user activates delete on a row and cancels the confirmation dialog
- **THEN** the row and stored value remain unchanged

### Requirement: Preference commands exist on both transports

The runtime SHALL expose list and delete commands for `user_preferences` and `tool_defaults` on the local GUI path (WS command with trusted-session HTTP fallback) and on the hosted runtime path (browser runtime host command), following the established command naming, writer/follower, and error-shape conventions. Follower tabs SHALL see the list read-only, with deletes forwarded or disabled per the surface's existing coordination rules.

#### Scenario: Local transport round trip

- **WHEN** the local GUI requests the preference list and then deletes a row
- **THEN** both operations complete over the WS command path, and the HTTP fallback path serves the same operations when the socket is unavailable

#### Scenario: Hosted transport round trip

- **WHEN** the hosted GUI requests the preference list and deletes a row
- **THEN** the browser runtime host serves both commands against the browser SQLite state
- **AND** the deletion persists across a checkpoint and reload

#### Scenario: Follower tab behavior

- **WHEN** a read-only follower tab renders Settings → Preferences
- **THEN** the list renders, and delete actions follow the same disabled-or-forwarded behavior as other market-state mutations on that surface
