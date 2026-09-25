# GUI test trust audit ledger — 2026-09-24

**Status:** worker evidence, **pending parent review** — not a completed human review.
**Mode:** read-only. No production code, test, config, or CHANGELOG change was made. The only file written is this ledger.
**Branch/worktree:** `test-trust/audit-gui` (`npm run bootstrap:agent` run first; completed clean).
**Owner:** `audit-gui: audit only; scope below`. Parent owns integration/review.
**Commit policy:** leave-uncommitted.

> **Historical snapshot.** Counts, line citations, and dispositions below describe the test tree on
> `test-trust/audit-gui` as of 2026-09-24, before the `test-trust/integration` branch moved most
> `tests/e2e/gui-browser.test.ts` journeys into `gui-integration.test.ts` and
> `gui-session-journey.test.ts`, removed source-slice cases (including the `transcript-scroller`
> slice), and added or deleted unit files. Only entries explicitly marked **Done** were updated
> afterwards. Check the current tree, and `test-inventory.md` for live counts, before acting on any
> remaining R/C/I disposition.

## 1. Scope and counts

Collected with `npx vitest list --staticParse=false` (runtime collection: modules are loaded and `it.each` families are expanded, but **test bodies are not executed**), with `OPENCANDLE_GUI_BROWSER=1` / `OPENCANDLE_GUI_RELEASE_SMOKE=1` set for the browser projects:

| Surface | Files | Collected cases |
| --- | ---: | ---: |
| `tests/unit/gui-web` | 94 | 774 |
| `tests/unit/gui-server` | 45 | 368 |
| `tests/unit/gui-shared` | 2 | 5 |
| `tests/unit/gui-hosted` | 16 | 238 |
| `tests/unit/market-state` | 7 | 63 |
| **unit total** | **164** | **1448** |
| `tests/e2e/gui-browser.test.ts` (`gui-browser` project) | 1 | 28 |
| `tests/e2e/gui-release-smoke.test.ts` (`gui-release` project) | 1 | 8 |
| `gui/hosted/tests/hosted-pwa.e2e.mjs` (`npm run test:gui:hosted`) | 1 script | stage-based, not Vitest cases |
| `tests/e2e` non-GUI scripts (`cli`, `providers`, `tools`, `harness-dcf`, `credential-*`) | 8 scripts | `test()` script calls, not Vitest cases |

Runtime collection expands every `it.each` family; the earlier static-parse figure of **1360 cases** (and the earlier "164 files" miscount) is superseded. The list of parameterized families is in Appendix A.

### Collection caveats
- With static parse on, `gui-browser` and `gui-release` collect to **zero** cases because both wrap the whole file in `describe.skipIf(!process.env.OPENCANDLE_GUI_BROWSER/…RELEASE_SMOKE)`. With the env var set and `--staticParse=false`, they collect **28** and **8** cases respectively.
- Runtime collection for `gui-server` reports **45** files (the earlier static run mis-counted the directory); all 45 contain cases.
- `hosted-pwa.e2e.mjs` is a plain Node script (no `it`/`expect`); it uses `assert()` and `process.exitCode`. It is one long journey, not N cases.
- The non-GUI `tests/e2e/*.test.ts` files are `tsx` scripts with a local `test()`/`assert()` harness; they are not part of `vitest --project unit`.

## 2. Baseline / CI enforcement facts

- `npm test` = `vitest run --project unit` → all 163 unit files above.
- `npm run gates` = `check` (typecheck + relay typecheck + biome) + unit + relay tests + `tests/agent-tools`. E2E/live suites are **not** in `gates`.
- `npm run gates:full` adds site, `test:gui:release-smoke` (builds web then runs `gui-release`), `test:gui:hosted` (`hosted-pwa.e2e.mjs`), and package-contents.
- `gui-browser` runs only via `OPENCANDLE_GUI_BROWSER=1 npm run test:gui:browser` against a live server at `OPENCANDLE_GUI_URL` (default `127.0.0.1:14567`).
- Non-GUI e2e suites run only via explicit `test:e2e*` scripts and hit live APIs/models.
- Per contract, **no tests were run** in this audit and **no live model/provider calls** were made. Prior gates baseline was established before this run and is not re-measured here.

## 3. Method and read coverage (honest disclosure)

Per file I recorded: case count, family/describe names, actual boundary, assertion style, mock targets, overlap, origin, disposition, and remaining gap.

**Read in full in this session** (line-level):
`gui-server`: `private-api-access`, `writer-lock`, `writer-lock-fd`, `writer-lock-stale-grace`, `model-auth-failure`, `preferences-round-trip`, `server-route-guards`, `projector`, `session-entry-wait`, `invoke-tool`, `chat-event-adapter`, `market-state-api`, `session-actions`, `preferences-transport`, `ws-hub`.
`gui-hosted`: `browser-data-store`, `browser-hosted-gui-runtime`, `browser-runtime-host`, `browser-runtime-coordinator`, `provider-relay-fetch`, `request-contract`, `runtime-composition`, `hosted-preferences`.
`market-state`: `alert-runner`, `alerts-reports`, `local-automation-service`, `notification-delivery`, `resolve`, `service`, `summaries`.
`gui-web`: `session-drawer-focus`, `search-icon-alignment`, `series-colors`, `motion-accessibility-contract`, `transcript-scroller`, `chat-rows-details`, `home-view-model`, `portfolio-card-render`, `stock-quote-card-render`, `tool-drawer-render`, `skeleton-primitive`, `runtime-transport-parity`, `runtime-transport`, `provider-builders`, `hosted-runtime-transport`.
`gui-shared`: `tool-output`, `catalog-metadata`.
`e2e`: `gui-release-smoke` (full), plus top-of-file/structure reads for `gui-browser`, `hosted-pwa.e2e.mjs`, `cli`, `tools`, `providers`, `harness-dcf`, `credential-*`.

**Full-audit closure (this run):** all in-scope GUI test files have now been read line-by-line — the 45 `gui-server`, 16 `gui-hosted`, 93 `gui-web`, 2 `gui-shared`, 7 `market-state` unit files, `tests/e2e/gui-browser.test.ts`, `tests/e2e/gui-release-smoke.test.ts`, and `gui/hosted/tests/hosted-pwa.e2e.mjs`. No in-scope file remains scan-only. Non-GUI `tests/e2e/*` scripts are out of scope (owned by another worker). Full-read dispositions and credible defects are recorded in §12.

No nested subagents, no credential reads, no secret values printed, no live calls.

## 4. Cross-cutting findings

### 4.1 Source-text / brittle-class assertions (discovery signals, not auto-delete)
| File:line | Actual protection | Problem | Disposition |
| --- | --- | --- | --- |
| `gui-web/session-drawer-focus.test.ts:12` | Sheet autofocus substring in `SessionHistory.jsx` | **Entire file is one source substring.** Renaming/formatting defeats it; it cannot fail for a real focus bug. | **Replace** with a jsdom interaction test (open drawer → focus lands in session search) or a `gui-browser` assertion. |
| `gui-web/series-colors.test.ts:6-13` | Locks the categorical palette literal | Tautological constant-vs-literal; no consumer boundary. | **Investigate / consolidate** into a chart-color consumer test. Low value alone. |
| `gui-web/motion-accessibility-contract.test.ts:19-76` | Overlay duration/direction, `transition-all` ban, reduced-motion CSS | All four cases read source text; no runtime motion evidence. | **Keep but brittle** (design contract); add a real reduced-motion render/browser assertion. |
| `gui-web/transcript-scroller.test.ts:37-54` | "Latest" pill floats and is pointer-scoped | Source slice of `ChatPanel.jsx`. The pure `pendingTranscriptAnchorId` cases at :7-35 are genuine. | **Keep pure cases; replace** source slice; `gui-browser.test.ts:695` already covers jump-to-latest in-browser. |
| `gui-web/chat-composer.test.ts:45-51,72-78` | Paste/attachment wiring and tailwind sizing | Source substring for wiring; render cases :33-43 are real. | **Consolidate**: keep render cases; the paste path is exercised by `gui-browser.test.ts:261`. |
| `gui-server/server-route-guards.test.ts` (39 collected cases, mostly source slices) | Route guard **ordering** (guard before handler) and mutation-does-not-resolve-active-session | Does not execute guards; structurally anchored to exact source strings. | **Keep (security)** — it locks a real ordering invariant the behavioral tests don't — and note that exercised guard-predicate behavior lives in `private-api-access.test.ts` plus the cookie-carrying round-trip tests (`preferences-round-trip`, etc.). |
| `gui-web/search-icon-alignment.test.ts:47-53` | Magnifier uses `top-1/2` not a fixed offset | Rendered-class regex; low behavioral depth. | **Keep (cheap)** / candidate consolidate into a primitives render test. |

### 4.2 Provider-internal / transport mocking (not automatically worthless)
| File | Mock | Assessment |
| --- | --- | --- |
| `market-state/resolve.test.ts:12-17` | `vi.mock` of `src/infra/http-client.js` and `src/providers/yahoo-finance.js` | **Acceptable**: exercises cache + rate-limiter via spies; still mocks the provider module itself, so it cannot detect a real `getQuote` shape drift. Note as residual risk. |
| `market-state/local-automation-service.test.ts:17` | `vi.mock` yahoo `getQuote` | Provider internals stubbed; runner/lease/scheduling logic is real and is the target. Acceptable, but no fetch-level fixture. |
| `gui-web/onboarding-carousel.test.ts` | renders `ModelSetupCard`/`ProviderKeyFlow` | **File name is misleading**: the exported `OnboardingCarousel.jsx` is never imported. See 4.5. |
| `gui-server/instrument-history-snapshot/route`, `market-state-api/parity`, `market-indices-api` | provider/global-fetch mocks | Boundary still real (route → snapshot store); acceptable. |
| `gui-server/*` fetch mocking | `globalThis.fetch` (per `tests/AGENTS.md`) | Correct convention. |

