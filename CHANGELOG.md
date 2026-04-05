# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-04-05

### Added

- **Twitter/X sentiment tool** — `get_twitter_sentiment` scores social sentiment from tweets with engagement weighting. Authenticates via Camoufox; auto-triggers login when sessions expire.
- **Addon tool registry** — third-party packages can register tools at runtime. `createTool()` validates naming and metadata. See `docs/build-a-tool.md`.
- **Three-level error recovery** — circuit breaker skips tripped providers, stale cache serves expired entries within domain windows, `withFallback()` tries alternate providers (e.g. Yahoo → AlphaVantage).
- **Bull/bear debate** — comprehensive analysis gains three adversarial debate steps producing verdicts with reversal conditions. Toggled via `OPENCANDLE_DEBATE`.
- **Agent runtime v2** — typed `WorkflowRunner` state machine, `SessionCoordinator` decomposition, structured provenance, selective memory retrieval, and workflow event logging.
- **Eval framework** — 7-layer scoring (5 deterministic + 2 LLM-judge), 18 eval cases, baseline regression detection, and timestamped run history.
- **Agent test harness** — file-based IPC for end-to-end testing. CLI subcommands (`run`, `wait`, `answer`, `trace`) let any coding agent drive OpenCandle headlessly.
- Alpha Vantage `getGlobalQuote()` and `getDailyHistory()` for fallback paths.

### Fixed

- Type errors in `session-coordinator` — `runSetup` accepts both context types; return type includes `"cancelled"`.

## [0.1.2] - 2026-04-01

### Added

- `ask_user` clarification tool — agent asks follow-ups for vague requests instead of guessing.
- Data-first response playbooks — fetches live market data before responding.

## [0.1.1] - 2026-03-30

### Changed

- Use npm trusted publishing for releases.
- Avoid duplicate publish workflow runs.

## [0.1.0] - 2026-03-30

Initial OpenCandle release.
