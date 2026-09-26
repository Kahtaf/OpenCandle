# Test value and coverage audit — 2026-09-24

Baseline: `70475315` (`main` checkout at audit time). This audit adds documentation and a repo-local skill; it changes no production behavior or tests. Inventory and CI routing were inspected across the suite; detailed review sampled the candidates and retained examples below. This is not a claim that every assertion was manually reviewed.

## Assessment

There are concrete low-value tests worth removing or replacing, especially source-string checks in the GUI. There is not evidence that most unit tests are useless. The current `unit` project also contains valuable component, HTTP, database, and cross-process integration tests. Its baseline took 16.69 seconds locally, so the demonstrated problem is the quality and completeness of proof, not an established runtime bottleneck.

Prefer deterministic application journeys as the main proof of user behavior, with small unit suites covering numerical and adversarial branches. Establish coverage measurement before mass deletion. A high execution percentage cannot establish that an assertion detects a regression.

## Measured baseline

| Surface | Inventory / observed result | Routing |
| --- | --- | --- |
| Root unit project | 350 test files; 83,526 lines; 3,741 passed, 1 skipped | `npm test`; gates; PR CI on Node 24 |
| Relay | 2 files, 76 passed | `npm run relay:test`; gates; PR CI |
| Agent tools | 2 files, 28 passed | `npm run test:agent-tools`; gates; PR CI |
| Local GUI release smoke | 1 file, 8 passed; 21.64 seconds excluding build | `npm run test:gui:release-smoke`; full gates; PR CI |
| Broader local GUI browser suite | 28 direct `it` declarations; not run in this audit | Explicit `npm run test:gui:browser`; absent from full gates and PR CI |
| Hosted PWA | One standalone browser script, not a Vitest case count; not run in this audit | Full gates and PR CI |
| Live tools / agent / credentials | Standalone `tsx` scripts under `tests/e2e`; not run in this audit | Explicit package scripts; not PR gates |
| Live providers / model evals | Not run in this audit | Nightly providers; key-dependent, advisory model evals |

Counts use `tests/unit/**/*.test.ts`, not every helper file. Largest unit directories: GUI web 93, GUI server 45, tools 40, providers 24, runtime 19, hosted GUI 16. These are directory counts, not architectural classifications.

A discovery scan found 58 unit files using `vi.mock`, 32 reading files, and 2 using snapshot assertions. These are triage signals, not a junk-test count: reading persisted output is valuable and quite different from reading source code.

The skipped case is `KNOWN-FAIL E3: provider outage eval traces include an opencandle-turn-gap entry` in `tests/unit/evals/provider-outage-deterministic.test.ts:131`.

## Prioritized findings

### 1. Coverage is not currently measurable through the configured command

`vitest.config.ts` selects V8 coverage but includes only `src/**/*.ts`. `@vitest/coverage-v8` is absent from root development dependencies and from `npm ls`. Running:

```sh
npx vitest run --project unit --coverage --coverage.reporter=json-summary
```

fails immediately with `Cannot find dependency '@vitest/coverage-v8'`. CI does not enable coverage or publish a coverage report, and there are no configured thresholds. Therefore this audit cannot state a line or branch coverage percentage, nor quantify how much a deletion would lose.

**Recommended first batch:** add the matching coverage provider, include the actual production surfaces and extensions, publish line/function/branch results and uncovered files, then establish a baseline. Track per-surface results so a large well-covered core cannot hide a poorly-covered GUI. Choose thresholds from measured results and ratchet them; do not invent an initial target.

Browser and child-process execution requires separate instrumentation and source-map handling. The hosted WebContainer and relay need explicit collection paths. Merge covered source ranges against one consistent denominator; do not average suite percentages. Until that exists, label reports as unit/in-process coverage only.

### 2. Existing browser proof is split between mandatory smoke, optional integration, and live canaries

`tests/e2e/gui-release-smoke.test.ts` starts a real server and browser with a temporary home. Its eight cases cover health, first-run setup, dismissal/composer access, invalid model keys, diagnostics, and key-management navigation. It does not exercise a successful model/tool turn.

`tests/e2e/gui-browser.test.ts` includes useful streaming, session routing, HTTP fallback, transcript scrolling, and interaction cases. Many replace browser HTTP or WebSocket behavior, so they are browser integration tests, not proof of the entire server path. Other cases use a live agent and TUI parity. The suite needs an existing GUI server and is gated by `OPENCANDLE_GUI_BROWSER`; neither PR CI nor `gates:full` invokes it.