No `toMatchSnapshot`/`toMatchInlineSnapshot` anywhere in scope. Only two skips exist and both are intentional project gates (`gui-browser`, `gui-release`); `.only`/`.todo` occur nowhere.

### 4.3 Weak-assertion hotspots (counts of `toBeDefined/toBeTruthy/not.toThrow/toHaveBeenCalled()` without args)
| File | Count | Judgment |
| --- | ---: | --- |
| `gui-web/onboarding-carousel.test.ts` | 18 | Presence-only chain around mount flows; suites mix `toHaveBeenCalledWith` too. Not solely weak, but the presence checks don't pin behavior. |
| `gui-hosted/browser-hosted-gui-runtime.test.ts` | 17 | Predominantly one weak line among strong `toMatchObject` durability/idempotency assertions. Overall strong. |
| `gui-hosted/browser-runtime-host.test.ts` | 7 | Same pattern; lifecycle/idempotency assertions are strong. |
| `gui-web/settings-model-section.test.ts`, `model-setup-entry-points.test.ts` | 6, 5 | Presence + `not.toHaveBeenCalled`; model-setup write paths are covered in `gui-server/model-setup.test.ts`. |
| `gui-web/first-run-setup-dialog.test.ts` | 5 | Supplemented by `gui-release-smoke` browser assertions. |
| others | 1–5 | Isolated; no file is weak-only. |

### 4.4 Overlap clusters (consolidation candidates)
1. **Render/page suites** (`gui-web`): `home-dashboard-render`, `market-state-page-render` (53), `symbol-page-render` (43), `alerts-page-render`, `settings-*-section`, `settings-page-render`, `ui-primitives-render`, `chat-panel-events`, `history-card-render`, `price-comparison-card-render`, `sentiment-insight-render`, `stock-quote-card-render`, `portfolio-card-render`, `tool-drawer-render`, `allocation-donut`, `detail-rail-layout`, `list-header`, `market-chart-render`, `market-sparkline-render`. Many assert `html.toContain("<class/substring>")` on `renderToStaticMarkup`. Strong coverage, but **markup/class churn makes them high-maintenance and duplicated across parent/child card files**.
2. **Transport suites**: `gui-web/runtime-transport`, `gui-web/hosted-runtime-transport`, `gui-web/runtime-transport-parity`, `gui-server/preferences-transport`, `gui-server/preferences-api`, `gui-server/preferences-round-trip`. Different boundaries (URL shape vs SSE emulation vs real HTTP+SQLite) — probably keep, but `runtime-transport-parity` is the weakest link (4.5).
3. **Provider catalog**: `gui-web/provider-builders`, `gui-web/settings-providers-section`, `gui-shared/catalog-metadata`. Complementary; keep.
4. **Market-state API/parity**: `gui-server/market-state-api`, `gui-server/market-state-parity`, `market-state/*`. Keep.

### 4.5 Credibility defects / weak cases with exact citations
| Location | Issue | Credible defect it misses | Disposition |
| --- | --- | --- | --- |
| `gui-web/runtime-transport-parity.test.ts:20-40` | Single case: `expect(reduceChatEvents(hostedEvents)).toEqual(reduceChatEvents(localEvents))`; both transports are fed the **identical** fake SSE bytes (lines 6-16), and the test never asserts the reduced state is concrete/non-empty. | A change that makes *both* paths reduce to the same wrong/empty state passes. E.g. all events dropped by the reducer. | **Replaced 2026-09-24 (test-only follow-up):** the single case now asserts concrete per-transport `messages[0]` role/status/session, run terminal status, `lastSeq` and empty `gaps`, asserts each external boundary targets the requested URL-encoded session, and retains parity. Proof: mutating the shared reducer to empty makes it fail; production restored byte-identical. This is not live-backend coverage. |
| `gui-web/session-drawer-focus.test.ts:12` | Source substring only (see 4.1). | Drawer opens but focus never enters the search field. | Replace. |
| `gui-web/series-colors.test.ts:6` | Constant equals its own literal. | Palette drift is caught, but nothing about where colors are used. | Investigate. |
| `gui-web/onboarding-carousel.test.ts:1-16` | Tests `ModelSetupCard`/`ProviderKeyFlow`; **`OnboardingCarousel.jsx` has no direct test**. | Carousel step sequencing / provider selection / dismissal wiring could break untested. | **Investigate**; add direct carousel assertions or rename file. |
| `e2e/credential-prompt.test.ts:20-31` docstring vs `:65-67` code | Docstring still says "exits 0 with a skip notice"; code now `process.exit(1)` when no LLM credential (fail-closed, changed in `3f5462f2`). | A reader could believe a missing credential yields green; it does not. Documentation defect, not a test-runtime defect. | **Fix comment** (out of this read-only scope). |
| `market-state/notification-delivery.test.ts:288-328` | Rotation/bounds tested; no case for a **success on retry after a prior failure**. | Retry-success bookkeeping (attempt count vs notification state) is not asserted. | **Investigate / add**. |
| `gui-hosted/browser-data-store.test.ts:160-179` | "attachment-sized … above the old 1 MiB ceiling" only covers ~2 MiB text; no upper rejection limit asserted. | Unbounded archive growth is not tested at this layer. | **Investigate** (bounds tested elsewhere in `browser-hosted-gui-runtime` bootstrap budget). |

### 4.6 Critical missing journeys / modules with no direct test (textual-reference scan; not a coverage %)
Verified by grepping the audited test tree for the module basename/path (transitive rendering may still cover some):
- `gui/web/src/features/onboarding/OnboardingCarousel.jsx`, `onboarding-steps.jsx`.
- `gui/web/src/features/catalog/field-renderer.jsx`, `form-presets.js`, `workflow-schemas.js`, `form-primitives.jsx`.
- `gui/web/src/features/chat/attach-menu.jsx`, `cashtag-autocomplete.jsx`, `run-sources.js`, `use-symbol-resolution.js`.
- `gui/web/src/features/instruments/instrument-api.js`, `use-instrument-search.js`.
- `gui/web/src/features/market-state/report-format.js`, `report-rich-text.jsx`.
- `gui/web/src/features/settings/settings-rows.jsx`, `sections/provider-row-info.js`, `provider-builders/provider-status.jsx`.
- `gui/web/src/lib/instrument-display.js`, `runtime/app-status-slot-context.js`.
- `gui/shared/tool-argument-validation.ts`, `market-quote-snapshot.ts`.
- `gui/hosted/runtime/*-browser.ts` shims (pi-ai, pi-coding-agent, undici, safer-buffer, sqljs-webcontainer, etc.) — exercised only by the full hosted browser journey.
- `src/market-state/resolve-for-mutation.ts`.
- `gui/server/websocket.ts` has no dedicated unit file (hub behavior is covered by `ws-hub.test.ts`).
- No committed opt-in/live journey was found for hosted **tool-invoke UI** end-to-end at the HTTP/WebSocket boundary; it is covered at the runtime unit tier (`browser-hosted-gui-runtime` "validates direct tool arguments…", "gives Pi chat the same stateful tool contracts…") and by `hosted-pwa.e2e.mjs` state flows.

No `.skip`/`.todo` masks a missing journey; the absence is coverage, not suppression.

## 5. Per-file inventory and disposition

Legend — **Read**: `full` (line-level this run) or `scan` (case-index + targeted grep). **All in-scope GUI files are now `full`; no `scan` label remains in-scope.**
**Disp**: K=keep, C=consolidate, R=replace, I=investigate.

