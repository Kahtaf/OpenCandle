# Changelog

## [Unreleased]

### Added

- Watchlists can now be deleted from the GUI (guarded so the last remaining watchlist cannot be removed), alongside the existing create and rename flows.
- Failed GUI tool/workflow runs now show the failure reason on the run card and offer a Retry action that re-sends the original prompt.
- The GUI component library gained shadcn-style table, tabs, dropdown menu, alert dialog, scroll area, separator, command, and chart primitives for upcoming page overhauls.
- Watchlists can now be created as named lists and managed independently from the GUI tabs or the `manage_watchlist` TUI/tool flow.
- Watchlists can now be renamed through the GUI and the `manage_watchlist` TUI/tool flow.
- Portfolios can now be created and renamed as named lists from GUI tabs, chat attachments, and the `track_portfolio` TUI/tool flow.

### Changed

- The GUI Watchlists page is now a quote board: company names under tickers, change $ and %, volume, per-row action menus with confirmed removal, and a symbol inspector with day/52-week ranges.
- Stock quotes now carry the provider company name (Yahoo long/short name) through saved market-state snapshots, shown under tickers in watchlist and portfolio tables and inspectors.
- Watchlist and portfolio rows now show pre-market and after-hours quotes when the market is in an extended session: a session-labeled line ("Pre-market" in amber, "After hours" in blue) with the extended price and signed change renders under the regular price in tables and the inspector, sourced from Yahoo's quote endpoint; regular-session prices remain the basis for all P&L math and alert evaluation.
- Watchlist and portfolio quotes stay silent while fresh and announce their age only when degraded: an amber badge reads "Quotes Nm old" only when the refresh pipeline itself is stale (fetch time, not the provider's last-trade time — evenings after the close no longer read as degraded) or "As of <date>" for prior-day data with no extended-session quote, per the freshness decision in docs/internal/gui-ux-audit-2026-07.md.
- Watchlist and portfolio rows flash a brief green/red tint when a background refresh changes their price, suppressed under reduced-motion preferences.
- GUI market-state create/edit forms open as right-side overlay sheets on desktop instead of reflowing the page (mobile keeps bottom sheets); page headers were consolidated to one title, tab strip, and primary action, and list tabs support arrow-key navigation.
- GUI Diagnostics renders grouped status rows instead of one bordered card per check, zero counts stay neutral, and "Degraded" is reserved for real warnings or failures — unchecked optional capabilities now report as ready in both the GUI and `opencandle doctor`.
- The ⌘K catalog list supports arrow-key and Enter navigation with a visible selection and a stable overlay height across tabs.
- GUI portfolio allocation renders distinct per-holding segments with matching legend dots, portfolio forms use a currency select and show in-button pending states, and lot ledgers animate open.
- GUI alert rules describe their last observed state in plain English per condition (for example price versus the 20-day SMA) instead of appending a bare number; cooldowns are edited in human units and threshold fields adapt to the selected condition.
- The GUI home empty state centers the hero, suggestions, and composer as one block, wraps suggestion chips at narrow widths, and personalizes suggestions from saved watchlists and portfolios.
- GUI market-state pages show first-load skeletons and no longer flash empty states while data is loading.
- Markdown tables in GUI chat answers now follow the app's data-table styling, with muted headers and numeric columns right-aligned in tabular numerals.
- The GUI ticker popover renders quote facts as a flat divided stat grid with the company name when available, and the chat composer's touch targets meet minimum hit-area sizing.
- GUI ticker search suggestions now show human-readable exchange and instrument-type names ("Nasdaq · Stock") instead of raw provider codes ("NMS · EQUITY").
- GUI copy no longer leaks internal vocabulary: diagnostics session checks point at the Check button (the CLI keeps its `opencandle doctor --sessions` remediation), the GUI server check reads "GUI server is running and can run sessions", catalog provider status "Not checked" is now "Not verified yet", and the Add Holding helper uses plain language.
- The "What the agent sees" context drawer and its composer eye toggle were removed per the GUI UX audit decision; its data-quality warning now surfaces on the Diagnostics page, and per-turn context surfaces will return in later work.
- **BREAKING**: Published package contents now ship compiled GUI server/runtime artifacts instead of raw `src`, `gui/server`, and `gui/shared` trees; deep imports into those source trees from the published package no longer resolve.
- Biome release-check noise is reduced with mechanical lint fixes plus scoped test/provider overrides for intentional mock and raw-response patterns.
- **BREAKING**: Watchlist items now store only the instrument membership and provenance; target, stop, thesis, notes, and tags fields have been removed from watchlist state, tools, GUI forms, prompt summaries, and related tests. Existing saved watchlists keep their symbols through the v9 schema migration; the removed annotation fields are dropped.

### Fixed

- Model API keys are now validated before GUI or TUI setup saves them: rejected keys stay unsaved, while offline verification saves with an explicit network notice.
- The GUI composer now labels an unconfigured model honestly, offers persistent model-key management, and shows failed model-auth chat runs with retry and key-repair actions.
- Public documentation now reflects session-addressed GUI chat runs, current keyless sources and provider links, Node/platform support, and release-check requirements.
- Published TypeScript artifacts no longer include dangling source maps.
- Release preparation now requires an explicit release-eval confirmation before version or tag mutation, unless the emergency skip flag is used.
- CI now runs agent-tool tests and the Chromium-backed GUI release smoke on Node 24.
- Empty chat sessions no longer clutter the GUI sidebar as "(no messages)" rows; message-less sessions are filtered from session lists at read time without deleting data.
- GUI ticker suggestion dropdowns no longer clip at panel edges; the list portals above the sheet boundary.
- SMA alert checks now persist the price and SMA leg values needed to describe observed state honestly on later reads.
- Opening the mobile session drawer no longer leaves a focused element under aria-hidden content, clearing the browser accessibility warning.
- README setup/data-source guidance now includes TradingView scanner and Polymarket Gamma as keyless public sources.
- Publish workflow now installs the Chromium browser binary required by the GUI release smoke before running `release:check`.
- Watchlist, portfolio, alert, and report form actions in the GUI now update saved market state without creating empty chat sessions.
- GUI market-state tool buttons now fall back to trusted same-origin HTTP invocation when the WebSocket connection is unavailable after bootstrap.
- Doctor and GUI Diagnostics now treat never-configured optional providers as skipped, offer in-GUI provider setup, use an in-app session-check confirmation, and return exit code 1 only for blocked health.
- CLI help and version flags now exit before interactive startup; package metadata reflects OpenCandle's research-only positioning, supported Node versions, and cross-platform source builds.

## [0.11.1] - 2026-07-08

### Added

- Added a GUI cashtag entity layer: `$` autocomplete in the chat composer, dashboard-known symbol chips in chat text, and chip popovers that show cached quote/state context with watchlist and follow-up actions.
- Added TradingView Scanner to diagnostics as a public market-data reachability provider.
- Added a release-runnable frozen competitive adversarial panel for historical loss classes, runnable through `npm run eval -- competitive:frozen`, cached-baseline runner mode, prompt-policy hard assertions, and documentation separating frozen reruns from generated competitive discovery.
- Added a single eval front door (`npm run eval -- <suite>`) with release cadence support (`npm run eval -- release`), command/env audit output, and a local JSONL run index under `tests/evals/runs/`.
- Added an opt-in GUI/TUI parity eval that sends the same live prompt through `runOpenCandleSession()` and the GUI server chat-run API, diffs `opencandle-*` entry sequences, and asserts projector dashboard `analystsDone` matches emitted analyst-step entries; the case is recorded as an expected failure for the current GUI chat-run parity gap.
- Added opt-in known-fail E2 saved market-state fidelity eval coverage for seeded portfolio rate-exposure and SPY cost-basis prompts, including trace assertions for saved-state route context, portfolio-review routing, and fixture value reuse.
- Added a live, usually-tier E1 multi-turn coreference eval for prior-turn ticker carryover and saved-portfolio holding references, currently marked known-fail/opt-in with committed trace evidence for the saved-state AMD resolution gap.
- Added opt-in E5 ask-instead-of-guess product evals for ambiguous calls/bank prompts and resolvable prior-turn twins, with committed live findings for current over-guessing and over-asking behavior.
- Added deterministic E3 provider-outage eval coverage for zero-filled Yahoo quote payloads and partial correlation matrices under a mocked Yahoo fetch surface, with known-fail findings recorded for stale weekend quote freshness and turn-gap trace emission.
- Added a shared freshness ledger for quote-family tools, preserving provider market/as-of times from Yahoo, Alpha Vantage, CoinGecko, and Yahoo options, appending deterministic as-of disclosure lines, and propagating freshness into runtime evidence records.
- Added GUI composer attachments for images and saved market-state context, including pending chips/thumbnails, clipboard image paste, server-side image validation, Pi vision prompt threading, persistent session image content, and user-bubble attachment chips.
- Added keyless Polymarket event probabilities with cached/rate-limited Gamma search, a `get_event_probabilities` macro tool, mandatory prediction-market caveats, doctor readiness, and data-source documentation that defers Kalshi pending ToS clearance.
- Promoted the E3 stale-weekend quote freshness case from known-fail to a gating deterministic eval using Yahoo's provider market date instead of the Saturday fetch-day placeholder.

### Changed

- GUI ticker search suggestions now share one instrument-search dropdown primitive across chat cashtag autocomplete and saved-state watchlist/portfolio/alert forms.
- Removed legacy eval npm routes (`test:evals*`, `eval:router-live`, `eval:competitive:analyze`, and `eval:release`); `npm run eval -- <suite>` is now the only supported eval command surface.
- Expanded the deterministic router fixture corpus with archived task 4.7 coverage for prior-context comparisons, general-QA follow-up shifts, preference echoes that must not write preferences, and historical misclassification recovery cases.
- `release:check` now includes a credential-free GUI release smoke that builds the browser bundle, boots the real GUI server, verifies `/health`, renders first-run model setup in Chromium, and confirms drafting stays available while sending is blocked until model setup is ready. (An earlier revision of the smoke had disabled the whole composer during first-run setup, reverting the shipped 0.11.0 draft-while-setup behavior; the behavior and its assertions are restored.)
- Harness sessions now support sequential `prompts` with per-prompt trace boundaries while preserving single-`prompt` behavior, and the IPC harness can `send` follow-up prompts into an existing session. The `run` command now exits after a bounded follow-up window (default 120s, `--linger` to override) instead of polling forever, cleaning up its session and any self-created temp home; trace files are written atomically so a concurrent `trace` read never observes truncated JSON; follow-up prompts get analysis-aware timeouts instead of inheriting the first prompt's; and `send` fails fast when the run process is no longer alive.
- Comprehensive-analysis workflow steps now capture observe-only tool evidence, parse structured analyst/debate outputs into step records, emit `opencandle-analyst-step` trace entries, and let the GUI projector count analyst progress from those entries without changing analyst prompt templates.
- Comprehensive-analysis synthesis now receives an additive deterministic analyst vote tally when at least two analyst outputs parse, skips consensus rebuttals programmatically, and emits observe-only validation trace entries after synthesis without enforcing or rewriting the answer.
- Rewrote the OpenSpec `/forget` proposal to define deterministic matcher semantics, durable forget-list storage, non-destructive AI-context suppression surfaces, confirmation/listing behavior, undo, and verification requirements.
- Reframed the GUI context drawer as "What the agent sees", with last-turn routing context, slot provenance, attachment counts, validation receipts, and analyst progress above the existing session context sections.

### Fixed

- Ticker popovers now open next to the clicked symbol, clamp within mobile viewports, and reuse recent session quote/fundamental facts instead of showing an unhelpful empty cached-quote state.
- Stock quote cards now backfill missing valuation fields such as P/E and market cap from later session fundamentals/comparison results when another provider supplies those facts.
- Company comparison fundamentals now fall back from Alpha Vantage to Yahoo Finance per symbol and report per-symbol provider failure reasons.
- Router title/model calls now retry without `temperature` when a provider rejects that option.
- Prediction-market probability lookups now exclude closed/inactive Polymarket markets, preserve provider as-of timestamps, and delimit Polymarket market text as untrusted external content.
- Freshness checks now treat prior-session equity quotes as stale during open or post-close market sessions, Alpha Vantage GLOBAL_QUOTE as-of values preserve date-only provider semantics, and empty screen results still disclose cached/stale data.
- Competitive cached-answer fallback no longer reuses failed baseline answers: cached competitor answers carrying a recorded `error` (failure placeholders such as "baseline failed before answering") are skipped, so a crashed baseline is retried live or skipped at preflight on later runs instead of freezing the failure text into every subsequent comparison.
- Explicit week-range DTE requests such as "a covered call 1-2 weeks out" now survive same-day catalyst mentions: deterministic DTE-hint extraction checks the user's stated week range before inferring `event_week` from "earnings are today", so options routing no longer collapses a requested 1-2 week horizon into a 0-7 day event-week horizon (the frozen competitive panel's "1-2 weeks DTE preservation" loss class, caught live by its hard assertion).
- The competitive Codex baseline default model id is now `gpt-5.3-codex-spark`, matching what the current codex ACP agent advertises; the old reasoning-suffixed `gpt-5.3-codex-spark[medium]` id was rejected at preflight ("did not advertise that model"), silently skipping the Codex baseline. `OPENCANDLE_COMPETITIVE_CODEX_MODEL` still overrides.
- The competitive eval script now resolves the judge/OpenCandle model from provider env keys (for example `GEMINI_API_KEY` in `.env`) when Pi AuthStorage has no stored credential, by seeding the env key as a runtime AuthStorage override; previously the run aborted with "No API key available" before any baseline ran because Pi's ModelRegistry skips env-key fallback. Production auth paths are unchanged.
- The frozen competitive eval script no longer crashes with a `completeSimple` ReferenceError at the first judge call (after a live OpenCandle session had already run); a unit-level typecheck guard now catches eval-script type errors that `tsc --noEmit` misses because tests are excluded from the repo typecheck.
- The DCF harness eval now requires a final intrinsic-value answer instead of accepting explicit refusal as success; `compute_dcf` can fall back from Alpha Vantage statement throttling to Yahoo Finance financial statements and reported share counts.
- The DCF Yahoo fallback now accepts raw epoch-second fiscal dates from `yahoo-finance2` fundamentals rows, so the fallback does not drop every financial statement when Alpha Vantage statements are throttled.
- The competitive Gemini baseline now prefers direct Google API mode when `GEMINI_API_KEY` or `GOOGLE_API_KEY` is configured, avoiding the retired consumer Gemini CLI ACP path. Set `OPENCANDLE_COMPETITIVE_GEMINI_AGENT=acpx` to force the legacy ACP command.
- `/analyze` comprehensive-analysis runs now emit the same `opencandle-workflow` session entry as router-dispatched workflows, so the GUI dashboard can track active analyses and move completed research into recent research.
- Committed PR runtime-evidence artifacts (traces, logs, screenshots, eval dumps — ~26 MB across 170+ files, including pre-existing website-redesign screenshot sets) were pruned from the repo; `docs/internal/pr-evidence/` is now git-ignored, evidence stays machine-local with load-bearing excerpts pasted into PR descriptions, and the two durable decision records (the Gemini router triage table and the PR 85 open-items list) moved to `docs/internal/` as markdown.
- The live GUI/TUI parity eval now passes end to end and asserts truthful contracts: identical `opencandle-*` entry-type sets across both surfaces (excluding run-conditional provider-gap entries), session-addressed snapshot reads, and the projector's actual completed-run state.
- The last legacy implicit-active-session mutation surface is gone: the GUI WebSocket `chat.prompt` message now returns an error directing callers to the session-addressed chat-run API (matching the HTTP route's 410), the underlying controller `handlePrompt` was removed, and the orphaned `chat-run-session` module with zero production callers was deleted.
- Cross-process GUI chat-run forwarding works again: proxy allowance is now an explicit per-route decision instead of being inferred from an internal body-override argument, which the session-scoped action changes had made always-set — silently disabling the 0.11.0 authenticated local forwarding so browsers got endless 409 "reconnecting" responses for sessions owned by another live GUI process.
- Synthesis validation produces far fewer false mismatches: numeric-claim extraction now requires whole-word metric matches within a bounded window (prose like "opening the door to 60%" no longer binds to the `open` price), parses thousands separators ("129,935,067" is no longer read as 129), and treats prose values that round to the tool result as matches (197.14 vs 197.13999938964844) — a live `/analyze` previously recorded 34 garbage mismatches per run, poisoning the false-positive data the answer-receipts direction depends on.
- Structured analyst steps no longer vanish on empty responses: an empty captured step text now takes the same parse-failure path as malformed text (one re-prompt, then a `parsed: false` analyst-step entry), out-of-range `CONVICTION` values are rejected instead of being recorded as a fabricated default of 5, and the rebuttal step runs when fewer than two analyst outputs parsed instead of being skipped as false consensus.
- GUI chat runs no longer fail long workflow prompts: the session-settle wait now times out on a stalled session (no status change for the timeout window) instead of capping total runtime at 120 seconds, which killed `/analyze` runs mid-workflow with "Timed out waiting for the session turn to settle" and left their session actions stuck pending. Verified live: `analyze NVDA` through the session-addressed chat-run API now completes with `run.completed`.
- Eval suite registration works again: `registerEvalSuite` now uses plain Vitest `describe`/`it` with the repo's own scoring and thresholds, replacing the `vitest-evals` `describeEval` shim whose 0.14 API change made every eval suite (including the always tier and the E2 saved-market-state opt-in) throw `define is not a function` at collection time. The unused `vitest-evals` dependency was removed.
- Gemini router-contract evals now stabilize known drift cases with deterministic post-processing for macro-acronym comparisons, profile-backed risk slots, conversational risk preference updates, and locally marked acronym tickers.
- The frozen competitive panel now evaluates its own loss-class contracts: each panel prompt's `finalAnswerHardAssertions` from the prompt-policy manifest run against the OpenCandle trace during the frozen run, results are printed and recorded in the report, and any deterministic hard-assertion failure fails the run — a generous LLM judge is no longer the only gate on a loss-class regression.
- The live router eval compares the full routing contract again: `preference_updates` (the preference-ECHO fixture's contract now has live-tier enforcement), `tool_bundles` (order-insensitive membership), and the value of every expected slot are back in the diff — only extra volunteered slot keys, slot provenance detail, and the documented Class B/C vocabulary exemptions remain excluded, each with an inline justification.
- Lowercase trading verbs no longer mint tickers: "sell calls against my AMD shares" produced a `SELL` symbol (and catalyst-symbol) from the options-context pattern; trading verbs are now in the lowercase finance-term stoplist, router fixture 031 drops the codified artifact, and fixture 030 drops a fabricated diagnostic code that exists nowhere in the router.
- Conversational risk-preference recovery can no longer hijack non-finance chat: a saved `risk_profile` alone no longer converts a pass-through turn like "I'm feeling more aggressive on the tennis court lately" into a routed preference write — finance context must come from the current text or prior turns.
- Compare-workflow symbol slots no longer claim user provenance for prior-turn carryover symbols: router post-processing downgrades the slot source to `prior_context` when a user-sourced symbols slot contains symbols absent from the current text but present in prior turns, so the Assumptions block does not misattribute them (tickers resolved from company names in the current text keep user provenance).
- GUI chat runs now reject the legacy active-session mutation route, require explicit session/action IDs for chat, ask-user, and tool actions, and expose a session-scoped stop control so one session can be stopped without interrupting another.
- Autoreview now skips the React Doctor changed-scope gate for commit/range reviews whose reviewed head is not the checked-out `HEAD`, preventing unrelated later GUI changes from failing historical reviews.
- OpenSpec backlog cleanup now archives the stale GUI concurrent-session proposal against shipped behavior and adds `gui-session-scoped-action-cleanup` as the slim follow-up for explicit session-scoped GUI mutations.
- GitHub Pages deployment now retries once after a transient `deploy-pages` failure before failing the workflow.
- Session-entry wait tests now use deterministic timers for async workflow settlement, removing a Node 24 CI timing flake.

## [0.11.0] - 2026-07-03

### Removed

- **BREAKING**: The predictions feature was removed entirely — the `track_prediction` tool, the GUI Predictions page and navigation, prediction quote snapshots, prediction routing/prompt context, and the SQLite `prediction_records` table (dropped by the v8 schema migration; all other saved market state is preserved).
- **BREAKING**: The `OPENCANDLE_DEBATE` flag and `debate` config key were removed; comprehensive analysis (`/analyze`) always runs the adversarial bull/bear debate steps. A still-set flag is ignored rather than failing startup.
- **BREAKING**: The deterministic rules router is no longer a production routing path. The LLM router is now the default and only mode; `OPENCANDLE_ROUTER_MODE=rules` fails startup with migration guidance. Deterministic safety nets (acronym disambiguation, symbol preflight, compare clarification aborts, router validation-failure recovery) remain active on LLM router output.

### Changed

- `/analyze` is now positioned as the deep-research option instead of the first suggested prompt: GUI empty-state cards, the README, and docs first-prompt lists lead with fast keyless prompts and label the multi-analyst debate as a longer run.
- The router post-processor now canonicalizes camelCase slot keys to snake_case and converts one-element `symbols` slots to the scalar `symbol` slot (and vice versa) per the workflow manifest, reducing routing drift on non-Claude router models. The live router eval now diffs the routing contract only, excluding recording-model-specific internal diagnostics.
- The repo-local autoreview pipeline was hardened: over-budget diffs now split into per-file review batches instead of silently truncating, out-of-scope reviewer findings and truncation notices now appear in the report and JSON output instead of stderr only, deterministic diff signals flag recurring regression classes (unguarded GUI routes, direct provider fetches, sqlite schema bumps without migration tests, prompt/routing changes without fixtures, missing changelog) as advisories the reviewer must confirm or dismiss, the OpenCandle checklist gained diff-triggered path-to-invariant checks mined from the fix history, engine binaries resolve through hardened PATH lookup that refuses repo-local executables, every reviewer prompt carries an anti-scope-creep review policy, React Doctor is pinned to 0.6.2 with diff-scoped scanning, `npm run review:pr` now also gates on `biome ci`, and the calibration harness gained a GUI trust-boundary fixture pair.
- README and System Architecture docs now include the OpenCandle architecture diagram, with editable Excalidraw source and transparent PNG assets checked into the repo.
- Public docs now link external resources on first mention per page: data providers (Yahoo Finance, FRED, SEC EDGAR, CoinGecko, TradingView, Alpha Vantage, Brave, Exa, Finnhub, DuckDuckGo, alternative.me), the `rdt-cli` and `twitter-cli` sentiment CLIs, and project tooling such as Pi, Node.js, Vitest, TypeScript, Biome, Typebox, Tailscale, and `better-sqlite3` across the docs pages, CONTRIBUTING, and SECURITY.
- The public site now shares one navigation shell: the same sticky navbar on the homepage and every docs page, a docs sidebar under it on desktop, and a bottom drawer behind the navbar hamburger on mobile (replacing the old "Docs navigation" dropdown). The homepage was rebuilt to answer why OpenCandle exists: a claim-first hero with install commands, the evidence receipt behind a sample answer, a chatbot comparison, a GUI tour, and a builder section with a typed-tool code sample. Docs prose, tables, and lists follow the GUI's typography and table styling.
- Docs navigation is now ordered as a first-time visitor's journey (Start here, Guides, Reference, Build, Project) with plain-language labels such as "Why OpenCandle" and "Terminal (TUI)", the docs overview page was condensed into a scannable map, and homepage and docs copy and spacing were tightened for less density. URLs are unchanged.
- Docs markdown can now embed images from `docs/images/`: the site build copies them, styles them, and rewrites markdown-mirror and llms-full.txt references to absolute URLs. The GUI Quickstart page shows the workbench screenshot as the first example.
- The public homepage now leads with the product claim and answers pre-install questions directly: a bring-your-own-model note, the evidence breakdown behind a sample answer, a visible MIT/Node/OS requirements line, a current-version badge, and a ChatGPT-differentiation FAQ.
- Public docs were consolidated: the standalone ChatGPT and spreadsheet comparison pages merged into one Comparisons page, the benchmarking page merged into Testing and Evals, System Architecture links to the data-sources and configuration pages instead of duplicating their tables, and docs navigation now separates user pages from contributor pages.

### Fixed

- Docs pages that were merged away in the docs consolidation (`/docs/benchmarking.html`, `/docs/opencandle-vs-chatgpt.html`, `/docs/opencandle-vs-spreadsheets.html`) now serve noindex redirect stubs pointing at their new sections instead of returning 404 for previously published links, with matching markdown-mirror pointers.
- GUI catalog tool forms now render nullable numeric schema fields, such as watchlist target and stop prices, as numeric controls instead of sending them as strings.
- Daily watchlist reports no longer ship internal scaffolding text: the placeholder "Technical snapshot … deferred" section is omitted until a real section builder exists, and manual report runs no longer auto-create an enabled morning schedule template as a side effect — schedules are stored only through the explicit configure flow and run while OpenCandle is open.
- `backtest_strategy` no longer fills trades at the same close used to compute the signal: signals now fill at the next bar's open, a flat per-side cost (default 5 bps, `cost_bps` parameter) applies to every fill, final-bar signals are reported as pending instead of phantom trades, and the output states its execution assumptions and limitations (no dividends, taxes, slippage model, or liquidity modeling).
- `compute_dcf` no longer emits fabricated per-share values: it refuses with an explicit message when shares outstanding cannot be derived (instead of assuming 1 share), passes net debt through signed so cash-rich companies get their net cash added to equity value (instead of clamping to zero), and rejects terminal growth at or above the discount rate before computing (with a Yahoo quote market-cap fallback when the Alpha Vantage overview is unavailable). A TUI harness e2e (`npm run test:e2e:harness-dcf`) drives a natural DCF prompt end to end.
- The GUI catalog payload no longer serializes saved provider API keys to the browser; configured providers report status plus a masked hint, and the provider form offers a replace-only key input instead of prefilling the saved secret into the DOM.
- GUI catalog tool forms are now generated from each tool's served parameter schema instead of a hand-written form map, removing stale entries for renamed tools (`calculate_dcf`, `manage_portfolio`, `watchlist`) and an orphaned `predict_returns` form that had no backend tool.
- `.env` files no longer override environment variables that are already exported in the shell, matching conventional dotenv precedence.
- Docs now enumerate the `/connect` provider/category targets and mark one model provider as required instead of listing all model keys as optional.
- DESIGN.md and DESIGN.json now name `packages/ui` as the normative token/primitive source and match the shipped button, badge, page-width, and typography metrics instead of retired aspirational values.
- GUI/TUI session coordination now uses authenticated local forwarding, session-scoped action IDs, neutral syncing/unavailable language, and verified Browser screenshots instead of exposing writer/follower ownership to users.
- GUI model setup now keeps the composer usable for drafting while setup is incomplete and disables model setup controls with neutral availability language when setup changes are unavailable in this window.
- The GUI now retries a stale session connection as soon as the browser returns to the foreground instead of leaving editing disabled behind the reconnect banner.
- Pending session action records now keep their original timestamps across store writes, so actions left behind by a crashed writer expire after the retry window instead of blocking resubmission indefinitely.
- GUI state snapshots now refresh session coordination, so ask-user and tool controls disable promptly when another window takes over the session mid-run instead of waiting for a full reconnect.

## [0.10.0] - 2026-06-27

## [0.9.0] - 2026-06-26

### Added

- GUI chat sessions now run independently by route session id, so a prompt can be sent in one browser session while another session is still waiting or streaming.

### Changed

- Development and GUI dependencies were refreshed to current releases, including the Pi runtime stack, React 19, Vite 8, Vitest 4, Biome 2, and Tailwind 4.
- The GUI chat route now renders a skeleton while session data is loading instead of briefly showing the home prompt or old conversation content.

### Fixed

- Plain-language comparison prompts that say "call out" risks no longer get misclassified as options call requests in rules-mode or LLM-router postprocessing.
- GUI session replay now marks interrupted tool-use turns as failed instead of leaving historical threads permanently loading when tool results were never persisted.
- GUI navigation no longer depends on one browser-wide active session, fixing route flicker, stale New Chat content, old-session home fallbacks, and "active session changed before your message was sent" errors.
- GUI Tailwind 4 builds now use the v4 CSS entrypoint, restoring spacing utilities so sidebar rows, buttons, chat content, and the composer keep their intended density.

## [0.8.0] - 2026-06-22

### Added

- `opencandle doctor` now emits a shared CLI/GUI health report covering runtime, local state, model readiness, provider readiness, optional social sessions, GUI reachability, JSON output, and remediation guidance; the GUI exposes the same report on a new Diagnostics page.
- Release readiness gates now include docs-site builds, public-doc link checks, packed tarball install smoke tests, tag/version publish validation, Dependabot, CODEOWNERS, and a local `release:check` preflight before version/tag mutation.
- Package-content validation now parses `npm pack --dry-run --json`, blocks internal/generated artifact paths, and is shared by CI, release checks, and local publish dry runs.

### Changed

- OpenCandle now requires Node.js `>=22.19.0 <27`, matching the upgraded Pi runtime dependency stack.
- Public README/docs links and package metadata now target public URLs that work from npm, and tracked dogfood/design artifacts were removed from the release tree.
- Release scripts now require current `main`, fetch tags before mutation, reject duplicate release tags, and run the full release gate for local publish paths.
- The completed generated plan backlog now lives under an archived OpenSpec change, with the GUI server decomposition and prompt-layer consolidation plans finished and recorded there.

### Fixed

- Twitter/X and Reddit sentiment setup now discovers uv-installed `twitter` and `rdt` shims in user bin directories even when OpenCandle was launched from an environment whose `PATH` has not yet picked up `~/.local/bin`.
- Existing saved-portfolio exposure reviews such as "does my current portfolio look too exposed if rates stay high" now route through the portfolio-review agent path instead of the portfolio-builder workflow, preserving saved portfolio/watchlist/prediction context in competitive evals and normal finance fallback turns.
- Runtime Pi dependencies and Vite were upgraded to clear npm audit advisories, and the installed `opencandle` entrypoint now runs the native `better-sqlite3` guard before loading the main CLI.
- GUI first-run model setup actions now work through trusted HTTP fallback when WebSockets are unavailable, while Pi sign-in remains clearly terminal-only.
- GUI startup now loads `.env` before GUI/monitor command dispatch, and the chat composer stays disabled until model setup is ready.
- Credential e2e setup now accepts both `GEMINI_API_KEY` and `GOOGLE_API_KEY` for Google model credentials.
- Security, contributor, setup, API-stability, and AI-readable website docs now call out public redaction rules, validation gates, GUI versus terminal model setup support, and stable add-on API boundaries.

## [0.7.0] - 2026-06-17

### Changed

- Twitter/X sentiment now uses the external `twitter-cli` command with the user's normal browser session, and Yahoo options fallback now uses `yahoo-finance2`; Camoufox and the old Twitter scraper are no longer runtime dependencies. `opencandle doctor` and the GUI provider panel now report API-key, public HTTP, and external-tool provider readiness.
- Reddit sentiment now uses the external `rdt-cli` command with the user's normal Reddit browser session instead of unauthenticated public `.json` endpoints, with TUI/GUI setup prompts for install, login, continue-after-setup retry, saved skip preferences, and re-enable flows.
- Twitter, Reddit, web/news, and aggregate sentiment outputs now include explainable source coverage, confidence, bullish/bearish drivers, caveats, and representative source evidence in both TUI text and GUI cards.
- Reddit sentiment scores, bullish counts, and bearish counts now include fetched comment evidence so the numeric result matches the explainable insight sample.

### Fixed

- GitHub Actions workflows now use Node 24-compatible first-party action majors, clearing the hosted-runner Node 20 deprecation warning.
- One-time Twitter/X and Reddit setup skips no longer get tagged as saved "never ask" choices, so final answers can still show setup remediation on later requests.
- Aggregate sentiment summaries no longer expose nested setup control tags when another source returns data, and subreddit-qualified Reddit queries keep matching posts from that subreddit.
- Reddit session diagnostics now treat `rdt status --json` responses with `authenticated: false` as missing-session setup work instead of ready status.
- Twitter/X and Reddit CLI wrappers now preserve structured JSON error messages from non-zero exits so setup prompts can recognize missing or stale browser sessions.

## [0.6.0] - 2026-06-13

### Added

- LLM-summarized session titles: after the first completed user/assistant exchange, the session is renamed with a short model-written title (GUI sidebar and TUI session list), replacing the raw first-prompt placeholder. Manual renames are left alone, each session is titled at most once per process, and model failures keep the placeholder while recording an `opencandle-title-error` entry.
- Competitive benchmark saved-state mode: `OPENCANDLE_COMPETITIVE_SEED_STATE=1` seeds a deterministic portfolio/watchlist/prediction fixture into the eval home, steers generated prompts toward "my portfolio" phrasing, shares the same facts with generic baseline agents for fairness, and instructs the judge to verify personalization against the saved state.

- Saved watchlist, portfolio, alert, daily-report, and prediction state is now summarized into agent prompt context, so broad sector or theme prompts can connect back to relevant saved positions such as ASTS.
- Keyless TradingView scanner provider with the `screen_stocks` tool for breadth/screening prompts and TradingView batch quote support for watchlist checks, including delayed/unofficial-data caveats and Yahoo fallback for unresolved rows.
- Local market automation runtime pieces for V2: `opencandle monitor`, alert provider-budget backoff, resume/late alert labeling, lost-run maintenance, webhook notification delivery attempts, and TUI-visible alert runner status.
- Repo-local autoreview skill and `npm run review:pr` helper for OpenCandle-specific PR review, including first-parent diff handling for already-merged PRs.
- Repo-local autoreview now runs React Doctor for changed GUI React files, includes the structured diagnostics in review evidence, and fails UI reviews on React Doctor errors by default.
- Repo-local autoreview gate hardening: `npm run review:pr` now auto-detects the PR base branch via `gh` instead of assuming `origin/main`, gates on typecheck and unit tests run in parallel with the review, pins React Doctor to a fixed version, and warns when an oversized diff is truncated from the review bundle.
- Repo-local autoreview now supports explicit commit-to-commit range reviews with `--mode range --base <commit> --head <commit>`.

### Changed

- GUI market-state pages were redesigned around symbol-centric layouts: the watchlist is a master-detail view with a symbol inspector (quote, stop→target range, thesis, position, alerts, predictions), the portfolio gets a total-value header with today/all-time deltas, an allocation bar, and chevron-expandable per-symbol lot ledgers, alerts render as plain-English sentence rules with a status log, predictions get a scorecard with progress-to-target bars, and reports render the latest report as a document with a history rail.
- GUI market-state pages are now mobile-first: no document-level horizontal overflow, tables fold secondary columns behind sm/md breakpoints (lot details and actions inline on phones), and create/edit panels present as a bottom sheet with scrim on small screens.
- GUI market-state forms gained visible labels, bordered text areas, a direction select for predictions, condition-aware alert fields with plain-English copy, a report schedule time picker, and two-step inline confirmation on destructive remove/cancel actions.
- GUI quote refreshes now happen automatically in the background: the server keeps a stale-while-revalidate quote snapshot that survives page reloads, the client polls it, and the manual Refresh/Refresh prices buttons were removed in favor of an "Updated Xm ago" freshness line.
- The predictions surface is now consistently named "Predictions" in the GUI (previously "Thesis Tracker" on the page itself).
- Daily report runs now persist the full report text in the stored run summary so the GUI can render past reports without regenerating them.
- Docs site and DESIGN.md now follow the GUI's minimal shadcn design language (Inter, zinc neutrals, near-black actions, neutral shadows), replacing the DM Sans/slate docs-only theme; DESIGN.md documents the GUI tokens as the normative source with a DESIGN.json sidecar.
- Removed deprecated `WorkflowPlan` workflow wrappers (`buildPortfolioWorkflow`, `buildCompareAssetsWorkflow`, and `buildOptionsScreenerWorkflow`) from `opencandle/workflows`; use the `*WorkflowDefinition` builders instead.

### Fixed

- CI lint/format drift from the market-state, catalog, memory, onboarding, provider, prompt, and test changes is now resolved so Biome passes in GitHub Actions.
- OpenCandle now creates and repairs `~/.opencandle` with owner-only permissions and writes `config.json` as `0600`, reducing local exposure of saved provider credentials.
- Alert checks now fetch Yahoo fallback quotes concurrently after TradingView misses, while preserving per-symbol unavailable reasons and provider-budget backoff for later runs.
- Portfolio lot storage now rejects non-positive or non-finite quantity/cost values, and portfolio, prediction, risk, and backtest math now avoid non-finite results from zero price/cost history.
- Budget extraction no longer treats position values, dividends, gains/losses, or trading prices as investment budgets.
- The GUI private market-state API now requires loopback callers by default, exposes an explicit remote opt-in for intentional LAN/Tailscale use, and rejects unsafe notification webhook URL schemes and link-local metadata hosts.
- Sentiment and web-search tool outputs now escape, delimit, and label third-party text as untrusted data before it enters assistant-visible context.
- Production dependency audit findings in transitive packages have been cleared with semver-compatible lockfile updates.
- Biome now provides the repo lint/format baseline, with lint checks wired into CI.
- Prompt output snapshots now pin workflow prompt builders, policy-card rendering, and representative context-builder assemblies before any future prompt consolidation.
- GUI server orchestration is split into focused quote-poller, automation-heartbeat, model-setup, tool-invocation, session-action, and WebSocket hub services while preserving writer-lock and broadcast behavior.
- GUI market-state mutations now invalidate the server quote snapshot and immediately refresh quotes in the browser after the mutation is acknowledged.
- SEC filing evidence snippets are now labeled and escaped as untrusted external content before reaching assistant-visible tool output.
- Watchlist edit forms can now clear target, stop, thesis, notes, and tags instead of preserving stale values when fields are blanked.
- Prediction-only symbols now receive GUI quote snapshots, so open predictions show current price and target progress even when the symbol is not also in a watchlist or portfolio.
- Rejected notification webhook URLs now record failed delivery attempts so the automation runner keeps delivery history and rotates pending retries fairly.
- The default SQLite state database now initializes through the hardened OpenCandle home directory path so fresh `~/.opencandle` state starts owner-only.
- GUI React state synchronization patterns were tightened so React Doctor no longer reports error-level diagnostics for the changed GUI files.
- The Codex Graphify skill now merges inline worker JSON results instead of looking for Claude-style disk chunk files.
- Budget extraction now rejects non-budget k-notation amounts such as P&L or position-value phrases instead of treating them as deployable capital.
- GUI WebSocket upgrades now use the same trusted-session checks as private HTTP APIs, and orphaned tool-result rows no longer crash chat grouping.
- GUI chat-run POST requests now require the same trusted browser-session checks as other private GUI control surfaces.
- GUI bootstrap and session APIs now require trusted browser-session checks before returning transcript or session metadata.
- Codex and Claude Graphify skill snippets now handle code-only runs without semantic extraction files and preserve `--directed` graph builds through report regeneration.
- GUI chat transcript rendering now uses one event-driven path for both live and reloaded sessions: persisted `SessionEntry[]` is adapted to `ChatEvent[]` on the server, live SSE events are merged at the browser boundary, and `ChatPanel` renders event-derived rows so workflow-dispatched user bubbles keep the user's original typed words after reload instead of exposing internal prompt expansions.
- GUI home composer sends can no longer append to the previous writer session: home sends now await a fresh session before running, the chat run request carries the expected session id, and the server rejects mismatched runs with a `session_changed` 409 (retried once against another fresh session). GUI server JSON error responses also return their intended HTTP status codes instead of always 200.
- GUI chat now shows the user's original words for workflow-dispatched turns instead of the internal prompt expansion: the extension records the typed input alongside the transform, the chat transcript and live stream render it, and new sessions are titled by it.
- Workflow chat turns (options screeners, comparisons, portfolio builds) now carry the saved market-state context, so prompts like a covered-call question about an owned position use the stored lot's cost basis instead of ignoring it.
- Competitive benchmark judging now validates the winner against the allowed set (case-normalized) so summaries cannot misattribute wins, and anchors judge scores on a defined 0-10 rubric.
- Prediction checks now flag open calls whose target price was reached before expiry ("target hit … resolve or let it ride") while keeping them open, matching the GUI's target-hit badge.
- Manual alert check output now states the observed value versus the rule threshold, the condition result, the source provider, and any data-delay caveat instead of a bare "checked"/"seeded" label.
- The GUI prediction form and displays now use the tool's canonical 1–10 conviction scale (previously labeled 0–1, which skewed conviction-weighted accuracy).
- The agent test harness (`tests/harness/cli.ts`) now respects a caller-provided `OPENCANDLE_HOME` instead of always redirecting to a disposable temp home and deleting it on exit, so documented manual runs can exercise real local state.
- Saved portfolio/watchlist context now reaches rules-mode chat turns: finance-shaped prompts that match no workflow (for example sector or IPO theme questions about companies without tickers) record a fallback turn, carry the saved market-state context, and instruct a "Your positions" impact section connecting the answer back to saved holdings; non-finance prompts remain excluded.
- SQLite schema migrations from v3/v4 no longer crash on startup when `alert_events` exists without the v7 `dedupe_key` column; the column is added before the unique dedupe index is created.
- Tool/provider guardrails now return clear alert not-found results, validate finite and bounded tool parameters earlier, expose planned percent-move/SMA-cross alert checks, and surface Yahoo/SEC evidence-fetch failures with timeout/rate-limit hygiene, including a configured `sec_edgar` rate-limit bucket so SEC document fetches are actually paced.
- Indicator alert lookback periods (SMA-cross slow leg, price-SMA, RSI, volume spike) are now bounded to what the alert runner's daily history window can evaluate, so stored alerts cannot remain permanently unavailable.
- Alpha Vantage `ytd` history fallback now filters bars by calendar date instead of an estimated trading-day count, so year-to-date requests no longer include prior-year bars.
- Portfolio lot add prompts with cost basis and currency now route to stateful tracking instead of being misread as asset comparisons or portfolio construction.
- Combined alert prompts such as “create this alert, then check it now” now run the immediate manual check instead of stopping after alert creation.
- Router symbol extraction now drops bare finance acronyms such as IV, SEC, FED, and CPI unless the user provides a direct ticker signal such as `$IV` or `IV ticker`.
- Rules-mode compare prompts now clarify instead of passing the raw prompt through when acronym disambiguation leaves fewer than two valid symbols.
- Portfolio row removal now targets the selected SQLite lot id instead of removing every lot for that symbol.
- Prediction checks now keep expired predictions open when quotes are temporarily unavailable, so they can be scored on a later successful check.
- Mastercard's `MA` ticker now survives plain ticker comparisons while moving-average/M&A wording remains filtered as non-ticker usage.
- Portfolio adds now preserve provider quote currency and require explicit currency when a resolver cannot determine it, avoiding silent USD aggregation for foreign listings.
- LLM-router acronym drops now also filter router slot symbols so dropped tokens cannot be reintroduced during workflow dispatch.
- GUI market-state polling now preserves refreshed quote/P&L snapshots until a newer quote snapshot replaces them.
- Prediction checks now treat stale cached quotes and zero-filled quote payloads as unavailable so expired predictions remain retryable until fresh data is available.
- GUI instrument autocomplete now returns an empty candidate response on provider search failure instead of leaving the request unresolved.
- Watchlist row alert shortcuts now require a saved target price and no longer create price-above-zero alerts.
- Portfolio updates now require a lot id so same-symbol tax lots are not rewritten by a symbol-only update.
- Portfolio views now avoid row-level value/P&L math when quote currency and lot currency differ without FX conversion.
- GUI portfolio edits now clear stale quote-derived P&L rows and summary totals until quotes are refreshed.
- GUI financial number fields now allow decimal values.
- Instrument-scoped alert creation now resolves symbols without adding them to the default watchlist as a side effect.
- Manual alert checks now persist trigger events conditionally with the observed rule state, suppressing duplicate events from concurrent checks.
- Manual alert checks now persist unavailable/stale provider checks as durable alert events without overwriting the last valid observation.
- Yahoo sparse zero-result quote responses now surface as invalid-symbol unavailable results instead of successful `$0.00` quotes.
- Compare workflows now preflight candidate tickers through resolver search, drop unknown symbols with trace entries, and abort to clarification when too few valid symbols remain.
- Rules-mode compare preflight aborts now preserve clarification context instead of falling through to the raw prompt.
- Saved market-state prompt context is now gated to finance/market-state turns so unrelated pass-through prompts do not receive local portfolio or watchlist data.
- LLM-router acronym drops now sanitize matching symbol slots before missing-slot checks, preventing dropped tokens from reappearing in fallback context.
- Routed core-market tool bundles now include alert and daily-report tools under tool-scope enforcement.
- Yahoo instrument search now uses the shared cache and Yahoo rate limiter for autocomplete and workflow preflight.
- Workflow symbol preflight now preserves user-provided symbols during resolver outages instead of treating provider failures as unknown tickers.
- Correlation analysis now computes over the remaining valid symbols when one history fetch fails and reports dropped symbols instead of failing the whole matrix.
- Router mode remains on the `rules` default because the live LLM-router acceptance gate could not be run with credentials; use `OPENCANDLE_ROUTER_MODE=llm` to opt in.
- TUI daily report requests now expose exact `daily_watchlist_report` action literals, steering report-history prompts to `history` instead of invalid `list` or `show_history` actions.
- Manual daily report runs now link to the default watchlist report template and update its latest-run timestamp.
- TUI alert requests now expose exact `manage_alerts` action literals and natural-language mappings, so the agent can create and enable price, SMA, RSI, and volume alerts instead of trying generic `create` or `add` actions.
- Prediction checks now keep durable resolved-history scorecards visible after all predictions have been resolved.
- Watchlist row alert creation no longer clears existing target, stop, thesis, notes, or tags on the saved watchlist item.
- `screen_stocks` now accepts natural screener prompt aliases such as `gte`, `<`, `market_cap`, `change_percent`, `total_volume`, `10B`, and signed numeric strings, and returns explicit freshness/interpretation guidance for screened candidates.
- `screen_stocks` now accepts uppercase `ASC`/`DESC` sort directions and uppercase comparison aliases before tool validation, matching common LLM-generated screener calls.
- `search_ticker` now falls back to the keyless TradingView stock scanner when Yahoo search is rate-limited or empty, while preserving Yahoo-shaped quote results for existing consumers.
- Yahoo fund holdings parsing now accepts live quoteSummary `{ raw, fmt }` numeric weights and retries quoteSummary with Yahoo crumb auth after 401/429 responses, so ETF overlap analysis is less likely to drop valid holdings.
- Generic macro or portfolio hedge prompts no longer receive options-strategy policy guidance unless the prompt explicitly asks for options or put hedges.
- Long-horizon ETF/fund comparison prompts now preserve the user's budget, probe holdings overlap when applicable, and call out tax, role/style, and fund-fact verification gaps without inventing unavailable holdings or expense data.
- Local GUI shutdown now exits cleanly from a single `Ctrl+C` by closing browser connections before waiting on the HTTP server.
- Local GUI React modules now keep component exports separate from helper exports, clear React Doctor error diagnostics, and preserve catalog builder hook order.
- GUI market-state pages now share the main app shell sidebar and mobile drawer navigation without pinning the page actions or duplicate top tab strip.
- GUI market-state mutations now wait for acknowledged tool results, surface toast errors and read-only connection states, and improve ticker search and tool-drawer accessibility.
- Mobile GUI tool timelines no longer lock or cover the page after refreshing restored provider/tool-run state.
- Mobile GUI home refreshes no longer leave the empty chat composer disabled while starting a fresh session.
- GUI rich-text rendering now treats level-four markdown headings and horizontal rules as semantic `<h4>` and `<hr>` elements.
- Published docs site now exposes AI-readable metadata, structured data, `llms.txt`, markdown mirrors, sitemap dates, and comparison/FAQ content for AI crawlers.

## [0.5.0] - 2026-05-26

### Added

- **Layered financial request understanding** — OpenCandle now breaks user questions into traceable financial tasks, entities, clarification needs, evidence plans, tool capability gaps, and answer-shape guidance. This makes complex prompts easier to inspect, test, and improve without relying on one broad instruction surface.
- **Stronger finance answers across real retail workflows** — OpenCandle is better at ticker disambiguation, current-event questions, concept education, sentiment reads, filing reviews, asset comparisons, options, portfolio reviews, backtests, and state-tracking prompts. Answers are more direct about what evidence was gathered, what is missing, and what risks could change the conclusion.
- **GUI clarification flow** — the local browser GUI now supports `ask_user` follow-ups, including text, select, and confirm answers. Pending questions stay scoped to the active session and can be answered without leaving the GUI.
- **ETF holdings overlap analysis** — `analyze_holdings_overlap` fetches Yahoo fund holdings and computes pairwise ETF/fund overlap by weight, giving ETF diversification questions a direct holdings-based signal instead of relying only on correlation.
- **Quality and parity evaluation harnesses** — OpenCandle now has in-process session replay, competitive finance benchmarking, semantic answer checks, and product scorecards that compare OpenCandle against generic no-tool agents and preserve evidence for regression review.
- **Newcomer documentation and docs site refresh** — README, docs, and the published site now explain OpenCandle in plain language, show a populated GUI workflow, document first-run setup, and include favicon, sitemap, and robots metadata.

### Changed

- **Evidence-first workflow selection** — prompts involving sentiment, filings, macro context, options, holdings, ETF overlap, and portfolio risk now route toward more useful evidence paths before synthesis.
- **More practical answer framing** — educational, portfolio, options, and single-asset prompts now favor decision frameworks, confidence bands, invalidation levels, and explicit downside risks over generic market commentary.
- **Better macro and portfolio interpretation** — macro, rates, regional housing, mortgage-vs-investing, and allocation prompts now turn raw series into rates, trends, tradeoffs, and caveats that are easier to act on.
- **Portable competitive benchmarking** — eval and benchmark tooling is easier to run across machines, handles missing competitors more gracefully, and records skipped baselines separately from OpenCandle quality failures.
- **Open-source release hygiene** — package metadata, docs, archived examples, and release-facing copy were cleaned up for public consumption.

### Fixed

- GUI chat submissions now show the user's message immediately, then the working indicator, then the streamed response.
- Ambiguous or unverified tickers now trigger clearer clarification and risk-framework behavior instead of invented facts.
- SEC filing lookups now resolve common tickers more reliably, filter results to the requested company, and avoid text-search decoys.
- Options and covered-call outputs now preserve owned-underlying context, natural-language horizons, cost basis, stale quote caveats, full Greeks, and correct per-share versus per-contract pricing language.
- Existing-holdings and portfolio prompts now respect explicit time horizons, ETF-focused scope, and crash-protection intent.
- Retail-investor prompts now handle brokerage selection, ETF overlap, crypto sizing, market-closed movement questions, and mortgage-vs-investing tradeoffs with more direct guidance.
- Product replay and competitive-judge tooling now have stronger timeouts and JSON repair paths, reducing flaky eval failures during release validation.

## [0.4.0] - 2026-05-16

### Added

- **Local GUI preview** — `npm run gui` starts a 127.0.0.1 browser workbench with sessions, chat, dashboard projection, tool/workflow/provider catalog, slash palette, UI-driven tool invocation persisted into Pi session history, tool defaults storage, and writer-lock based follower protection. The implementation uses current Pi APIs directly and avoids unsupported `pi-web-ui` assumptions. See `openspec/changes/archive/2026-06-10-add-local-gui/`.
- **Chat-first React GUI revamp** — the local GUI now uses a Tailwind/Vite React app with llmchat-inspired reusable primitives under `gui/web/src/components/ui/`, composable chat pieces under `gui/web/src/components/chat/`, first-class tool result renderers, mobile session history, onboarding for missing model keys, stop/retry/copy controls, and browser smoke coverage. See `openspec/changes/archive/2026-06-10-revamp-local-gui/`.
- **Packaged GUI entrypoint** — installed packages can start the local GUI with `opencandle gui`; release preparation now builds and packages the Vite GUI bundle, GUI server, shared GUI event types, and local logo asset instead of leaving the GUI as checkout-only source.
- **Multi-turn request context + harness observability** — request understanding now receives the last 5 prior user/assistant turns from the active session branch, enabling coreference resolution on follow-ups like "what about at $500?". Live verified end-to-end: a two-turn session (`tell me about NVDA` -> `what about at $500?`) produces a turn-2 `opencandle-router` entry whose `entities.symbols=["NVDA"]`, carried entirely from turn 1's prior turns. Separately, `tests/harness/manual-run.ts` now captures every `opencandle-*` custom session entry into `trace.json.customEntries` after settle, so request/workflow/disclaimer decisions are inspectable without inferring from main-agent output. Six synthetic multi-turn fixtures added (013-018) covering coreference, carried-context, topic-shift, correction, preference-conflict, and dollar-phrase-preservation classes. Prior-turn-derived entity values land in `entities` not `slots` to preserve the settled `user | preference | default` provenance enum. Compaction and branch-summary entries are skipped during prior-turn extraction. Privacy note: `priorTurns` is not filtered by `NEVER_TRUST_FROM_MEMORY`; a future `/forget` command is the designated scrubbing primitive.
- **Research-analyst stance** — system and workflow prompts rewritten to commit to specific numbers (entry zones, price targets, stops, allocations) with reasoning chain, confidence band, and invalidation level. Refusal-shaped hedges ("I cannot provide financial advice", "consult a qualified advisor") are explicitly forbidden. Analyst framing ("our read", "the data suggests") replaces fiduciary framing everywhere. Stance is universal — injected on every turn for every workflow and fallback path. See `openspec/changes/honest-analyst-stance/`.
- **Disclaimer surfaced outside LLM instruction context** — user-visible disclaimer text lives in `src/prompts/disclaimer.ts` and surfaces via Pi's `setStatus` pinned footer plus per-turn `appendEntry("opencandle-disclaimer", ...)`. Never enters the model's instruction context, so it no longer steers behavior toward refusal.
- **Structured request understanding** — OpenCandle emits structured task, entity, slot, preference, and missing-required information so the main agent can ask focused `ask_user` follow-ups when needed.
- **General finance context** — broad finance questions receive tool-first guidance and missing-slot handling even when they do not use a named workflow.
- **Shared Assumptions-block renderer** — `buildAssumptionsBlockFromRouter` converts request slots to the canonical provenance-labeled block (`User-specified` / `From saved preferences` / `Defaults`), consistent across workflow and general finance routes.
- **Request-turn observability** — each request-understanding output is persisted as an `opencandle-router` session entry; dropped low/medium-confidence preference extractions are logged as `opencandle-router-prefs-dropped`.
- **Request-understanding eval infrastructure** — 12 deterministic fixtures in `tests/fixtures/router/` (expected output recorded for CI), plus `npm run eval -- router-live` for opt-in live verification against the real model. CI gates on 100% deterministic pass-rate.

### Changed

- **Workflow prompt directives** — `buildPortfolioPrompt`, `buildOptionsScreenerPrompt`, `buildCompareAssetsPrompt`, and `buildPortfolioWorkflowDefinition`'s synthesize step no longer inject "include the standard disclaimer" / "End with the standard disclaimer" / "educational sample … instead of refusing" language. Disclaimer surface is handled by the harness-level mechanism above.
- **`workflow_runs` schema bumped to v3** — additive `ALTER TABLE` adds `turn_type TEXT NOT NULL DEFAULT 'workflow'` column. Legacy rows default to `"workflow"`; fallback turns record `turn_type = "fallback"` with `workflow_type = "fallback"` sentinel. `resetSchema` path retained only for non-v2→v3 mismatches; no data loss on upgrade.
- **`options_screener` rank step** — now explicitly requires a final text response even when `get_option_chain` returns a partial-unavailable sentinel. Previously the agent could exit with only tool calls after a fetch failure.
- **Harness settle grace** — `tests/harness/manual-run.ts` applies the 30s multi-step grace to `options_screener`, `portfolio_builder`, and `compare_assets` in addition to `/analyze`, so between-step tool latency no longer truncates traces before synthesis completes.
- **GUI session runtime** — browser sessions now use Pi's shared session runtime, model registry, auth storage, and settings manager so GUI model selection, provider keys, session rename/delete, and TUI resume state stay synchronized with Pi.

### Fixed

- Local GUI brand assets now serve SVGs with `image/svg+xml`, so the OpenCandle logo renders in browsers instead of as a broken image.
- GUI markdown rendering, user/assistant typography, mobile drawer chrome, and session search now match the llmchat-inspired compact chat layout more closely.
- GUI background quote refreshes no longer append synthetic quote-refresh entries into persistent Pi session history.
- GUI writer locks now require a live PID plus a fresh heartbeat before treating another process as the active writer.
- Router preference-update normalization — an explicit non-`"inferred"` source on a `preference_updates` entry now throws an invariant-violation error instead of being silently overwritten.
- Non-primitive router slot values (arrays, plain objects) render readably in the Assumptions block (`"AAPL, MSFT"` instead of `"AAPL,MSFT"`; `{"min":60,"max":80}` instead of `"[object Object]"`).
- Structured input handling returns `{action: "handled"}` on workflow dispatch so Pi does not double-process the user turn alongside the workflow runner; general finance turns return `undefined` so the main agent still runs with the supplied context.
- Dropped medium/low-confidence preference extractions emit the observability entry even when no storage is available.

## [0.3.0] - 2026-04-20

### Added

- **Conversational provider setup** — first-run onboarding flow that discovers missing provider credentials conversationally, prompts in-chat, and degrades gracefully when keys are declined. Adds credential interceptor, degradation accumulator, provider registry, tool-tagging, and `ProviderCredentialError` handling across Alpha Vantage, FRED, Finnhub, Exa, and web search providers.
- **Exa search provider** — `exa-search` provider (API + MCP transport) for high-quality neural web search, wired into `web_search` as an upgrade path alongside DuckDuckGo/Brave.
- **Finnhub company news source** — `finnhub` provider and sentiment adapter surfacing company-specific news into the unified sentiment pipeline and `get_sentiment_summary`.
- **Web search tool** — `web_search` with DuckDuckGo/Brave cascade for general market news and context lookups.
- **Unified sentiment pipeline** — cross-source sentiment analysis aggregating Reddit, Twitter, and web signals with normalized scoring and trend tracking.

### Fixed

- Literal type for `content.type` in sentiment-trend tool.

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