`gui/hosted/tests/hosted-pwa.e2e.mjs` does provide substantial mandatory keyless coverage: watchlist persistence, multiple tabs, offline state, archive restore, updates, and responsive behavior. Model turns depend on keys, and Yahoo relay proof requires `OPENCANDLE_PROVIDER_RELAY_E2E=1`. The PR workflow supplies neither that flag nor model secrets. The script also calls public Polymarket and CoinGecko endpoints unconditionally, making its mandatory run network-dependent.

**Recommended second batch:** separate deterministic browser integration from live-agent cases, give deterministic tests their own isolated server lifecycle, and enforce them in CI/full gates. Add one fixture-driven successful chat → tool → stream → persisted transcript journey through real internal transports. Keep actual provider/CORS and model drift checks in explicit live canaries. Do not simply enable the mixed 28-case suite in CI and assume it is deterministic.

### 3. GUI source-text checks often miss the behavior their names promise

These tests can fail after harmless formatting and still pass when the inspected code is unreachable. Replace them at the interaction or transport boundary, preserving the real regression they were intended to guard. The table distinguishes one high-confidence removal from replacements that still need proof.

| Candidate | What it actually detects | Recommendation / remaining proof |
| --- | --- | --- |
| `tests/unit/runtime/workflow-types.test.ts:88`, “assigns unique run IDs” | Different explicitly supplied IDs remain different; the factory never generates IDs | Remove this case. `runtime/workflow-runner.test.ts:71` exercises the same-named behavior through `runner.start`, which calls the actual generator. Retain factory initialization and transition tests. |
| `tests/unit/gui-web/session-drawer-focus.test.ts:6`, “enables the Sheet autofocus path when the mobile history drawer opens” | Exact multiline JSX contains `autoFocus` | Replace with opening the mobile drawer, asserting focus inside it, Escape dismissal, and focus return. Existing browser “shows chat history on mobile” asserts visibility only, so it is insufficient replacement proof today. |
| `tests/unit/gui-web/transcript-scroller.test.ts:37`, “floats the Latest control over the transcript as a pill with no reserved row” | Tailwind class tokens and setter text exist | Extend browser “restores deep-linked transcript anchors and offers jump to latest” with geometry/hit-testing and streaming while scrolled back; then remove the source-style assertions. Keep anchoring rules until that branch is exercised. |
| `tests/unit/gui-hosted/pwa-assets.test.ts:153`, “proves Yahoo quote and history through the relay in the hosted browser smoke” | Another test file mentions tool names and text waits | Remove the claim of executable proof. Replace with an enforced fixture relay journey, retaining a separately reported live relay canary. Existing opt-in smoke is not equivalent mandatory protection. |
| `tests/unit/gui-web/chat-panel-events.test.ts`, “preserves the fresh-home session target, one retry, and run-started adoption” | Specific ref/variable names, loop syntax, and source fragments remain | Replace with submit/retry/session-adoption interactions. Browser “routes a home prompt to the server-emitted run session” covers only part of the promise and is not gated today. Preserve the existing test until all claimed behavior has a stronger owner. |

Production owners/callers: `WorkflowRunner.start` calls `createWorkflowRun`; the session UI uses `SessionDrawer` → `Sheet`; `ChatPanel` owns transcript controls; hosted build/runtime and its browser smoke own relay delivery; `App.jsx` owns home submission and session adoption. None of these recommendations requires deleting production code. Audit private helper exports separately before claiming they are test-only.

Relevant history inspected: `95a49dc0` introduced runtime v2 and the workflow test (later formatted in `a8dc5a9b`); `7f4cff71` contains the drawer UX changes; `e1ee4f37` changed Latest to an overlay; `9be3dac4` added hosted relay authorization proof. These explain intended regressions, not permission to discard them. The home-routing candidate still needs case-specific history review before editing.

Focused commands for the first three candidates:

```sh
npx vitest run --project unit tests/unit/runtime/workflow-types.test.ts tests/unit/runtime/workflow-runner.test.ts
npx vitest run --project unit tests/unit/gui-web/session-drawer-focus.test.ts
npx vitest run --project unit tests/unit/gui-web/transcript-scroller.test.ts
```