### 5.1 `tests/unit/gui-server` (45 files, 368 cases)
| File | Cases | Family | Boundary | Disp | Gap / note |
| --- | ---: | --- | --- | --- | --- |
| `ask-user-bridge` | 4 | GUI ask_user bridge | in-memory prompts | K | — |
| `automation-heartbeat` | 4 | heartbeat policy | scheduling | K | — |
| `background-quotes` | 4 | BackgroundQuoteRefreshes | refresh lifecycle | K | — |
| `chat-event-adapter` | 22 | sessionEntriesToChatEvents; custom details | real adapter | K | full-read; strong contract suite |
| `chat-run-body` | 20 | body parsing; disposeAfterSettled | parser + lifecycle | K | — |
| `coordinator-convergence-smoke` | 1 | GUI/TUI convergence smoke | end-to-end-ish | K | 1 case, high leverage |
| `event-reducer` | 10 | reducer; custom details | pure reducer | K | — |
| `gui-session-manager` | 1 | createInitialGuiSessionManager | factory | K | — |
| `history-snapshot-store` | 4 | HistorySnapshotStore | persistence | K | — |
| `instrument-history-provider-parity` | 3 | provider parity | provider boundary | K | mocked provider |
| `instrument-history-route` | 5 | history HTTP route | route store | K | — |
| `instrument-history-snapshot` | 17 | resolveHistoryRange (2 each); snapshot | pure + store | K | — |
| `instrument-overview-route` | 3 | overview HTTP route | route | K | 4 weak asserts |
| `invoke-tool` | 15 | invokeToolFromUi | tool invocation | K | full-read; proxy/dedupe/lock-recovery |
| `live-chat-event-adapter` | 6 | live adapter | streaming | K | — |
| `local-session-coordinator-recovery` | 1 | owner-recovery retry pinning | recovery | K | 1 case |
| `local-session-coordinator` | 9 | coordinator | admission | K (brittle source slices at :52-54) | — |
| `market-indices-api` | 2 | snapshot | — | K | — |
| `market-indices-route` | 5 | route | — | K | — |
| `market-indices-snapshot-store` | 5 | store | persistence | K | — |
| `market-state-api` | 18 | API helpers | API | K | full-read; FX/stale-total boundaries |
| `market-state-parity` | 4 | GUI/TUI parity | cross-surface | K | — |
| `model-auth-failure` | 2 | auth failure classification | pure | K | narrow but real |
| `model-setup` | 13 | GUI model setup | setup | K | — |
| `preferences-api` | 5 | preferences API | API | K | — |
| `preferences-round-trip` | 2 | real SQLite + WS + HTTP | **full stack** | K | excellent; real store→prompt context |
| `preferences-transport` | 10 | WS + HTTP fallback | transport | K | — |
| `private-api-access` | 8 | cookie/loopback/remote opt-in | **pure security** | K | strongest executed guard behavior |
| `projector` | 15 | projectDashboard | pure projection | K | excellent; 110-symbol cap, gap dedupe |
| `prompt-observation` | 3 | replay selection | pure | K | — |
| `quote-snapshot-store` | 8 | snapshot + store | persistence | K | — |
| `server-route-guards` | 52 | route guard ordering | source-contract | K (C/R for slices) | not executed; keep for security ordering |
| `session-actions` | 12 | GUI session actions | actions | K | 4 weak |
| `session-bootstrap` | 8 | session-addressed bootstrap | bootstrap | K | — |
| `session-entry-wait` | 21 | wait/settle/stall/grace/unresolved | **pure async time** | K | excellent; fake timers |
| `session-list` | 1 | listDisplaySessions | pure | K | — |
| `session-resume` | 3 | GUI/TUI resume | resume | K | — |
| `shutdown` | 2 | graceful shutdown | process | K | — |
| `ticker-line-sparkline` | 7 | sparkline proxy | provider | K | — |
| `tool-invoke-ack` | 2 | ack message | pure | K | — |
| `tool-metadata` | 5 | catalog | catalog | K | — |
| `writer-lock-fd` | 1 | fd lifecycle | OS | K | 1 case, targeted |
| `writer-lock-stale-grace` | 1 | stale-grace | OS/time | K | 1 case, fake timers |
| `writer-lock` | 15 | scope/migrate/recover/refresh | **OS persistence** | K | excellent |
| `ws-hub` | 9 | GUI WS hub | hub | K | — |

### 5.2 `tests/unit/gui-hosted` (16 files, 238 cases)
| File | Cases | Family | Boundary | Disp | Gap / note |
| --- | ---: | --- | --- | --- | --- |
| `browser-data-store` | 27 | archive validate/import/backup/recovery | **persistence** | K | excellent; real sql.js for schema cases |
| `browser-hosted-gui-runtime` | 46 | action safety, idempotency, durability, Pi reuse, tools, ask_user, budget | **hosted runtime** | K (full) | full-read; broadest suite; white-box `(runtime as any)` but contract-focused |
| `browser-hosted-session-creation` | 1 | session creation | — | K | 1 case |
| `browser-model-runtime` | 1 | browser Pi model runtime | — | K | 1 case |
| `browser-pi-session` | 8 | model history; terminal outcomes | Pi session | K | real file I/O |
| `browser-runtime-coordinator` | 26 | writer election, credentials, forwarding, timeouts | **coordination** | K (full) | full-read; strong credential separation; simulated BroadcastChannel/LockManager |
| `browser-runtime-host` | 38 | boot, import/update, streams, secrets, relay, bootstrap | **host lifecycle** | K (full) | full-read; strong lifecycle/idempotency |
| `hosted-data-actions` | 7 | hosted data actions | — | K | — |
| `hosted-market-data-api` | 12 | market data API | mirrored server API | K | mocked provider |
| `hosted-preferences` | 7 | request + runtime + commands | real sql.js | K | real checkpoint round-trip |
| `hosted-stateful-tool-composition` | 4 | stateful tools | tools | K | — |
| `hosted-status-pill` | 13 | pill render | UI | K | render |
| `provider-relay-fetch` | 24 | relay auth, manifest, model routing, bounds | **security/bounds** | K | excellent; fail-closed + byte/time bounds |
| `pwa-assets` | 15 | headers/CSP/SW/manifest | config contract | K | source-text by design; cheap and valuable |
| `request-contract` | 7 | parseGuiRequest | **validation** | K | — |
| `runtime-composition` | 2 | bundle provider allowlist | build contract | K | — |

### 5.3 `tests/unit/gui-web` (94 files, 774 cases)
| File | Cases | Family | Disp | Gap / note |
| --- | ---: | --- | --- | --- |
| `alert-activity` | 9 | activity rows, sentences, distance | K | — |
| `alert-sentences` | 10 | sentence rows, observed value | K | — |
| `alert-view-model` | 3 | view model | K | — |
| `alerts-page-render` | 15 | rule rows/disclosure/sheet | K/C | render overlap |
| `allocation-donut` | 2 | donut | K | render |
| `app-page-dispatch` | 7 | AppShell dispatch | K | — |
| `app-status-slot` | 5 | status slot | K | — |
| `asset-descriptor` | 16 | resolve asset type/descriptor | K | pure |
| `attachments` | 7 | chat attachments | K | — |
| `carousel-primitive` | 8 | carousel/radio | K | render |
| `cashtag-autocomplete` | 5 | helpers | K | — |
| `catalog-overlay` | 4 | overlay helpers | K | — |
| `chat-composer` | 4 | composer + source slices | K/C | replace source slices |
| `chat-error-retry` | 1 | failed tool retry | K | render |
| `chat-panel-events` | 20 | transcript render | K | 81 expects; overlap |
| `chat-rows-details` | 1 | custom message details | K | tiny but real |
| `detail-rail-layout` | 3 | layout | K | render |
| `diagnostics-page-render` | 4 | diagnostics content | K | render |
| `entity-popover-placement` | 2 | placement | K | — |
| `entity-popover` | 8 | popover | K | render |
| `exchange-labels` | 3 | labels | K | — |
| `financial-format` | 6 | formatting | K | pure |
| `first-run-setup-dialog` | 14 | first-run dialog | K | 5 weak; browser covered |
| `history-card-render` | 6 | HistoryCard | K | render |
| `home-dashboard-render` | 17 | home widgets | K/C | 122 expects; consolidation candidate |
| `home-suggestions` | 4 | prompts | K | — |
| `home-view-model` | 1 | mover ordering | K | good pure case |
| `hosted-runtime-transport` | 18 | hosted transport SSE/commands | K | strong |
| `instrument-search` | 9 | search helpers | K | — |
| `list-header` | 6 | ListHeader | K | render |
| `market-chart-autoscale` | 6 | autoscale | K | pure |
| `market-chart-behavior` | 21 | chart behavior | K | render |
| `market-chart-render` | 8 | static shell | K | render |
| `market-sparkline-error` | 10 | sparkline error | K | render |
| `market-sparkline-render` | 13 | sparkline | K | render |
| `market-state-format` | 10 | formatting | K | pure |
| `market-state-page-render` | 53 | page render | K/C | largest; 319 expects; consolidation |
| `mobile-navigation` | 2 | mobile nav | K | — |
| `model-recovery` | 7 | model recovery | K | — |
| `model-setup-entry-points` | 6 | entry points | K | 5 weak |
| `motion-accessibility-contract` | 4 | motion/a11y source | K (brittle) | add runtime |
| `onboarding-carousel` | 30 | ModelSetupCard/ProviderKeyFlow | I | carousel itself untested |
| `optimistic-user-message` | 6 | optimistic rows | K | — |
| `popover` | 3 | popover | K | render |
| `portfolio-card-render` | 1 | correlation card | K | tiny |
| `portfolio-view-model` | 14 | view model | K | — |
| `preferences-transport` | 4 | transport | K | — |
| `price-comparison-card-render` | 9 | card | K | render |
| `provider-builders` | 11 | builders + status | K | real interactions |
| `provider-deep-links` | 4 | deep links | K | — |
| `report-schedule-form` | 8 | schedule form | K | render |
| `rich-text-render` | 9 | rich text | K | — |
| `route-session-state` | 16 | route/session state | K | — |
| `runtime-transport` | 6 | loopback transport | K | good |
| `runtime-transport-parity` | 1 | parity | K | strengthened 2026-09-24: concrete state + session targeting, mutation-proved (was vacuous equality per 4.5) |
| `hosted-transport-session-isolation` | 1 | hosted transport stale-session guard | K | added 2026-09-24: covers `hosted-runtime-transport.js` branch 78 (`publishBootstrap` must not publish a snapshot for a no-longer-selected session); mutation-proved |
| `schema-form` | 12 | schema form | K | — |
| `search-icon-alignment` | 2 | icon alignment | K/C | class regex |
| `sentiment-insight-render` | 2 | insight | K | render |
| `series-colors` | 1 | palette | I | tautological |
| `session-drawer-focus` | 1 | focus source | **R (done 2026-09-24)** | source-only; file removed, replaced by `tests/e2e/gui-integration.test.ts` focus-in and focus-return cases |
| `session-market-facts` | 3 | market facts | K | — |
| `session-search` | 2 | search | K | — |
| `settings-automation-section` | 7 | settings | K | render |
| `settings-data-section` | 8 | settings | K | render |
| `settings-diagnostics-section` | 6 | settings | K | render |
| `settings-model-section` | 9 | settings | K | 6 weak |
| `settings-page-render` | 7 | settings page | K/C | overlaps sections |
| `settings-preferences-section` | 11 | settings | K | render |
| `settings-providers-section` | 7 | settings | K | render |
| `settings-route-resolution` | 21 | route resolve | K | — |
| `settings-tool-invoker` | 3 | tool invoker | K | — |
| `sidebar-nav-render` | 11 | sidebar | K | render |
| `skeleton-primitive` | 1 | skeleton | K | tiny |
| `stock-quote-card-render` | 1 | quote card | K | tiny |
| `symbol-page-render` | 44 | symbol page | K/C | 208 expects; consolidation |
| `symbol-route-resolution` | 16 | route resolve | K | — |
| `symbol-view-model` | 30 | view model | K | pure |
| `thinking-text` | 3 | thinking | K | — |
| `tool-drawer-render` | 1 | drawer | K | tiny |
| `tool-run-grouper` | 2 | grouper | K | — |
| `transcript-scroller` | 3 | anchor + source | K/R | replace source slice |
| `typed-confirm-dialog` | 5 | confirm dialog | K | render |
| `ui-primitives-render` | 10 | primitives | K/C | render |
| `use-chat-run-terminal-state` | 1 | terminal state | K | — |
| `use-chat-run` | 11 | chat run hook | K | — |
| `use-gui-connection` | 19 | connection hook | K | — |
| `use-instrument-history` | 6 | history hook | K | — |
| `use-market-indices` | 3 | indices hook | K | — |
| `use-market-state` | 12 | market-state hook | K | — |
| `use-symbol-endpoint` | 2 | symbol endpoint | K | — |
| `use-symbol-view-model` | 4 | symbol VM hook | K | — |
| `use-waiting-service-worker` | 3 | SW hook | K | — |
| `watchlist-options` | 3 | options | K | — |

