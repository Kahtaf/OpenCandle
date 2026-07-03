# OpenCandle Review Checklist

Focus on concrete regressions, missing validation, and OpenCandle-specific risks. Do not suggest broad rewrites or speculative abstractions.

## Required Review Focus

- Review scope: review only the diff bundle supplied by the helper. For branch mode that is the branch diff, for local mode that is uncommitted local changes, for commit mode that is the selected commit, and for range mode that is the selected base-to-head diff.
- TDD: behavior changes should have tests; unit tests should mirror `src/` and use public interfaces.
- Finance safety: never allow guessed prices, ratios, metrics, filings, or option values. Flag missing source/freshness context and weak downside-risk framing.
- Tools/providers: tools should fetch and format; analysts/LLM synthesize. External calls should use existing cache/rate-limiter infra and fixture-backed tests.
- Unit tests: no live API calls. Mock `globalThis.fetch` with fixture JSON and avoid importing fixtures into production code.
- Prompt/routing changes: avoid overfitting to specific tickers, sectors, rates, dollar amounts, share counts, or benchmark phrases.
- Eval regressions: classify issues at the narrowest durable layer before changing prompts: routing/planning, slot/entity extraction, tool capability, evidence normalization, policy card, workflow prompt, answer contract, structured check, eval assertion, or harness.
- GUI changes: check server/shared/web contracts together. UI changes need browser verification and the relevant GUI tests/builds.
- GUI React quality: for changes under `gui/web/src`, require React Doctor evidence. Treat React Doctor errors as blockers by default, and treat new warnings as actionable unless the change documents why they are pre-existing or consciously deferred. Maintain a high React Doctor score for UI work rather than accepting regressions in state/effects, performance, architecture, security, or accessibility.
- Package/release changes: require package dry-run proof that shipped files match the intended install behavior.
- Docs freshness: user-facing behavior, setup flow, commands, provider contracts, configuration, API/tool schemas, or architectural changes should update the relevant docs, OpenSpec artifacts, examples, or README sections. Flag stale or missing documentation when the diff changes how users or future agents should operate the system.
- Changelog: atomic features and bug fixes should update `CHANGELOG.md` under `[Unreleased]`.

## Diff-Triggered Checks

When the diff touches these paths, verify the matching invariant. Each rule encodes a recurring OpenCandle regression class; treat a violation as a finding, not a style note.

- `gui/server/**`: every new HTTP route or WebSocket upgrade enforces the trusted-session guard (`isTrustedPrivateApiRequest` or equivalent) before doing any work. Outbound webhook/notification URLs validate scheme and reject loopback, link-local, and cloud-metadata hosts. Files created under `~/.opencandle` are owner-only (0600 files, 0700 dirs).
- `src/routing/**`: bare finance acronyms (IV, SEC, FED, CPI, MA, and similar) are never extracted as tickers without a direct ticker signal such as `$IV` or an explicit "ticker" mention. Symbol drops propagate to BOTH extracted entities and router slots before missing-slot checks so dropped tokens cannot reappear downstream.
- `src/providers/**`, `src/tools/portfolio/**`, `src/market-state/**`: zero-filled or sparse provider payloads map to an explicit unavailable result, never a valid $0.00 quote. Stale cache is never served as fresh. Consumers preserve the last valid observation instead of overwriting it with zeros or unavailable states.
- `src/pi/tui-session-coordinator.ts` and `gui/server/**` coordination: fail closed on lock-scope loss, expire pending actions based on their original timestamps, dedupe in-flight actions by action id, and treat another process as owner only with a live PID plus fresh heartbeat.
- New third-party text sources (sentiment, filings, search, news): all external text routes through the untrusted-text escaping and labeling helpers in `src/tools/sentiment/untrusted-text.ts` before entering assistant-visible output.
- Portfolio/risk/backtest math: denominators are guarded for zero and non-finite values; inputs are validated finite and positive at storage boundaries; value/P&L aggregation never silently mixes currencies without FX conversion.
- `src/memory/sqlite.ts`: schema statements never reference columns or indexes before the additive ALTER that creates them, and a schema-version bump has upgrade coverage from each prior version in `tests/unit/memory/sqlite.test.ts`.
- State mutations (lots, watchlist rows, alerts): updates and deletes target an explicit row/lot id, never symbol-only. Blanked fields clear, absent fields preserve. Concurrent event writes dedupe.
- `src/prompts/**`: guidance is gated on intent, never injected unconditionally; prompt guidance changes update `tests/unit/prompts/prompt-debt-guard.test.ts` and keep benchmark literals out of production prompts.
- `gui/web/src/**`: modules do not mix React component exports with non-component helper exports (hook-order hazard).

## Expected Evidence By Change Type

- General code: `npx tsc --noEmit`, `npm test`, and `git diff --check`.
- Provider/tool changes: focused provider/tool tests with fixtures; live provider tests only when explicitly part of validation.
- Routing/workflow/prompt changes: focused unit tests and, when behavior quality matters, a manual harness or eval report.
- GUI changes: `npm run gui:web:build`; for browser behavior, `npm run test:gui:browser` or documented live browser smoke proof; for React code changes, React Doctor output from autoreview or `npx react-doctor@0.6.2 gui/web --scope changed --base <ref>` (version pin: keep in sync with `scripts/autoreview`).
- Docs/site changes: docs build or local render proof when applicable.
- Package/release changes: `npm pack --dry-run --json --ignore-scripts`.

## Finding Standard

Report only actionable findings that identify a real behavior, security, test, packaging, or maintainability risk introduced or exposed by the diff. Each finding should point to the smallest relevant line and explain how the issue can fail in practice.