For replacements, also run the new deterministic browser owner. Confirm the replacement fails when the target behavior is broken, then remove the superseded assertion. No candidates were deleted during this audit; rows requiring replacements are not deletion-ready.

### 4. Some “integration” tests manually perform the production operation

`tests/unit/e2e-integration.test.ts` manually inserts workflow rows, persists extracted preferences, and merges clarification entities. These tests can validate the participating helpers, but cannot prove the coordinator performed those steps. Disconnecting production persistence or clarification wiring may leave them green.

Use a real coordinator/session flow for multi-turn preference and clarification journeys; assert the second turn and reopened storage. Then consolidate duplicated helper happy paths. Keep storage contract and entity/slot edge cases that exercise distinct branches. Likewise, `tests/unit/harness/integration.test.ts` intentionally supplies synthetic events: it proves trace/IPC handling, not agent tool selection.

### 5. Some tool tests bypass the provider boundary despite the test convention

`tests/unit/tools/dcf.test.ts` replaces provider modules and reimplements `wrapProvider` success/error handling in a mock. It protects tool-level choices and calculations but cannot establish real wrapper normalization, transport parsing, or fallback composition. Several other tool suites also mock provider modules, contrary to `tests/AGENTS.md`'s fetch-boundary convention.

Retain focused DCF numerical cases. Migrate representative tool/provider composition cases to fixture HTTP responses through real wrappers, including failure/stale-data cases, before consolidating overlaps. `tests/unit/tools/stock-quote.test.ts` already demonstrates the preferred public tool plus fixture-fetch pattern.

## Valuable tests to retain

- `tests/unit/gui-server/coordinator-convergence-smoke.test.ts` runs real HTTP and a separate Pi session reader against persisted state. It uses a fake agent, so it is process/transport integration rather than full agent e2e. Its directory is no reason to delete it.
- `tests/unit/gui-web/first-run-setup-dialog.test.ts` mounts/remounts real components and checks persistence. The release smoke explicitly clears the onboarding-seen key on navigation; it does not replace remembered-dismissal coverage.
- `tests/unit/gui-server/private-api-access.test.ts` exercises address/cookie combinations and remote opt-in. Happy-path browser traffic cannot replace that security matrix.
- `tests/unit/website/shared-ui-boundary.test.ts` checks an architecture boundary; `gui-hosted/runtime-composition.test.ts` checks bundle-policy rejection. These are useful independent contracts despite resembling inventory checks.
- Numeric algorithms, invalid state transitions, provider normalization failures, and SQLite/backend conformance remain appropriate focused tests. Preserve rare branches instead of replaying every combination through a browser.

## Execution plan and acceptance criteria

1. **Measurement:** repair coverage tooling/scope and publish the first per-surface baseline. Keep instrumentation gaps explicit.
2. **Deterministic journeys:** enforce the existing useful browser integration cases separately from live tests; add the full chat/tool/persistence journey. Add retry, cancellation, ask-user session targeting, and writer/follower race cases at their owning boundaries.
3. **GUI cleanup:** migrate drawer focus, Latest geometry, and home-routing source checks into that gated suite. Demonstrate regression failures before removing superseded checks.
4. **Tool and coordinator cleanup:** replace mock-owned provider behavior and manually stitched persistence scenarios. Consolidate redundant happy paths while retaining unique branches.
5. **Repeat by area:** compare lost covered branches, assertion strength, runtime, and CI stability after each batch. No percentage reduction target; no bulk deletion based on filenames or mock counts.

New test authoring should use the repo-local [test-audit skill](../../.agents/skills/test-audit/SKILL.md) when assessing value or cleanup. Repository TDD and live-product verification still apply to implementation work.

## Validation actually performed

- `npm run gates`: passed (typechecks, lint, unit, relay, agent-tool suites).
- `npm run test:gui:release-smoke`: passed, all eight cases in a real Chromium browser against a spawned GUI server.
- Coverage command above: failed because the configured provider is missing; no percentages reported.
- Full hosted, site, package, live-model/provider suites, and autoreview were not run for this documentation-only audit. The passing gate results are not a claim that those suites passed.

Temporary logs: `/tmp/opencandle-test-audit-gates.log`, `/tmp/opencandle-test-audit-gui-smoke.log`, `/tmp/opencandle-test-audit-coverage.log`. No test deletion, dependency installation, CI change, commit, or PR was performed.