### 5.4 `tests/unit/gui-shared` (2 files, 5 cases)
| File | Cases | Family | Disp | Note |
| --- | ---: | --- | --- | --- |
| `catalog-metadata` | 1 | provider catalog masking | K | asserts secret not serialized |
| `tool-output` | 4 (1 each) | needs-input statuses | K | `it.each` family |

### 5.5 `tests/unit/market-state` (7 files, 63 cases)
| File | Cases | Family | Boundary | Disp | Note |
| --- | ---: | --- | --- | --- | --- |
| `alert-runner` | 17 | provider routing, circuit breaker, delayed quotes, lifecycle, RSI/percent/SMA, dedupe | **real runner + SQLite** | K | excellent; provider fns injected (not fetch) |
| `alerts-reports` | 7 | condition shapes, dedupe, leases, stale runs | real SQLite | K | — |
| `local-automation-service` | 9 | lease, alerts, reports, overlap | real SQLite | K | provider module mocked |
| `notification-delivery` | 10 | webhook allow/deny, bounds, rotation, timeout | real SQLite + fetchImpl | K | add retry-success case |
| `resolve` | 6 (1 each) | autocomplete/cache/exact symbol | provider module mocked | K | residual provider-shape risk |
| `service` | 13 | watchlists/portfolios/validation/aliases | real SQLite | K | excellent |
| `summaries` | 1 | prompt-attachment formatting | real SQLite | K | — |

### 5.6 `tests/e2e` and `gui/hosted/tests`
| File | Cases | Boundary | Disp | Note |
| --- | ---: | --- | --- | --- |
| `gui-browser.test.ts` | 28 | **live GUI server + Playwright + TUI harness**; onboarding cases install a mock boot WebSocket, chat/tool-card journeys use the configured server model | K | strong journeys (streaming, multi-client, proxy fallback, TUI parity). Gated by env; not in `gates`; needs a running server + model credential. |
| `gui-release-smoke.test.ts` | 8 | cold-home server spawn + real browser, keyless | K | excellent; blanked-env derivation; composer click-through |
| `gui/hosted/tests/hosted-pwa.e2e.mjs` | stages | WebContainer hosted PWA, optional credentials | K | keyless direct-provider + state stages always run; model stages `if (apiKey)` |
| `cli.test.ts` | script | live LLM agent loop | I | live-only; not gated |
| `tools.test.ts` | script | live provider + live LLM tool runs | I | live-only |
| `providers.test.ts` | script | live provider matrix | I | live-only |
| `harness-dcf.test.ts` | script | live LLM + Alpha Vantage via TUI harness | I | fail-closed on missing keys (exit 1) |
| `credential-{prompt,snooze,soft-fallback,per-workflow-cap}.test.ts` | script | live LLM credential interception flows | I | fail-closed exit 1; `credential-prompt` docstring stale (4.5) |

## 6. Disposition summary

- **Keep (K):** ~150 files. The overwhelming majority are behavior-first and boundary-appropriate (real SQLite, real HTTP/WS, pure deterministic logic, real file locks, focused provider-relay security). Mocks are concentrated and mostly justified.
- **Consolidate (C):** render/page suites listed in 4.4; transport/catalog clusters are complementary and should not be merged.
- **Replace (R):** ~~`gui-web/session-drawer-focus.test.ts` (source-only)~~ **Done 2026-09-24**: file removed and replaced by `tests/e2e/gui-integration.test.ts` browser cases for focus entering the mobile drawer and returning to its opener after Escape (the focus-return bug was fixed in `SessionDrawer`). Still R: the source-slice portions of `transcript-scroller` / `chat-composer`. `gui-web/runtime-transport-parity.test.ts` is no longer R: strengthened in place 2026-09-24 (test-only) with concrete per-transport state and session-targeting assertions, mutation-proved to fail on an empty reducer.
- **Investigate (I):** `gui-web/onboarding-carousel.test.ts` (misnamed; carousel untested), `gui-web/series-colors.test.ts` (tautology), `market-state/notification-delivery.test.ts` (retry-success), `browser-data-store` size ceiling; live e2e scripts (credential gating/docstring).

No file is recommended for outright deletion: every file either asserts a real contract or is cheap insurance. The replacements above are **proposed**, not performed (read-only audit).

## 7. Pending / replacement gaps

1. ~~`gui-web/session-drawer-focus.test.ts` → jsdom focus test (open drawer → search field focused).~~ **Done 2026-09-24** as real browser cases in `tests/e2e/gui-integration.test.ts` (focus enters the drawer; Escape returns focus to the opener).
2. ~~`gui-web/runtime-transport-parity.test.ts` → assert concrete reduced state, not just local==hosted.~~ **Done 2026-09-24** (test-only; mutation-proved).
3. `OnboardingCarousel.jsx` → direct step/provider/dismiss assertions (or rename the current file to `model-setup-card.test.ts`).
4. `notification-delivery` → success-after-failure retry case.
5. `gui-browser` → add a reduced-motion assertion (currently only source CSS in `motion-accessibility-contract`).
6. `gui/hosted/runtime/*-browser.ts` shims → no isolated test; only the full hosted journey exercises them. Acceptable only while `test:gui:hosted` runs in `gates:full`.
7. `credential-prompt.test.ts` docstring → update to match fail-closed exit 1.
8. Render-suite churn → consider extracting semantic assertions (roles/text) from raw class-substring `toContain` where cheap.

## 8. Unreviewed families (explicit)

Within the assigned GUI scope: **none**. Every in-scope GUI test file was read line-by-line (see §3, §12). The only unexecuted suites are the credential-gated live paths (`gui-browser` chat/parity runs, `hosted-pwa` model stages, non-GUI e2e), which were not run because this audit is read-only and forbids live calls.

## 9. Provenance (git)

Recent commits touching the scope include `9226eb7a` (deferred run ownership), `66ce0d38` (workflow detection scoped to current prompt), `26bd30a8`/`d67d245c`/`3e662bc4`/`ec1f545b` (gui-browser), `7a44aa00`/`5f7f2a21` (chat-run settle), `160ba17a`/`f8b67df3` (coordination/scoping), `3f5462f2` (credential e2e reads `.env`), `6ed877a9` (release-smoke/DCF stop reading developer keys), `6495ab1b` ("audit D4 test bar").
First-addition dates sampled: `gui-browser.test.ts` 2026-05-10 `62c3eb78`; `server-route-guards.test.ts` 2026-06-13 `0993c200`; `gui-release-smoke.test.ts` 2026-07-03 `39cf4622`; `session-drawer-focus.test.ts` 2026-07-10 `7f4cff71`; `runtime-transport-parity.test.ts`, `browser-data-store.test.ts`, `hosted-pwa.e2e.mjs` 2026-07-31 `9232a1b2`; `onboarding-carousel.test.ts` 2026-08-04 `a0573f9b`. Origin intent for individual cases beyond these messages is **unknown** and is marked as such rather than guessed.

## 10. Proof commands actually run

- `npm run bootstrap:agent` → ready, branch `test-trust/audit-gui`.
- `npx vitest list --project unit --staticParse=false <scoped dirs>` → **1447 cases / 163 files** (runtime-expanded, bodies not executed).
- `npx vitest list --project unit <scoped dirs>` (static, default) → 1360 cases; retained only to show which families expanded.
- `OPENCANDLE_GUI_BROWSER=1 npx vitest list --project gui-browser --staticParse=false` → 28 cases.
- `OPENCANDLE_GUI_RELEASE_SMOKE=1 npx vitest list --project gui-release --staticParse=false` → 8 cases.
- Greps: `readFileSync|readFile|import.meta.url`; `toMatchSnapshot|toMatchInlineSnapshot`; `.skip|.only|.todo`; `vi.mock(...)` targets; weak-assertion counts; per-file `describe/it` case index.
- `git log --oneline` / `git log --diff-filter=A` over the scope.
- During the read-only audit phase: no `npm test`/`npm run gates`, no test edit, no live eval run, no credentials read.

**2026-09-24 strengthening follow-up (test-only; `strengthen GUI transport parity expectation`):**
- `npx vitest run --project unit tests/unit/gui-web/runtime-transport-parity.test.ts` → **pass**.
- Mutation proof: temporarily changed shared `reduceChatEvents` to return `createChatRenderState()` → the strengthened test **failed** (`state.messages` length 1→0); restored `gui/shared/event-reducer.ts` with `git checkout` and confirmed sha256 `efa4a7f79eb6cd744f67697072de38584fcb50877dc1a2433ceba263f411ce4a` unchanged; re-ran → **pass**.
- `npx vitest run --project unit tests/unit/gui-web/runtime-transport-parity.test.ts tests/unit/gui-hosted/browser-model-runtime.test.ts` → 2 files / 2 tests **pass**.
- No `npm run gates` (parent integrated gate, per follow-up task). No live backend/provider call; no credentials read. This is not live-backend coverage.

