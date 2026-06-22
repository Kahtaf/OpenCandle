## Context

OpenCandle currently has several partial diagnostic surfaces:

- `opencandle doctor` prints provider status only.
- The GUI provider drawer can check individual provider setup and external-tool sessions.
- The GUI `/health` endpoint reports only that the server is alive and whether it is writer or follower.
- Startup already checks Node support and the `better-sqlite3` native binding before the CLI starts.
- Provider registry metadata already describes provider category, tier, install commands, credential env vars, fallback behavior, and browser-session requirements.

The gap is that these checks are not assembled into one coherent health report. A user can see "Twitter installed" without learning whether the browser session required for sentiment is ready, and the GUI has no equivalent to the planned CLI doctor report.

## Goals / Non-Goals

**Goals:**

- Create a shared doctor report model that both CLI and GUI consume.
- Make `opencandle doctor` a one-stop health report for runtime, local state, model setup, providers, external tools, optional browser sessions, and GUI status.
- Add a first-class GUI Diagnostics page with feature parity against the CLI doctor report.
- Keep sensitive browser-cookie/session checks explicit opt-in.
- Provide remediation-oriented output so each degraded check names the next action.
- Support a JSON form for tests, support workflows, and future bug-report export.

**Non-Goals:**

- Do not replace the existing Providers catalog drawer; it remains the remediation surface for saving keys, copying install commands, and checking individual provider status.
- Do not prompt for all provider keys on first run.
- Do not make browser-cookie session probes part of safe/default doctor execution.
- Do not add external telemetry or send diagnostic data outside the local machine.
- Do not make optional enrichment providers block normal chat or market quote workflows.

## Decisions

### Decision: Use One Shared Doctor Report Builder

Implement a shared report builder under `src/doctor/` and have both CLI and GUI consume the same `DoctorReport` data structure. The top-level report should include a schema version so JSON consumers can detect future shape changes.

Rationale: separate CLI and GUI implementations would drift. The provider registry, model setup state, path state, and runtime checks already live in shared server-side code, so the browser should receive rendered report data from the server instead of re-implementing check logic.

Alternatives considered:

- CLI-only doctor with GUI provider checks left as-is. Rejected because it does not meet feature parity and leaves browser users without whole-system diagnostics.
- GUI-only health page backed by ad hoc endpoint logic. Rejected because it would duplicate status logic and not improve CLI supportability.

### Decision: Split Report Construction From Rendering

The report builder should produce structured sections, checks, statuses, severity, remediation text, and metadata. CLI text, CLI JSON, and GUI cards should be separate renderers.

Rationale: this keeps tests focused on behavior and allows the GUI to show the same state in a richer layout without changing diagnostic semantics.

### Decision: Safe Defaults, Explicit Session Checks

Default `opencandle doctor`, `opencandle doctor --full`, and the initial GUI Diagnostics page load should run safe checks only. Reddit/Twitter browser-session probes should run only when the user passes `--sessions` in CLI or clicks an explicit GUI action.

Rationale: session probes may read browser cookies, trigger Keychain prompts, or touch account-specific browser state. Installed binary status and browser-session status are both useful, but they have different privacy and UX expectations.

### Decision: Keep Providers As Setup, Health As Diagnosis

The existing Providers catalog drawer should remain the focused setup surface. The new Diagnostics page should summarize provider health and deep-link or open the provider drawer for remediation.

Rationale: provider setup is one part of health, not the entire health model. Combining Node, SQLite, paths, model setup, GUI role, and provider configuration into the current provider drawer would overload that surface.

### Decision: Severity Is Capability-Aware

Checks should classify impact as `pass`, `warn`, `fail`, `skip`, or `unknown` and separately indicate whether the affected capability is core or optional. Missing optional enrichment providers are warnings or degraded coverage, while missing model setup, unsupported Node, broken native SQLite, or unreachable core market data are failures.

Rationale: users need to know whether OpenCandle is blocked or merely degraded. Optional providers should not make a healthy install look broken.

### Decision: Overall Status Is Derived From Capability Impact

Derive the overall report status from both check severity and capability impact:

- `blocked` when any core check is `fail`.
- `degraded` when no core check fails but any optional check is `fail` or any core/optional check is `warn` or `unknown`.
- `ready` when all core checks pass and optional checks are pass or intentionally skipped.

Rationale: Reddit or Twitter/X sentiment can be locally unusable without making quote, chat, and core analysis workflows look broken. The local section for an optional provider may still show a failure, but the top-level report should describe the install as degraded rather than blocked.

### Decision: JSON Output Is Stable Enough For Tests

Add `opencandle doctor --json` and a GUI endpoint returning the same versioned report shape.

Rationale: a structured report makes CLI behavior testable, supports future bug-report export, and allows GUI feature parity without parsing terminal text.

### Decision: Use "Diagnostics" For The GUI Page

Use "Diagnostics" as the GUI navigation label and `/diagnostics` as the browser route. Keep the existing GUI server `/health` endpoint as a low-level liveness endpoint that the doctor report can call or summarize.

Rationale: `/health` already has a narrow server-liveness meaning. A Diagnostics page can include runtime, state, model, provider, sentiment, session, and GUI role information without overloading that endpoint name.

### Decision: GUI Reachability Uses Defaults Plus Configured State

CLI GUI reachability checks should probe the configured GUI host and port when available, then fall back to the documented local default. A missing GUI server is informational or degraded, not blocked.

Rationale: GUI diagnostics are useful from the CLI, but many terminal-only users will not have the GUI running.

## Risks / Trade-offs

- Browser-session checks may surprise users if run automatically -> keep them opt-in, label them clearly, and reuse existing redaction.
- Health report could become noisy -> group checks by user capability and provide a concise summary before details.
- Missing optional providers may be mistaken for failure -> include capability impact and remediation language for each warning.
- GUI health page can duplicate existing provider setup UI -> make the health page diagnostic and link to the provider drawer for actions.
- Runtime checks may have side effects if they initialize state -> keep default checks read-only where possible and document any file creation if unavoidable.
- Package/install detection may be imperfect across npm, npx, source checkout, and global installs -> report best-effort install context as informational rather than blocking.

## Migration Plan

1. Add the report model and safe check builders without changing existing provider setup behavior.
2. Rewire `opencandle doctor` to render the shared report while preserving `--enable` / `--reenable`.
3. Add JSON output and session-check flags.
4. Add a GUI endpoint or WebSocket action for the same report.
5. Add the GUI Diagnostics route and navigation entry.
6. Update docs to describe CLI/GUI doctor parity and privacy behavior for session checks.
7. Validate with focused unit tests, CLI tests, GUI server tests, GUI build, and packed-install smoke.

Rollback is straightforward: the new doctor command can fall back to the existing provider-only output if report construction fails, and the GUI Health route can be hidden without affecting chat or provider setup.

## Open Questions

- Should future bug-report export include local paths verbatim, or should it offer a redacted copy mode by default?
