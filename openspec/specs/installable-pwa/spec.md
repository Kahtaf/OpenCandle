# installable-pwa Specification

## Purpose
TBD - created by archiving change browser-hosted-pwa. Update Purpose after archive.
## Requirements
### Requirement: Hosted OpenCandle is installable

The hosted build SHALL include a valid web app manifest, service worker, icons,
standalone display configuration, theme metadata, and stable start URL so
supported browsers can install it as an application.

#### Scenario: Installability audit passes

- **WHEN** the production hosted build is inspected in a supported Chromium
  browser
- **THEN** the manifest and service worker satisfy browser installability
  requirements
- **AND** launching the installed app opens the OpenCandle hosted surface

### Requirement: Service worker caches only the application shell

The service worker SHALL cache versioned static application assets and an
offline route. It MUST NOT cache model requests, provider responses, runtime
runtime process traffic, credentials, or mutable session/state exports.

#### Scenario: PWA opens offline

- **WHEN** the application shell has been loaded once and the device later has
  no network
- **THEN** the installed PWA opens, lists and renders durable local sessions,
  and allows export
- **AND** research actions are disabled with an explicit network requirement

### Requirement: Updates preserve durable work

The PWA SHALL activate a new application version only when no run or checkpoint
is active. Required session or database migrations SHALL complete before the
new runtime accepts writes, and a failed migration SHALL preserve the prior
durable snapshot.

#### Scenario: Update arrives during a run

- **WHEN** a waiting service worker becomes available during an active Pi run
- **THEN** the current version completes or cancels the run and checkpoints it
  before offering activation

#### Scenario: Migration fails during update

- **WHEN** a new application version cannot migrate the durable session or
  database state
- **THEN** the app keeps the previous snapshot intact
- **AND** it offers export or reset without accepting writes under the new
  schema

### Requirement: Hosted UI works across installation viewports

The hosted PWA SHALL preserve the existing GUI's core chat, session, source,
tool, and market-state flows at desktop and mobile standalone viewports without
horizontal page overflow or inaccessible writer/runtime status.

#### Scenario: Mobile standalone chat

- **WHEN** the installed PWA opens at a mobile viewport
- **THEN** the user can choose a session, read sources and tool results, submit
  a prompt, and see runtime/writer status using keyboard and touch

