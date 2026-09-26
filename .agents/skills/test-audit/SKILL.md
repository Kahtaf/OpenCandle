---
name: test-audit
description: Audit OpenCandle test value, unit/integration/e2e coverage, and duplication; plan or perform bounded test cleanup when requested.
---

# OpenCandle test audit

Prefer deterministic journeys through real application boundaries. Use focused unit tests for financial mathematics, parser edge cases, security decisions, and failure combinations that are expensive or difficult to reach through the UI. Optimize confidence and meaningful branch coverage, not the number of tests deleted or the percentage labeled e2e.

Inspired by [OpenClaw's test-audit skill](https://github.com/openclaw/openclaw/blob/main/.agents/skills/test-audit/SKILL.md). This workflow is specific to OpenCandle; do not assume OpenClaw commands or infrastructure exist here.

## Establish the baseline

- Read root and scoped `AGENTS.md`, `tests/AGENTS.md`, `vitest.config.ts`, `vitest.projects.ts`, package scripts, and CI workflows. Check the working tree before editing.
- Classify tests by what actually executes: pure unit, component integration, HTTP/storage/process integration, browser integration with simulated server responses, full application journey, or live-service canary. Directory names are insufficient.
- Record executed/passed/skipped cases and duration separately for each suite. Distinguish suites present in the repository from suites enforced by PR CI.
- Check the coverage provider is installed and the production denominator includes the requested surfaces. OpenCandle spans `src`, `gui/server`, `gui/shared`, `gui/web/src`, `gui/hosted`, `packages/ui/src`, and `workers/provider-relay`; account for TypeScript, JavaScript, and JSX. Generated files need explicit exclusions with reasons.
- Report unavailable coverage honestly. Never infer percentages from file counts or passing tests. Root Vitest collection does not automatically instrument spawned CLI/server processes, browser bundles, WebContainers, or a separate relay run.

## Examine candidates

Read complete candidate tests and the relevant production path. Follow callers, overlapping proof, and history before deciding. Source-text assertions, repeated inventories, self-produced expectations, and mocks that supply the claimed result are discovery signals, not automatic deletion rules.

For each proposed change record:

| Evidence | Required detail |
| --- | --- |
| Location | File and exact case name |
| Actual protection | A concrete regression it detects today |
| Owner | Production entry point and real callers |
| Remaining proof | Exact retained test, or the replacement still required |
| Origin | Relevant commit or issue and original purpose; state unknowns |
| Decision | Keep, consolidate, replace, delete, or investigate |
| Validation | Focused command, meaningful failure demonstration, and coverage comparison |

Protect independently useful security, package, architecture, and persistence contracts even when they inspect artifacts. A passing happy-path browser test does not replace malformed-input, race, retry, or recovery cases. Do not remove a failing retained test to make the baseline green.

## Choose the application boundary

- **Tools/providers:** exercise the registered tool with fixture HTTP responses; preserve real provider parsing, `wrapProvider`, cache, and rate limiting. Follow the repo's fetch-mocking convention. Inspect dependency transport when a provider does not use global fetch. Keep mathematical boundary cases separately.
- **Local GUI:** start an isolated server and browser with temporary application/session storage. Exercise chat submission, streaming, session selection, ask-user replies, cancellation, and persisted results. Stub external model/provider traffic, keeping internal HTTP/SSE/WebSocket and storage paths real.
- **Browser-only integration:** simulated HTTP/SSE/WS can efficiently test rendering and user interaction, but cannot prove server delivery, authorization, or durability. Label that limit.
- **Agent/TUI:** use `tests/harness/opencandle-runner.ts` and `tests/harness/README.md`. Collector tests with synthetic events prove the collector, not the live agent. Keep live-model quality checks under `npm run eval -- <suite>`.
- **Hosted GUI:** distinguish keyless persistence/offline/multi-tab journeys from credential-dependent model turns and opt-in relay checks. Do not count skipped model turns as exercised coverage.
- **Storage:** retain real SQLite/backend conformance and reopen/recovery assertions; a manually seeded database does not prove that the application wrote the state.

For new or replacement tests, identify the expected user-visible result and a plausible defect before writing them. Demonstrate that the replacement fails for that defect, then passes after repair, following repository TDD. Avoid new production exports or flags solely to inspect private implementation.

## Cleanup and verification

An audit request produces findings first; perform deletions only within the requested cleanup scope. Change one coherent area at a time. Establish replacement proof before removing the old case. Keep existing user changes intact and avoid modifying source/tests while their test run is active.

Use `npx vitest run --project unit <paths>` for focused unit/integration validation. Use the package-script entry points for browser and relay suites. Consult current scripts rather than assuming every e2e suite runs through Vitest. Run `npm run gates` before handoff; sizable changes and PR updates also require `npm run gates:full` followed by `npm run review:pr`, per root instructions. Changes to product behavior require the relevant live browser or TUI verification.

Compare coverage using identical production scope before/after cleanup. Inspect lost branches rather than compensating with assertion-free execution. Once browser and process coverage are instrumented, retain separate per-suite reports and merge raw coverage mapped to the same source files; do not average percentages. Do not raise coverage by excluding difficult production files.

Report prioritized findings, retained exceptions, commands actually run, coverage limitations, and the next bounded batch. Separate proposed work from completed changes. Do not promise a deletion percentage before evidence supports it.
