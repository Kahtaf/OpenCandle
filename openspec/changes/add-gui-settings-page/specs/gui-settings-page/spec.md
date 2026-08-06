# gui-settings-page

## ADDED Requirements

### Requirement: Settings page route and navigation

The GUI SHALL render a dedicated Settings page for the already-registered `/settings` route, plus section paths of the form `/settings/<section>` where `<section>` is one of `model`, `providers`, `preferences`, `automation`, `diagnostics`, `data`. The sidebar SHALL carry a Settings nav entry in its own nav group below the "Market State" group, and the Diagnostics entry SHALL leave the "Market State" group. `/settings` with no section SHALL resolve to the first section (`model`). Unknown section slugs SHALL resolve to the first section rather than rendering chat. The route SHALL be dispatched by `App.jsx`/`route-resolution.js` like other pages (the shell does manual pathname dispatch, not router components).

#### Scenario: Settings opens from the sidebar

- **WHEN** the user clicks the Settings nav entry in the sidebar
- **THEN** the app navigates to `/settings` and renders the Settings page with the Model section active
- **AND** the sidebar marks the Settings entry active, in both the local and hosted GUI

#### Scenario: Section deep link

- **WHEN** the user opens `/settings/providers` directly
- **THEN** the Settings page renders with the Data providers section active

#### Scenario: Legacy diagnostics path still works

- **WHEN** the user opens `/diagnostics` (bookmark, old link)
- **THEN** the app shows the Diagnostics content as the active Settings section at `/settings/diagnostics`
- **AND** no "Diagnostics" entry remains in the "Market State" sidebar group

#### Scenario: Dead-route regression is gone

- **WHEN** the user opens `/settings` or any `/settings/<section>` path
- **THEN** the chat panel is not rendered as the page body

### Requirement: Section rail layout

The Settings page SHALL be a full page (not a modal or sheet) with a persistent left section rail listing, in order: Model, Data providers, Preferences, Notifications & automation, Diagnostics, Data & privacy. Selecting a rail item SHALL update the URL to the matching `/settings/<section>` path. Section content SHALL use the app's existing card/row grammar (label, one-line description, right-aligned control). At narrow widths the rail SHALL collapse to a horizontally scrollable tab strip above the content rather than disappearing.

#### Scenario: Rail navigation

- **WHEN** the user selects "Data & privacy" in the section rail
- **THEN** the content column shows the Data & privacy section and the URL becomes `/settings/data`
- **AND** browser back returns to the previously active section

#### Scenario: Narrow viewport

- **WHEN** the Settings page renders at a phone-width viewport
- **THEN** every section remains reachable via a tab strip or equivalent control
- **AND** the page has no document-level horizontal overflow

#### Scenario: Hosted-only section gating

- **WHEN** the local GUI renders the section rail
- **THEN** hosted-only rows (key retention choice, export/import/clear controls) are absent rather than disabled
- **AND** the Data & privacy section still renders local-relevant content (state location readout)

### Requirement: Model section

Settings → Model SHALL present the current model, model selection, thinking-level default, and model API key management on one section, reusing the existing `ConnectModelPanel`/`ProviderKeyFlow` components (including the hosted key-retention radio) rather than reimplementing them. Existing entry points SHALL navigate here: the composer model chip's "Manage model keys…" item and the transcript "Fix model key" CTA SHALL navigate to `/settings/model` instead of opening the standalone manage dialog. The composer model chip SHALL keep its quick model/thinking switcher unchanged.

#### Scenario: Manage keys from the composer

- **WHEN** the user opens the composer model chip popover and chooses "Manage model keys…"
- **THEN** the app navigates to `/settings/model`
- **AND** the standalone manage-variant dialog is no longer mounted from the composer path

#### Scenario: Fix model key from a failed run

- **WHEN** a chat turn fails with a model-auth failure and the user activates the "Fix model key" action
- **THEN** the app navigates to `/settings/model`

#### Scenario: Key save behavior is unchanged

- **WHEN** the user saves a model API key from Settings → Model
- **THEN** the same probe-before-save validation, inline error reporting, and hosted retention semantics apply as in the current manage dialog

#### Scenario: First-run onboarding is not settings

- **WHEN** a first-time user opens the GUI without a configured model key
- **THEN** the first-run onboarding dialog (intro carousel plus connect step) still opens as a dialog, unchanged
- **AND** completing or dismissing it never navigates to the Settings page as a side effect

### Requirement: Data providers section

Settings → Data providers SHALL list every provider from the shared provider registry as a status row (status dot, provider name, one-line status: configured, managed by environment variable, snoozed until date, never-ask, or not configured). Activating a row SHALL expand or open that provider's existing builder — api-key, external-tool, or public-http — with behavior preserved from the catalog implementation: env-managed keys stay read-only with unset guidance, external-tool rows keep install/session checks and re-enable actions, public-http rows keep reachability checks. In the hosted GUI, providers whose `browserTransport` is blocked SHALL state that they are local-only rather than offering setup.

