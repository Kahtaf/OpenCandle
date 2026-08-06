# doctor-health-diagnostics (delta)

## MODIFIED Requirements

### Requirement: GUI Diagnostics Surface
The GUI SHALL provide a first-class Diagnostics surface rendered as the Diagnostics section of the Settings page at `/settings/diagnostics`, rendering the shared doctor report. The legacy `/diagnostics` path SHALL continue to resolve to this surface. The surface SHALL summarize health and link to remediation actions; provider remediation SHALL navigate to Settings → Data providers.

#### Scenario: Diagnostics page shows whole-system status
- **WHEN** the user opens the Diagnostics section under Settings
- **THEN** the page shows runtime, state, model, provider, sentiment, session, and GUI status sections
- **AND** the status values match the shared doctor report

#### Scenario: Legacy diagnostics route resolves
- **WHEN** the user opens `/diagnostics` directly
- **THEN** the Diagnostics content renders as the active Settings section at `/settings/diagnostics`

#### Scenario: Provider remediation opens provider setup
- **WHEN** a provider check has a remediation requiring key entry, install command, or session check
- **THEN** the GUI offers an action that navigates to Settings → Data providers focused on that provider

#### Scenario: Model remediation opens model setup
- **WHEN** the model readiness section reports `connect_auth` or `select_model`
- **THEN** the GUI offers an action that navigates to Settings → Model
