## 1. Shared Diagnostic Model

- [x] 1.1 Add `src/doctor/` report types for schema version, sections, checks, statuses, severity, capability impact, remediation, metadata, and JSON serialization
- [x] 1.2 Implement the shared doctor report builder that derives the overall status from severity and core-vs-optional capability impact
- [x] 1.3 Add safe runtime and local-state checks for OpenCandle version, Node support, native SQLite readiness, working directory, `OPENCANDLE_HOME`, config parsing, onboarding state, state stores, and Pi agent directory
- [x] 1.4 Add model readiness checks that distinguish missing auth from missing active model selection

## 2. Provider and Session Diagnostics

- [x] 2.1 Adapt provider registry and onboarding status data into doctor report provider checks grouped by capability category and tier
- [x] 2.2 Report credential and install sources without exposing secret values
- [x] 2.3 Add external-tool binary checks for Reddit and Twitter/X with exact install remediation commands
- [x] 2.4 Separate Reddit and Twitter/X browser-session readiness from external-tool binary readiness
- [x] 2.5 Add opt-in browser-session probes with redaction for cookies, tokens, session values, credential paths, and raw sensitive output

## 3. CLI Doctor Surface

- [x] 3.1 Rewire `opencandle doctor` to render the shared doctor report as concise grouped terminal output
- [x] 3.2 Preserve existing `doctor --enable <provider>` behavior and ensure the report reflects re-enabled provider state
- [x] 3.3 Add `doctor --json` output using the shared structured report
- [x] 3.4 Add `--sessions` as the only browser-session probe flag, including a safe default and `--full` behavior that marks browser sessions as not checked unless `--sessions` is also present
- [x] 3.5 Add GUI reachability diagnostics for full CLI health checks using configured host/port with a documented default fallback, without failing overall health when the GUI is not running

## 4. GUI Diagnostics Surface

- [x] 4.1 Add a GUI server endpoint or WebSocket action that returns the shared doctor report
- [x] 4.2 Add a first-class `/diagnostics` page that renders runtime, state, model, provider, sentiment, session, and GUI status sections
- [x] 4.3 Add navigation to the Diagnostics page without replacing the existing Providers drawer
- [x] 4.4 Link provider remediation actions to the existing provider setup surface
- [x] 4.5 Link model readiness remediation actions to the existing model setup panel
- [x] 4.6 Add an explicit GUI action for browser-session checks that warns before running privacy-sensitive probes

## 5. Documentation and Validation

- [x] 5.1 Update CLI and GUI documentation for doctor output, JSON mode, session-check privacy behavior, and remediation flows
- [x] 5.2 Add unit tests for report construction, status derivation, runtime checks, provider checks, redaction, and session-check opt-in behavior
- [x] 5.3 Add CLI tests for default text output, `--json`, `--enable`, and explicit session-check flags
- [x] 5.4 Add GUI server tests for the doctor report endpoint or WebSocket action
- [x] 5.5 Add GUI rendering tests for ready, degraded, blocked, skipped, and unknown diagnostic states
- [x] 5.6 Run `npm test`, targeted CLI/GUI tests, `npm run gui` with browser verification of the Diagnostics page, and `openspec validate enhance-doctor-health-diagnostics --strict`