**2026-09-24 session-isolation follow-up (test-only; `hosted-transport-session-isolation`):**
- New file `tests/unit/gui-web/hosted-transport-session-isolation.test.ts` (1 case) added for the third lost branch, `hosted-runtime-transport.js:78` stale-session snapshot suppression. The first two lost branches (writer default at :35, `sessions || []` fallback at :76) are incidental and were left uncovered per instruction.
- `npx vitest list --project unit --staticParse=false tests/unit/gui-web/hosted-transport-session-isolation.test.ts` → 1 case.
- `npx vitest run --project unit tests/unit/gui-web/hosted-transport-session-isolation.test.ts` → **pass**.
- Mutation proof: changed only `if (!selectedSessionId || bootstrap.sessionId === selectedSessionId)` to `if (true)` → test **failed** on the leaked `state.snapshot` for `session-a`; restored `gui/web/src/runtime/hosted-runtime-transport.js` with `git checkout` and confirmed sha256 `4a0a557805f15f9534a66e20aae2fb2509b91c0c1b2e8bf30bad27e82745b8c3` unchanged; re-ran → **pass**.
- Review corrections applied 2026-09-24: typed `TransportMessage` shape (no `any`); synchronize on a strictly-additional `preferences_list` request count (not `toHaveBeenCalledWith`, which an earlier call could satisfy); close the event channel and dispose the transport in `finally`. Post-correction runs: focused test **pass**, guard-removal mutation **fail**, production restored byte-identical, `npx tsc --noEmit` **pass**.
- Reachability: the race is reached entirely through public transport API (`openEventChannel`/`send` refresh + `loadSession` + `invokeTool`) with valid host responses; no malformed payload was manufactured. No production bug found; no production fix made.

## 11. Deviations and truth notes

- **No CHANGELOG entry** was added despite the standing clause, because the run's Owned-task constraint is explicit: *"Do not modify code/tests/config/changelog."* The read-only constraint wins for the audit phase; the two test-only follow-ups likewise add no CHANGELOG entry per task ("no changelog required").
- **No gates run**: the read-only audit phase had none by its Owned task, and the 2026-09-24 test-only follow-up ran focused unit suites only ("no fullgatesneeded parentintegratedgate").
- "Read complete tests" is satisfied line-by-line for all in-scope GUI files (§3, §12). Non-GUI e2e scripts remain out of scope.
- This ledger is **worker evidence pending parent review**; it is not a completed human review and makes no deletion claims.

## Appendix A — parameterized families and gated case names

The 21 `it.each` families collected but printed unexpanded (each is one family row in §5):

| File | Family | Case title(s) |
| --- | --- | --- |
| `gui-hosted/browser-data-store` | hosted browser archive | rejects invalid pending action timestamps: `%s` |
| `gui-hosted/provider-relay-fetch` | hosted provider relay fetch | leaves browser-compatible providers direct: `%s`; streams `%s` model traffic through the raw relay |
| `gui-shared/tool-output` | tool outcome helpers | treats `%s` as requiring more user input |
| `gui-web/app-page-dispatch` | AppShell page dispatch | renders `%s` with the `%s` section active |
| `gui-web/instrument-search` | instrument search UI helpers | preserves provider order for the FX-looking query `%s` |
| `gui-web/market-chart-autoscale` | market chart price autoscale | pads `%s` close values without introducing a zero floor |
| `gui-web/market-chart-behavior` | MarketChart chart behavior | renders/omits direct line-end labels for `%i` indexed series |
| `gui-web/market-sparkline-render` | MarketSparkline provenance | translates `%s` into a supported Ticker Line instrument |
| `gui-web/settings-route-resolution` | settingsSectionFromPath | resolves `%s` to the `%s` section; does not read `%s` as a settings path |
| `gui-web/sidebar-nav-render` | sidebar navigation groups | marks/leaves Settings (in)active on `%s` |
| `gui-web/symbol-page-render` | symbol page | renders a signed, icon-labeled `%s` hero change |
| `gui-web/symbol-route-resolution` | tickerFromPath | resolves `%s` to `%s`; round-trips `%s`; does not resolve `%s` |
| `gui-server/instrument-history-snapshot` | resolveHistoryRange | maps `%s` to Yahoo range `%s` and interval `%s`; rejects unknown case-sensitive range `%s` |
| `market-state/resolve` | searchYahooInstruments | infers `%s` as `%s` when resolving an exact Yahoo symbol |

Gated case names read from source (not collected because of `describe.skipIf`):

`tests/e2e/gui-browser.test.ts` (28): loads the app with session history and financial context; renders a stock quote prompt and updates context; renders options, filings, macro, and news tool cards; shows chat history on mobile; captures desktop and mobile screenshots; renders missing API-key onboarding in a browser; lets users manage model keys from the composer selector; explains unavailable onboarding while setup access reconnects; keeps the composer focused on send and supports keyboard catalog controls; sends portfolio attachments through the shared chat request; autocompletes cashtags and opens entity chip popovers; reconnects stale GUI sockets when the browser returns to the foreground; collapses and restores the desktop sidebar; uses the sidebar app shell as market-state navigation; keeps reconnecting market-state pages readable and disables mutations; keeps restored mobile tool timelines collapsed and manually openable; closes an open tool drawer when navigating to another session; restores deep-linked transcript anchors and offers jump to latest; shows configured providers with a masked hint and a replace-only key input; opens session context menu and sends rename/delete actions; streams assistant text incrementally and keeps specialized tool cards; shows the submitted user message before delayed server run events; routes a home prompt to the server-emitted run session; falls back to HTTP chat runs when WebSocket is unavailable; disables empty-state suggestions while home waits for a fresh session; keeps two browser clients on one coordinated session without role wording; drives two routed sessions concurrently and stops only the targeted session; keeps opencandle trace and dashboard projection in parity with the TUI path.

`tests/e2e/gui-release-smoke.test.ts` (8): boots the GUI server and exposes health without credentials; renders the home route and first-run model setup in a real browser; dismisses first-run setup with Escape and frees the composer; dismisses first-run setup from its close control; rejects an invalid OpenAI key inline without connecting a model; rejects a Google API_KEY_INVALID response from the local probe stub; reports a blocked cold home while optional providers are ready; opens model-key management from the disconnected composer.

## 12. Full-read closure (all in-scope GUI files)

Every in-scope file below was read line-by-line in this run. Counts are runtime-expanded (`--staticParse=false`). "Credible defect" is the concrete regression the case(s) would catch today; "gap" is what is still unproven. Dispositions: K keep, C consolidate, R replace, I investigate. No file is proposed for deletion; server/security artifact-ordering tests are retained pending a proved behavioral replacement (per parent instruction).