#### Scenario: Provider rows show registry status

- **WHEN** the user opens Settings → Data providers
- **THEN** all providers from the shared registry render as rows with their probe-derived status
- **AND** statuses match what Diagnostics reports for the same providers

#### Scenario: Saving a data-provider key

- **WHEN** the user enters and saves an Alpha Vantage key from its provider row
- **THEN** the key is validated and persisted through the same command path the catalog builder used
- **AND** the row status updates to configured without a page reload

#### Scenario: Re-enabling a skipped provider

- **WHEN** a provider row shows never-ask or snoozed status and the user activates its re-enable action
- **THEN** the skip preference is cleared and a fresh status check runs, matching current catalog behavior

#### Scenario: Hosted blocked provider

- **WHEN** the hosted GUI renders the Reddit or X provider row
- **THEN** the row states the provider is available only in the local app and offers no install or session actions

### Requirement: Notifications & automation section

Settings → Notifications & automation SHALL surface the daily report schedule (same form component the Reports page opens, including the read-only auto-detected timezone), a read-only webhook delivery row that states whether `OPENCANDLE_NOTIFICATION_WEBHOOK_URL` is configured and that it is env-managed, and an automation status line describing how alert/report automation runs (monitor process locally; runs while the app is open, as applicable). The Reports page SHALL keep its "Configure report" entry point.

#### Scenario: Schedule edited from Settings

- **WHEN** the user changes the report schedule time from Settings and saves
- **THEN** the same `daily_watchlist_report` configure action is dispatched as from the Reports page
- **AND** the Reports page meta line reflects the new schedule

#### Scenario: Webhook row is informational

- **WHEN** no webhook env var is configured
- **THEN** the webhook row states delivery is not configured and names the environment variable
- **AND** offers no editable input

### Requirement: Data & privacy section

Settings → Data & privacy SHALL host data-management controls. In the hosted GUI it SHALL carry the actions currently in `HostedRuntimePanel`: install update (only when an update is waiting), export data, import data, clear secrets, and clear all. Clear all SHALL require a typed confirmation in an app dialog (the user types a fixed confirmation word) instead of the native `confirm()`. In the local GUI the section SHALL show a read-only readout of where state lives (`~/.opencandle`, honoring `OPENCANDLE_HOME`) without destructive actions. Follower tabs and offline states SHALL disable mutating actions with the same neutral language used elsewhere.

#### Scenario: Clear all requires typed confirmation

- **WHEN** the hosted user activates "Clear all"
- **THEN** an app dialog explains what is deleted and requires typing the confirmation word before the destructive button enables
- **AND** cancelling leaves all data intact
- **AND** confirming performs the existing `hosted.data.clear_all` flow and reloads

#### Scenario: Export and import from Settings

- **WHEN** the hosted user activates export or import in Settings → Data & privacy
- **THEN** the existing `hosted.data.export` / `hosted.data.import` flows run with unchanged validation and file formats

#### Scenario: Local data readout

- **WHEN** the local GUI renders Settings → Data & privacy
- **THEN** the section states the OpenCandle home directory path and that provider keys live in the local config file
- **AND** renders no clear/export/import controls

### Requirement: Hosted runtime panel becomes status-only

The hosted runtime footer panel SHALL present only runtime status (phase dot and message, and the install-update affordance MAY remain as a status-row action) and SHALL no longer contain export, import, clear secrets, or clear all controls; it SHALL link to Settings → Data & privacy for data management.

#### Scenario: Footer panel after relocation

- **WHEN** the hosted app renders after this change
- **THEN** the footer strip shows runtime status without a data-management menu
- **AND** a link or button in the strip navigates to `/settings/data`

### Requirement: Catalog keeps run surfaces only

The ⌘K catalog SHALL present Workflows and Tools tabs only. The Providers tab SHALL be removed, and existing provider deep links (`?drawer=providers`, `?drawer=catalog` with a `provider` param, and Diagnostics "Connect" actions) SHALL navigate to Settings → Data providers with the matching provider row focused or expanded.

#### Scenario: Provider deep link redirects

- **WHEN** the app receives a URL containing `?drawer=providers&provider=alpha_vantage`
- **THEN** it navigates to `/settings/providers` with the Alpha Vantage row expanded or focused
- **AND** no provider tab renders inside the catalog sheet

#### Scenario: Diagnostics remediation navigates to Settings

- **WHEN** a Diagnostics provider check offers its "Connect" remediation and the user activates it
- **THEN** the app navigates to Settings → Data providers focused on that provider
