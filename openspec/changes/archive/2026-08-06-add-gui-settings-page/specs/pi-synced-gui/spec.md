# pi-synced-gui (delta)

## MODIFIED Requirements

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