### 12.1 `tests/unit/gui-server` (45 files, 368 cases)
| File | Families / cases | Boundary | Credible defect / gap | Disp |
| --- | --- | --- | --- | --- |
| `ask-user-bridge` | broadcast/answer, cancel, per-prompt session, route-addressed (4) | pure bridge | Detectable: prompt resolved with wrong session/status; broadcast payload drift. Gap: re-answer/double-cancel returns false path not asserted. | K |
| `automation-heartbeat` | normalize bounds, overlap skip, interval start/stop, error close (4) | scheduler | Detectable: too-small/invalid interval accepted; overlapping runs; DB handle leak. | K |
| `background-quotes` | synthetic entries, latest-per-symbol, poller start/stop, overlap guard (4) | poller | Detectable: persisted-entry mutation, duplicate refresh, poller started with 0 clients. | K |
| `chat-event-adapter` | failure cards, dedupe, pairing, workflow steps, slash/attachments, orphan tools, interrupts, large details (22) | real adapter + reducer | Detectable: dropped/failed assistant, duplicated cards, lost workflow steps, truncated large details. | K |
| `chat-run-body` | marker rules, attachment bounds/dedupe, slash rejection, `it.each` invalid bodies (20) | parser + real SQLite | Detectable: spoofed attachment ids, >8 saved items, 5 MB/4-image/base64 bounds, slash+attachment. | K |
| `coordinator-convergence-smoke` | GUI-owned run + separate child pid reads same transcript (1) | **real HTTP + real child process** | Detectable: cross-process divergence. Gap: `prompt` is a fake session, so it proves file convergence, not live model parity. | K |
| `event-reducer` | out-of-order, duplicate seq, session scoping, tool lifecycle, failures, gaps, thinking, details (10) | pure shared reducer | Detectable: duplicated tool cards, lost deltas, cross-session id collisions. | K |
| `gui-session-manager` | fresh chat not recent session (1) | real SessionManager | Detectable: GUI resuming an unintended session. | K |
| `history-snapshot-store` | fresh reuse, 5-way coalesce, expiry, rejected-build retry (4) | cache | Detectable: stampede, never-retried rejected build. | K |
| `instrument-history-provider-parity` | Yahoo, Alpha Vantage fallback, LSE epoch seconds (3) | real fetch fixtures | Detectable: provider attribution, non-finite intraday times. | K |
| `instrument-history-route` | auth, snapshot, reserved compare, 400 invalid, default 1D (5) | **real HTTP** | Detectable: untrusted snapshot build, compare reaching provider. | K |
| `instrument-history-snapshot` | range map `it.each` (8+2), bars, missing timestamps, daily prevClose (17) | pure + provider | Detectable: wrong range/depth cap, zero-floor times, bad prevClose. | K |
| `instrument-overview-route` | auth, missing symbol, memoized snapshot (3) | real HTTP | Detectable: unauthenticated overview, session access from overview. | K |
| `invoke-tool` | UI metadata, ack/broadcast, quiet transcript, lock loss, dedupe, proxy, dead-owner recovery, follower, ask-user, errors (15) | controller + real writer locks + fetch stub | Detectable: double execution on retry, proxy to wrong session, execution under lost writer lock. | K |
| `live-chat-event-adapter` | deltas/tool output, original prompt, workflow steps, attachments, images, thinking (6) | adapter | Detectable: lost tool output, extra user bubbles, missing image/attachment chips. | K |
| `local-session-coordinator-recovery` | retryable syncing error instead of unknown-owner resubmit (1) | coordinator + lock | Detectable: auto-resubmitting an unknown-owner action. | K |
| `local-session-coordinator` | dedupe, fresh id, non-admission retry, busy sentinel (source), queue, fail-fast, in-flight dedupe, independent sessions, retention (9) | pure coordinator | Detectable: double side effects, lost queueing. Artifact case :49-55 pins `http-routes.ts` sentinel strings. | K (retain) |
| `market-indices-api` | symbol order, per-symbol failure isolation (2) | real fixture + yahoo-finance2 mock | Detectable: whole-strip failure from one bad symbol. | K |
| `market-indices-route` | auth, fixed snapshot, SVG CSP/cache headers, metadata, untrusted sparkline (5) | real HTTP | Detectable: missing CSP/cache headers, untrusted provider call. | K |
| `market-indices-snapshot-store` | fresh window, stale-while-revalidate, degraded retain, partial fresh (5) | cache | Detectable: stale served as fresh, degraded constituent dropped. | K |
| `market-state-api` | SQLite snapshot, memo TTL, candidates, quote/overview snapshots, coalesce, stale-while-revalidate, FX mismatch, stale-total exclusion (18) | real SQLite + mocked provider | Detectable: stale quotes counted in totals, CAD/USD P&L invented. | K |
| `market-state-parity` | UI toolcall / direct TUI tool / GUI snapshot share rows (4) | real SQLite + tools | Detectable: GUI and TUI drift on watchlists/portfolios. | K |
| `model-auth-failure` | 401/403 and Google 400/API_KEY_INVALID (2) | pure classifier | Detectable: provider auth error rendered as generic failure. | K |
| `model-setup` | requirement states, thinking, save key, rejected/unverified key, provider probe, follower (13) | controller + fetch stub | Detectable: saving an unverified/rejected key, follower mutating. | K |
| `preferences-api` | list, delete preference/tool-default, idempotent, id validation (5) | real SQLite | Detectable: credential material in payload, delete not reaching prompt context. | K |
| `preferences-round-trip` | real WS + HTTP with seeded SQLite → prompt context (2) | **full stack** | Detectable: deletes not durable or not reflected in `buildMemoryContext`. | K |
| `preferences-transport` | WS commands + HTTP fallback, follower/lock blocking, auth (10) | real WS hub + HTTP | Detectable: follower delete, unauthenticated read, lock-owner bypass. | K |
| `private-api-access` | loopback, LAN/Tailscale, cookie+loopback, remote opt-in, spoofed headers, cross-site cookie, malformed cookie (8) | **pure security** | Detectable: DNS-rebinding/CSRF-style private API access. | K |
| `projector` | watchlist/quotes, UI unwrap, background refresh, known symbols cap, workflows, analyst counting, gaps, turn slots (15) | pure projection | Detectable: dashboard divergence, debate counted as analyst, duplicated gaps. | K |
| `prompt-observation` | replay transformed prompt, no replay after assistant/original (3) | pure | Detectable: replaying a workflow prompt over a real user turn. | K |
| `quote-snapshot-store` | build/fresh/invalidate/in-flight race/stale-while-revalidate/failure (8) | cache + real SQLite | Detectable: invalidated in-flight build overwriting newer snapshot, partial totals. | K |
| `server-route-guards` | 13-route guard table + handler source slices, session/action fields, coordinator secret, model-refresh ordering (52) | **source contract** | Detectable: a route served without its trusted-session/coordinator guard, or a guard after its handler. Not executed. | K (retain) |
| `session-actions` | image prompt, workflow grace, rename/delete file, no legacy prompt, ask_user dedupe/session/proxy/TUI-reject (12) | real SessionManager + locks | Detectable: rename not visible to TUI, ask_user answered on wrong/unknown session. | K |
| `session-bootstrap` | requested-session snapshot, follower coordination, fresh resolve, ask prompts, malformed route id, envelope, proxy detection (8) | real SessionManager + locks | Detectable: loading the wrong session, `marketStateWritable` mis-flagged. | K |
| `session-entry-wait` | count/new-id waits, settlement, stall vs total cap, progress token, grace for prompts (21) | pure time (fake timers) | Detectable: premature settle of multi-step workflows, unbounded hang. | K |
| `session-list` | hides empty/tool-only sessions without deleting (1) | real SessionManager | Detectable: empty sessions shown, or hidden rows actually deleted. | K |
| `session-resume` | TUI↔GUI list/replay/resume, project cwd (3) | real SessionManager | Detectable: GUI cannot resume TUI sessions. | K |
| `shutdown` | idempotent signals, force-close timeout (2) | process | Detectable: double cleanup, hung close. | K |
| `ticker-line-sparkline` | host routing, cache/coalesce, unsupported, non-SVG, semantic error, stale, size bound (7) | provider proxy | Detectable: caching a semantic-error SVG, presenting stale data, unbounded stream. | K |
| `tool-invoke-ack` | success/failed ack shapes (2) | pure | Detectable: UI mis-badging a manual run. | K |
| `tool-metadata` | configured masking, absent, non-key fields, onboarding states (5) | real config + state | Detectable: raw API key serialized to the browser catalog. | K |
| `writer-lock-fd` | closes exclusive fd (1) | OS | Detectable: fd leak. | K |
| `writer-lock-stale-grace` | live owner not stolen; dead pid reclaimed after grace (1) | OS/time | Detectable: stealing a live long-stream lock. | K |
| `writer-lock` | atomic acquire/release, per-session scope, future path, coordinator metadata/mode 0600, stale/ambiguous recovery, refresh identity, migration races (15) | **OS persistence** | Detectable: two writers, stolen live lock, world-readable lock. | K |
| `ws-hub` | boot/count, untrusted upgrade, dispatch errors + actionId echo, owner kind, marketStateWritable, snapshots, targeted snapshot, no secret leak (9) | WS hub | Detectable: untrusted WS accepted, coordinator secret serialized to browser. | K |

### 12.2 `tests/unit/gui-hosted` (16 files, 238 cases)
| File | Families / cases | Boundary | Credible defect / gap | Disp |
| --- | --- | --- | --- | --- |
| `browser-data-store` | archive validation, import/backup/recovery, credential rejection, size/version/session-tree bounds, concurrent serialization (27) | **real sql.js + OPFS-like dir** | Detectable: credential export, import replacing state before validation. | K |
| `browser-hosted-gui-runtime` | action safety, idempotency, durable pending/accept checkpoints, market-state checkpoint, ambiguity, Pi reuse/cache, tool contracts, images, ask_user, archive budget (46) | hosted runtime | Detectable: double-paid run, lost durable admission, unbounded cache. White-box `(runtime as any)` private-field assertions make internal renames red without behavior change. | K |
| `browser-hosted-session-creation` | single-flight new session (1) | runtime | Detectable: two durable sessions created for one request. | K |
| `browser-model-runtime` | per-provider credentials + installed models (1) | real Pi ModelRuntime | Detectable: credentials not wired per provider. 2026-09-24: removed the lone `constructor.name === "ModelRuntime"` bundling assertion; remaining assertions check actual per-provider auth/model behavior. | K |
| `browser-pi-session` | model-change history, thinking persistence, slash markers, thinking delegate, terminal errors/abort, failure checkpoint (8) | **real Pi SessionManager + sql.js** | Detectable: lost model history, non-abort error surfaced as success, state not flushed on failure. | K |
| `hosted-data-actions` | export/import/clear/update handoff/error propagation (7) | jsdom blob | Detectable: no archive downloaded, reload on failed import, activate without durable save. | K |
| `hosted-market-data-api` | quote fields, zero/invalid price, watchlist/portfolio rows, malformed/zero/inconsistent bars, weekly/monthly prevClose, FX mismatch, partial totals (12) | hosted API + mocked provider | Detectable: zero-filled chart shown OK, partial portfolio total presented complete. | K |
| `hosted-preferences` | request contract, runtimes list/delete, command wiring (7) | **real sql.js checkpoint** | Detectable: deletion not carried into checkpoint/prompt context. | K |
| `hosted-stateful-tool-composition` | watchlist/portfolio on injected sql.js, foreground alerts/reports, explicit-symbol skip, currency not permission (4) | real tools + sql.js | Detectable: provider lookup on saved-state forms, currency used to bypass resolution. | K |
| `hosted-status-pill` | pill view/priority, mount, install, error, status refresh (13) | jsdom | Detectable: error hidden behind install, install offered with no worker. | K |
| `provider-relay-fetch` | auth token, manifest negotiation/cache/revalidate/bounds, provider routing, model streaming, fail-closed, abort, `it.each` direct/stream (24) | relay boundary | Detectable: secret/model traffic to an unapproved provider, unbounded manifest, stale manifest used. | K |
| `pwa-assets` | wrangler SPA, relay origin, manifest, SW/headers/CSP, main.jsx, runtime composition (15) | config source contract | Detectable: cross-origin relay admitted, CSP weakened, shell caching runtime data. Cheap and valuable; no runtime execution. | K (retain) |
| `request-contract` | thinking, action classification, model/provider, attachments, ask_user (7) | pure validation | Detectable: out-of-contract action accepted. | K |
| `runtime-composition` | Pi provider allowlist (2) | bundle contract | Detectable: unapproved provider bundled into the browser runtime. | K |

