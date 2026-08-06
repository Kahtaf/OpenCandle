## 1. Consolidate the proven spike

- [x] 1.1 Move the feasibility measurements, dependency audit, live OpenAI result, SQLite OPFS result, secure process-transport contract, and known blocked capabilities into the production change documentation and remove the ad hoc `plans/` artifacts.
- [x] 1.2 Turn the standalone spike tests into reusable hosted-runtime contract fixtures without copying production routing, tool, provider, or event logic.
- [x] 1.3 Add a build composition test that fails on native addons, `child_process`, external CLIs, unknown Pi providers, leaked credentials, or an unbounded runtime payload.

## 2. Establish shared platform boundaries

- [x] 2.1 Add a public runtime-surface/capability model with tests for hosted web, local web, and local TUI defaults.
- [x] 2.2 Add a narrow synchronous `StateDatabase` contract and native `better-sqlite3` adapter, then prove all existing memory and market-state tests remain green.
- [x] 2.3 Add a `RuntimeTransport` contract around existing GUI bootstrap, session, chat-run, event, tool-action, and market-state shapes; implement the current loopback transport without changing local GUI behavior.
- [x] 2.4 Add shared contract tests proving local and hosted transports feed identical canonical `ChatEvent` reducer behavior.

## 3. Run a full Pi session in browser-hosted Node

- [x] 3.1 Write a failing real-browser test that boots the production Pi/OpenCandle agent loop, creates a Pi session, and completes one live OpenAI chat turn with an enabled direct provider.
- [x] 3.2 Build the smallest audited WebContainer runtime composition that passes the full-turn test using the real Pi session manager, OpenCandle extension, router, tool adapter, and chat-event adapters.
- [x] 3.3 Stream ordered run/message/tool/source events through the origin-checked browser transport and render them with the existing GUI reducer.
- [x] 3.4 Prove cancellation, model failure, provider failure, and runtime restart produce bounded canonical events without losing the last durable session.

## 4. Persist canonical hosted sessions

- [x] 4.1 Add failing tests for Pi JSONL hydration into WebContainer and checkpoint back to OPFS after each durable append.
- [x] 4.2 Implement browser session snapshot storage, checkpoint acknowledgements, crash recovery, and session list/open/create/continue over the existing Pi entry format.
- [x] 4.3 Add a cross-surface conformance test that exports a hosted session, loads it with Pi's real local reader, and continues it through the TUI harness.
- [x] 4.4 Add reload browser coverage proving transcript, tool calls, sources, branching identity, and session metadata rebuild from canonical OPFS entries rather than UI cache.

## 5. Persist OpenCandle state with compatible SQLite

- [x] 5.1 Select and document a license-compatible synchronous WASM SQLite implementation by proving the required `StateDatabase` API and bundle behavior in WebContainer.
- [x] 5.2 Implement the WASM `StateDatabase` adapter and a shared conformance suite for schema version, migrations, transactions, constraints, and representative memory and market-state queries.
- [x] 5.3 Hydrate and checkpoint the hosted SQLite file through OPFS, acknowledging mutations only after a durable snapshot.
- [x] 5.4 Add real-browser tests for watchlist, portfolio, memory, and workflow-state persistence across reload and runtime restart.

## 6. Make hosted provider and tool capabilities fail closed

- [x] 6.1 Extend every provider descriptor with tested `direct`, `proxy`, or `blocked` browser transport metadata and make missing metadata fail tests.
- [x] 6.2 Add capability-aware hosted tool construction that physically omits tools without a complete direct-provider path while leaving local tool construction unchanged.
- [x] 6.3 Run live Chromium probes for every proposed direct provider and record request, CORS, authentication, response-bound, and secret-handling evidence.
- [x] 6.4 Add hosted diagnostics and graceful-degradation UI that names unavailable capabilities, offline state, and the local GUI/TUI alternative without fabricating results.

## 7. Reuse the local React GUI as the hosted product

- [x] 7.1 Refactor GUI data access behind `RuntimeTransport` using characterization tests so the local loopback build remains visually and behaviorally unchanged.
- [x] 7.2 Add the hosted browser transport and build entry, reusing existing session navigation, chat, tool/source renderers, onboarding, and market-state components.
- [x] 7.3 Add browser-safe secret onboarding with persistent and session-only modes, non-prefilled restore state, capability-aware model choices, and clear threat copy.
- [x] 7.4 Verify the hosted GUI in desktop and mobile browsers with an impeccable UX pass and React performance review.

## 8. Make the hosted app an installable PWA

- [x] 8.1 Add manifest, icons, standalone metadata, service-worker registration, immutable static asset versioning, and an automated installability assertion.
- [x] 8.2 Cache only the application shell and add offline browser tests proving durable sessions remain readable/exportable while research actions are explicitly disabled.
- [x] 8.3 Add update prompting, active-run/checkpoint gating, schema migration backup, and rollback behavior with browser tests.

## 9. Coordinate tabs and durable ownership

- [x] 9.1 Add Web Locks writer election and BroadcastChannel follower bootstrap/events with deterministic unit tests.
- [x] 9.2 Forward follower prompts and actions to the writer exactly once and prove both tabs render the same canonical event stream.
- [x] 9.3 Add runtime epochs and browser failover tests proving one follower takes ownership after writer loss and ignores late prior-epoch events.

