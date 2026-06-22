## Why

`opencandle doctor` currently reports only provider readiness, so it can say Reddit or Twitter/X is installed while the browser session needed for sentiment still is not usable. Users need one trustworthy place, in both CLI and GUI, to understand whether OpenCandle can run, which capabilities are degraded, and what exact remediation command or action comes next.

## What Changes

- Introduce a versioned, structured OpenCandle health diagnostic report shared by the CLI and GUI.
- Expand `opencandle doctor` from provider-only output into a full health report covering runtime, local paths/state, model readiness, providers, external tools, optional browser-session checks, GUI status, and actionable remediation.
- Add a GUI Diagnostics page that renders the same diagnostic report as the CLI while linking to existing provider and model setup actions.
- Separate external-tool binary readiness from browser-session readiness for Reddit and Twitter/X sentiment.
- Add privacy-aware session probes that are explicit opt-in from both CLI and GUI because they may read browser cookies or trigger platform permission prompts.
- Add machine-readable doctor output for tests, support, and future bug-report workflows.

## Capabilities

### New Capabilities

- `doctor-health-diagnostics`: Defines the shared CLI and GUI health diagnostics report, severity model, safe/default checks, opt-in session checks, remediation output, and parity between terminal and browser surfaces.

### Modified Capabilities

None.

## Impact

- Affected CLI code: `src/cli-main.ts`, new doctor report builder/renderer modules, and command flag handling for `doctor`.
- Affected GUI server code: new diagnostic report endpoint or WebSocket action that exposes the shared report model.
- Affected GUI web code: new Diagnostics route/page, navigation entry, status cards, provider/model setup links, and session-check controls.
- Affected provider diagnostics: reuse `src/onboarding/provider-status.ts`, external-tool command discovery, provider registry metadata, and existing redaction/session classification.
- Affected runtime diagnostics: Node version guard, `better-sqlite3` native dependency check, OpenCandle path/config/state inspection, Pi model readiness, and GUI `/health` status.
- Tests should cover report construction, CLI text/JSON rendering, privacy-aware session probe behavior, GUI endpoint shape, and GUI rendering of blocked/degraded/ready states.