### 12.3 `tests/unit/gui-web` (93 files, 773 cases)
| File | Families / cases | Credible defect / gap | Disp |
| --- | --- | --- | --- |
| `alert-activity` | activity rows, preview/cadence/threshold copy (9) | Detectable: duplicate alert+notification rows, wrong cadence rounding. | K |
| `alert-sentences` | sentence rows, currency, observed value `it.each` (10) | Detectable: saved rule read back in wrong currency/units. | K |
| `alert-view-model` | manual mode, version review, paused toggle (3) | Detectable: unsupported condition version shown as valid. | K |
| `alerts-page-render` | rule rows/disclosure/create sheet (15) | Detectable: broken rule disclosure or create sheet. | K/C |
| `allocation-donut` | segments/legend/reduced motion (2) | Detectable: donut sweep under reduced motion; total reprinted in centre. | K |
| `app-page-dispatch` | settings `it.each`, diagnostics, symbol/market/chat (7) | Detectable: a route dispatching to the wrong page. | K |
| `app-status-slot` | absent/overlay/pointer scope/sidebar/mobile (5) | Detectable: hosted status overlaying sidebar or blocking page clicks. | K |
| `asset-descriptor` | type maps, per-type sections/stats, em-dash ban (16) | Detectable: FX misclassified as equity; crypto given fundamentals. | K |
| `attachments` | validation, request/optimistic metadata, clipboard, base64 (7) | Detectable: image bytes leaking into saved metadata; text pasted as attachment. | K |
| `carousel-primitive` | carousel/radio (8) | Detectable: primitive a11y regressions. | K |
| `cashtag-autocomplete` | fragment detection, insertion (5) | Detectable: cashtag inserted mid-word or wrong caret. | K |
| `catalog-overlay` | payload, arg serialization, run surfaces, cmdk list (4) | Detectable: providers leaking into the run catalog. | K |
| `chat-composer` | plus/attach render, pending chips, source wiring (4) | Detectable: attach control removed, paste wiring dropped. Two cases are source substring checks. | K/C |
| `chat-error-retry` | failed run retry + disabled state (1) | Detectable: retry prompt/detail lost. | K |
| `chat-panel-events` | transcript render, workflow steps, attachments, chips, ask_user, follower progress, loading, home, thinking, setup (20) | Detectable: many transcript/home regressions. **Seven cases are source-text slices** (ChatPanel/App) — brittle; several encode non-owner/fresh-home contracts not covered elsewhere. | K (retain; C source slices when behavior tests exist) |
| `chat-rows-details` | custom message details on row (1) | Detectable: failure card loses retry prompt. | K |
| `detail-rail-layout` | width tracks, stretch, no-rail (3) | Detectable: rail floating/short-list collapse. | K |
| `diagnostics-page-render` | report sections, session dialog, unknown-only, hosted follower (4) | Detectable: local-only controls shown to hosted, wrong counts. | K |
| `entity-popover-placement` | desktop anchor, mobile clamp (2) | Detectable: callout off-screen. | K |
| `entity-popover` | symbol action, cached quote, held badge, watchlist choice, session facts, resolution error (8) | Detectable: stale quote shown as fresh, add enabled on failed resolution. | K |
| `exchange-labels` | Yahoo code maps, unknown fallback (3) | Detectable: raw exchange codes shown. | K |
| `financial-format` | money/price/compact/signed/chart/quantity/dash (6) | Detectable: currency formatting and NaN handling. | K |
| `first-run-setup-dialog` | auto-open, boot placeholder, dismissal/migration, composer focus, persistence across mounts (14) | Detectable: dialog stranding the composer, re-nagging, or never opening. | K |
| `history-card-render` | MarketChart-backed history, timestamps, crypto, bounds, window (6) | Detectable: missing chart, wrong bar times. | K |
| `home-dashboard-render` | indices, movers, portfolio totals, alert card, affordances, composition, skeletons, mobile, source contracts (17) | Detectable: movers ordering, currency groups, partial totals. **Five cases are source-read contracts** (design/a11y). | K |
| `home-suggestions` | generic/saved-state prompts (4) | Detectable: prompt suggestions detached from saved state. | K |
| `home-view-model` | mover ordering, no mutation (1) | Detectable: movers mis-sorted. | K |
| `hosted-runtime-transport` | hosted actions, streaming, refresh on failure/cancel, commands, role handoff, offline (18) | Detectable: hosted SSE contract break, stale state after stream failure. | K |
| `instrument-search` | navigation, listbox, meta/keys, stale hide, FX ranking `it.each` (9) | Detectable: stale candidates shown, FX cross outranking equity. | K |
| `list-header` | tab/rename/a11y/roving index (6) | Detectable: rename control detached, keyboard nav broken. | K |
| `market-chart-autoscale` | area/line `it.each`, candles, flat, positive floor, indexed/empty (6) | Detectable: zero-floor/negative displayed range. | K |
| `market-chart-behavior` | series mapping, indexed rebase/colors, labels, prevClose, volume scale, grid, price format, tooltip, keyboard, unmount (21) | Detectable: chart data/axis/color/lifecycle regressions. **All mock `lightweight-charts`** — real library integration unproven. | K |
| `market-chart-render` | aria label, range selector, legend, attribution, grid, no embed (8) | Detectable: wrong chart label or missing attribution. | K |
| `market-sparkline-error` | hosted Ticker Line, semantic/stale reject, size/timeout, retry cadence, lazy observer (10) | Detectable: stale/oversized sparkline shown, polling storm. | K |
| `market-sparkline-render` | skeleton, provider-naming ban, instrument translation `it.each`, options fallback (13) | Detectable: provider name leaked, unsupported instrument charted. | K |
| `market-state-format` | relative/short date, human date, degraded badge vocabulary, change directions (10) | Detectable: "Quotes 1051m old", flash crash on non-Map input. | K |
| `market-state-page-render` | 53 cases: rule rows, forms, panels, quotes, allocation, empty/error states | Detectable: broad market-state page regressions. Large but mostly semantic `toContain`. | K/C |
| `mobile-navigation` | home control, long-press menu (2) | Detectable: mobile session menu unreachable. | K |
| `model-recovery` | selector label, failed-run repair, inline errors, hosted storage, socket error attribution, thinking fallback (7) | Detectable: unrelated socket error painted as key failure; key storage mode dropped. | K |
| `model-setup-entry-points` | composer/transcript entry points, app navigation, first-run no-navigation (6) | Detectable: manage-keys not reaching Settings, first-run navigating away. | K |
| `motion-accessibility-contract` | overlay motion, transition ban, reduced motion, quote cross-fade, card primitive (4) | Detectable: `transition-all`/first-paint transition regressions, reduced-motion break. **All source-text.** | K (retain) / I add runtime |
| `onboarding-carousel` | 30 cases: 5-step carousel, provider choice, key save, hosted storage, errors, follower gating, dismissal, modality, `ProviderKeyFlow` | Detectable: onboarding stranding, key echoed to DOM, follower mutating. **The exported `OnboardingCarousel.jsx` itself is not imported** — this file tests `ModelSetupDialog`/`ProviderKeyFlow`. | I/C |
| `optimistic-user-message` | queued projection, session scope, dedupe with persisted, attachment dedupe (6) | Detectable: duplicate user bubbles, wrong-session optimistic row. | K |
| `popover` | toggle close, stable listeners, owned-click containment (3) | Detectable: popover stuck open or closing on inner click. | K |
| `portfolio-view-model` | rollup, day move, foreign currency, exclusions, allocation remainder (14) | Detectable: FX lots folded into totals, wrong blend/allocation. | K |
| `preferences-transport` | local/hosted preference surface (4) | Detectable: delete routed to the wrong transport. | K |
| `price-comparison-card-render` | indexed legend, end labels, unavailable symbols, format, wrapper, compare_companies dispatch (9) | Detectable: legend color drift, unavailable warning missing. | K |
| `provider-builders` | status helpers, api-key/external/public builders, dispatcher (11) | Detectable: wrong builder per provider kind, env-managed key editable. | K |
| `provider-deep-links` | drawer/provider deep links, open named row (4) | Detectable: legacy deep link not reaching Settings. | K |
| `report-schedule-form` | dispatch configure, hosted no-controls, read-only, settings/panel reuse, webhook env, monitor copy (8) | Detectable: schedule controls in the web app, read-only save. | K |
| `rich-text-render` | headings, rules, synthesis sections, numeric tables, chips, code spans (9) | Detectable: markdown mis-render, entity chip inside code. | K |
| `route-session-state` | session id decode, stale hide, fresh home, streaming base, targets, coordination scoping (16) | Detectable: stale transcript shown, wrong send target, stale coordination leaking. | K |
| `runtime-transport-parity` | concrete per-transport canonical state + session targeting + retained parity (1) | Detectable: a transport ignoring its session argument, or a reducer returning empty / wrong-role / unfinished state. **Strengthened 2026-09-24**; mutation-proved (empty reducer fails). Mocks the transport boundary, so it is not live-backend coverage. | K |
| `hosted-transport-session-isolation` | selected-session isolation across a raced background refresh (1) | **New 2026-09-24.** Real hosted transport, deferred `host.request` bootstrap, real subscriber; asserts a stale refresh returning session A's bootstrap after switching to session B never publishes A's `state.snapshot`, and the active snapshot is B's message. Reaches `hosted-runtime-transport.js` branch 78; proven to fail when that guard is removed. Mocks the external host boundary, so not live-backend coverage. | K |
| `runtime-transport` | action surface role, endpoint shapes, error, WS channel (6) | Detectable: local follower treated as writer. | K |
| `schema-form` | derived fields per tool, unions, bounds, percents, parse/coerce, overrides, orphan guard (12) | Detectable: tool form field drift, orphan override. | K |
| `search-icon-alignment` | `it.each` panel/ticker magnifier centering (2) | Detectable: fixed-offset icon drift. Class regex. | K/C |
| `sentiment-insight-render` | scored vs preview sample, legacy fields (2) | Detectable: preview presented as full scoring. | K |
| `series-colors` | palette literal (1) | Detectable: palette drift only; no consumer boundary. | I |
| `session-drawer-focus` | source substring for Sheet autofocus (1) | **Source-only**: cannot fail for a real focus bug. Removed 2026-09-24; replaced by `tests/e2e/gui-integration.test.ts` focus-in and focus-return browser cases. | R (done) |
| `session-market-facts` | enrich from comparison, session facts, latest non-empty (3) | Detectable: quote fields not backfilled, stale fact wins. | K |
| `session-search` | empty query, name/first/transcript matching (2) | Detectable: session search misses text. | K |
| `settings-automation-section` | hosted/offline/follower gating, on-demand vs monitor copy (7) | Detectable: schedule controls in web app, read-only save. | K |
| `settings-data-section` | hosted actions order, install row, typed confirm, offline disable, local path/env (8) | Detectable: destructive clear without typed word, local path leak. | K |
| `settings-diagnostics-section` | registry, frame, remediation routing, hosted session checks (6) | Detectable: browser-cookie checks offered on hosted. | K |
| `settings-model-section` | registry, provider list/picker, save/error/thinking, follower gating (9) | Detectable: key management regressions, settings chrome as dialog. | K |
| `settings-page-render` | registry order, rail, current section, fallback, data-quality forwarding, all bodies (7) | Detectable: missing/duplicated settings section. | K |
| `settings-preferences-section` | list, empty, delete confirm, failure, follower/offline/hosted, push broadcast, load failure (11) | Detectable: delete without confirm, empty state masking a load error. | K |
| `settings-providers-section` | rows, statuses, inline expand, deep link, hosted local-only, empty (7) | Detectable: provider row mis-expands, hosted setup offered. | K |
| `settings-route-resolution` | slug list, `it.each` path resolution, appPage, router search validator (21) | Detectable: `/settings/*` falling through to chat. | K |
| `settings-tool-invoker` | writable invoke without transcript, TUI/read-only reject (3) | Detectable: settings action run against a non-writable session. | K |
| `sidebar-nav-render` | header, groups, Settings active `it.each` (11) | Detectable: Diagnostics in Market State, Settings link missing. | K |
| `skeleton-primitive` | pulse + reduced motion (1) | Detectable: animation without reduced-motion guard. | K |
| `stock-quote-card-render` | backfill valuation from session facts (1) | Detectable: card shows em dash despite known facts. | K |
| `symbol-page-render` | hero, extended hours, stats, crypto/fx/unknown, key levels, trend, key stats, about, position/alerts/watchlist, layout, not-found, staleness (44) | Detectable: broad symbol-page regressions. Strong. Negative artifact case :192-194 (`isNonEquitySymbol` export removed) is intentional. | K |
| `symbol-route-resolution` | ticker `it.each`, `=` round-trip, rejects, router validators, precedence (16) | Detectable: ticker decode/`=` symbols breaking. | K |
| `symbol-view-model` | horizon returns, volume, key levels, trend, assembly, staleness, intraday ignore (30) | Detectable: financial math errors (52-week range, SMA, volume). Strong. | K |
| `thinking-text` | markdown flatten, prefixes, 700-char cap (3) | Detectable: thinking preview leaks markdown or overruns. | K |
| `tool-drawer-render` | bottom-sheet chrome (1) | Detectable: drawer chrome drift. | K |
| `tool-run-grouper` | orphan results, session identity (2) | Detectable: orphan tool results dropped, session lost. | K |
| `transcript-scroller` | anchor decision, keep explicit/restore, source pill (3) | Pure anchor cases real; **:37-54 source slice**. Already browser-covered at `gui-browser:695`. | K/R slice |
| `typed-confirm-dialog` | typed word, whitespace, cancel, reset, pending (5) | Detectable: destructive action enabled without the word. | K |
| `ui-primitives-render` | textarea/button/table/tabs/dropdown/dialog/scroll/separator/command/chart (10) | Detectable: primitive a11y/semantics regressions. | K/C |
| `use-chat-run-terminal-state` | terminal failure clears optimistic queued projection (1) | Detectable: stuck "queued" row after SSE failure. | K |
| `use-chat-run` | endpoint, body validation, action ids, conflict/duplicate, retry options (11) | Detectable: missing session id, retry losing action id/attachments. | K |
| `use-gui-connection` | timeouts, roles/actions, toast, invoke timeouts, HTTP fallback, coordination, socket msg stamping, reconnect, snapshot merge, source grep (19) | Detectable: many connection regressions. **:240-244** is a whole-source-tree grep for `chat.prompt` — brittle artifact assertion. | K |
| `use-instrument-history` | fetch/loading/resolved, range clear, failure, out-of-order, errors, stale passthrough (6) | Detectable: previous symbol shown after failure, superseded response winning. | K |
| `use-market-indices` | load/poll, `it.each` hide-strip (3) | Detectable: indices polling stops, empty strip shown. | K |
| `use-market-state` | intervals, request gate, snapshot merge, quote merge/retention/partial totals (12) | Detectable: partial portfolio total published, refresh wiping quotes. Strong. | K |
| `use-symbol-endpoint` | quote transport routing, ticker switch hides stale (2) | Detectable: prior ticker snapshot kept after failure. | K |
| `use-symbol-view-model` | descriptor+derived stats, search unavailable, staleness, no search function (4) | Detectable: view model missing when search unavailable. | K |
| `use-waiting-service-worker` | pre-existing/announced/absent (3) | Detectable: update prompt never offered. | K |
| `watchlist-options` | normalize, default fallback, attachment label (3) | Detectable: blank watchlist name, wrong attachment. | K |