## 10. Give users control of browser-owned data

- [x] 10.1 Add versioned export and atomic import for Pi sessions and OpenCandle state with schema, path, size, and credential-exclusion validation.
- [x] 10.2 Add clear-all and clear-secrets flows covering OPFS, secret storage, caches, runtime snapshots, service-worker mutable data, and follower notifications.
- [x] 10.3 Add browser tests for export, clear, import, corrupt import rejection, credential exclusion, and recovery after runtime failure.

## 11. Validate every product path

- [x] 11.1 Run hosted PWA real-browser journeys for first launch, key setup, full Pi chat, direct tools, sessions, market state, reload, restart, offline shell, update, multi-tab, export/import, and clear at desktop and mobile viewports.
- [x] 11.2 Run the existing local GUI real-browser suite plus characterization journeys for setup, chat, sessions, tools, market state, writer/follower behavior, and mobile layout.
- [x] 11.3 Run the TUI harness against new and imported hosted sessions and prove local native persistence behavior is unchanged.
- [x] 11.4 Run secret-leak, CSP, process-frame forgery, dependency audit, PWA installability, accessibility, performance, root gates, and graph refresh checks; document exact supported and unavailable hosted capabilities.
- [x] 11.5 Update the changelog and user documentation with honest no-OpenCandle-server, WebContainer dependency, offline, credential, provider, and background-execution boundaries.

## 12. Consolidate Pi model setup across surfaces

- [x] 12.1 Add failing contract tests for a shared Pi-backed model catalog and setup state used by hosted web, local web, and local TUI, with no hosted-only model literals.
- [x] 12.2 Replace the hosted OpenAI-only compatibility path with Pi provider implementations for every browser-proven first-class OpenCandle model provider, and use the selected Pi model for both routing and agent streaming.
- [x] 12.3 Persist credentials per model provider, preserve the selected provider/model across reload and writer failover when device storage is selected, keep session-only credentials tab scoped, and keep all credentials out of exports, events, URLs, bundles, and logs.
- [x] 12.4 Reuse shared GUI/TUI setup, validation, session, and runtime contracts where platform boundaries permit; document and test every intentional hosted-only boundary.
- [x] 12.5 Run live browser turns for every configured browser-safe model provider, local GUI and TUI regression journeys, strict OpenSpec validation, graph refresh, root gates, and autoreview.

## 13. Close remaining hosted/local feature-parity gaps

- [x] 13.1 Replace hosted catalog and manual-tool metadata with the filtered canonical GUI/TUI catalog, including parameters, domains, defaults, workflows, and executable invocation.
- [x] 13.2 Reuse canonical market-state tool commands so hosted chat and manual actions can manage watchlists, portfolios, alerts, and reports while excluding only unavailable background delivery.
- [x] 13.3 Add the shared ask-user command lifecycle and attachment parsing to the browser-safe session composition.
- [x] 13.8 Reuse the remaining JIT credential and thinking-level controls where they are available in the local GUI/TUI.
- [x] 13.4 Replace volatile hosted action deduplication with canonical persisted Pi action markers and prove exactly-once behavior across runtime epochs.
- [x] 13.5 Extract a shared headless Pi/OpenCandle session factory beneath local GUI, TUI, and hosted compositions; remove the partial hosted ExtensionAPI lifecycle.
- [x] 13.6 Reuse the canonical live chat-event adapter and assert equivalent ordered progress, tool, source, cancellation, and completion traces on hosted and local web.
- [x] 13.7 Consolidate hosted/local market snapshot builders, provider requirements, tool capability metadata, and typed transport requests so platform adapters only handle transport and persistence.

## 14. Harden production PWA behavior after live UI testing

- [x] 14.1 Make writer ownership converge before WebContainer boot, expose a clear active-writer state, and cover prompt, tool, cancellation, session-load, and credential handoff across runtime epochs without unbounded UI states.
- [x] 14.2 Make bootstrap, reload, service-worker activation, writer promotion, and offline recovery converge on canonical OPFS session/model/checkpoint state without false first-run or invalid-snapshot UI.
- [x] 14.3 Apply the shared API-key validation probes to every local GUI, hosted PWA, and TUI entry surface; allow required probe endpoints through the bounded relay and reject unverified keys before they appear configured.
- [x] 14.4 Repair canonical workflow and direct-tool event/result rendering so hosted workflows produce result cards and terminal states rather than only step prompts.
- [x] 14.5 Produce current-production Browser evidence for every enabled hosted model and tool path, including Yahoo, Finnhub, LSE, FRED, TradingView, Fear & Greed, DDG, and configured Exa/Brave; document intentional Reddit/X and closed-tab exclusions.
- [x] 14.6 Run the release acceptance matrix on desktop and mobile: bootstrap, credential setup, model selection, autocomplete, chat/stream/stop, tools, workflows, market state, reload/update/offline/error, and writer/follower handoff; run matching local GUI and TUI regression journeys.
- [x] 14.7 Run focused checks, the hosted build, full root gates, production deployment acceptance, graph refresh, and code review only after the hardening batch is stable.