### 12.4 Browser / e2e (in scope)
| File | Families / cases | Boundary | Credible defect / gap | Disp |
| --- | --- | --- | --- | --- |
| `tests/e2e/gui-browser.test.ts` | 28 journeys: boot/history, quote+tool cards, mobile, screenshots, onboarding/key management, follower, composer/catalog, portfolio attachment, cashtags, socket reconnect, sidebar, market-state nav, follower read-only, mobile tools, drawer close, anchors, provider masking, session menu, streaming, optimistic, fresh-home routing, WS fallback, suggestion gating, two-client coordination, concurrent sessions, live TUI parity | **live GUI server + Chromium + TUI harness**; most cases install a mock WS or mock `/api/*`, some run the real server and a live model | Detectable: broad browser journeys. Gaps: most cases stub the server (so they prove the client, not server delivery/durability); the parity case needs a live model credential and is nondeterministic (structural set equality, not sequence). | K |
| `tests/e2e/gui-release-smoke.test.ts` | 8 cases: health, cold-home first-run, Escape/close dismissal + composer hit-test, invalid OpenAI/Google key inline, blocked cold-home diagnostics, manage-keys entry | **spawned real server + Chromium, keyless** | Detectable: release-gate regressions (stranded composer, dialog over composer, key rejection not inline). Strong; keyless. | K |
| `gui/hosted/tests/hosted-pwa.e2e.mjs` | stage script: WebContainer boot/COEP, direct browser providers, optional live Pi turn/reload, watchlist/portfolio persistence/reload, multi-tab follower, mobile overflow, export/import/corrupt/newer-schema, clear secrets, offline shell, update handoff, clear+restore, secret-absence assertions | **real preview + Chromium + sql.js/WebContainer** | Detectable: hosted persistence/multi-tab/offline/archive regressions; secrets in archive/logs/errors. Keyless stages always run; model stages conditional on credentials and reported `livePi=PASS|SKIP`. | K |

### 12.5 Contract/defect synthesis from the full read
1. **Security/authorization is well covered**: `private-api-access` (executed predicate), `server-route-guards` (artifact ordering, retain), `provider-relay-fetch` (fail-closed, bounds), `ws-hub`/`tool-metadata`/`preferences-*` (no secret serialization), `ticker-line-sparkline` (no stale/cached error). No credible bypass found.
2. **Durability/idempotency is well covered**: `browser-hosted-gui-runtime`, `browser-runtime-host`, `browser-data-store`, `local-session-coordinator`, `session-actions`, `chat-run-body` (dispose-after-settle). The main residual is white-box coupling (`(runtime as any)`), not weak behavior.
3. **Financial-boundary honesty is well covered**: FX-mismatch exclusion and partial-total refusal recur in `market-state-api`, `hosted-market-data-api`, `portfolio-view-model`, `use-market-state`, `home-dashboard-render`, `symbol-page-render`.
4. **Weakest remaining links** after the 2026-09-24 follow-up: `onboarding-carousel` (misnamed; carousel untested), `motion-accessibility-contract`/`chat-panel-events`/`home-dashboard-render`/`use-gui-connection` (source-text or whole-tree greps), `series-colors` (tautology). `runtime-transport-parity` and `browser-model-runtime` were strengthened/cleaned in the follow-up, and `session-drawer-focus` was replaced by real browser focus cases in `tests/e2e/gui-integration.test.ts`.
5. **Boundary limits, not defects**: `lightweight-charts`/`recharts` mocked in gui-web chart tests; `BroadcastChannel`/`LockManager`/`WebContainer` simulated in hosted unit tests; most `gui-browser` cases stub the server. Real chart rendering and real multi-tab/WebContainer behavior rest on `hosted-pwa` and `gui-release-smoke` only.
