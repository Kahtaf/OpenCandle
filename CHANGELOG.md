# Changelog

## [Unreleased]

### Added

- LLM-summarized session titles: after the first completed user/assistant exchange, the session is renamed with a short model-written title (GUI sidebar and TUI session list), replacing the raw first-prompt placeholder. Manual renames are left alone, each session is titled at most once per process, and model failures keep the placeholder while recording an `opencandle-title-error` entry.
- Competitive benchmark saved-state mode: `OPENCANDLE_COMPETITIVE_SEED_STATE=1` seeds a deterministic portfolio/watchlist/prediction fixture into the eval home, steers generated prompts toward "my portfolio" phrasing, shares the same facts with generic baseline agents for fairness, and instructs the judge to verify personalization against the saved state.

- Saved watchlist, portfolio, alert, daily-report, and prediction state is now summarized into agent prompt context, so broad sector or theme prompts can connect back to relevant saved positions such as ASTS.
- Keyless TradingView scanner provider with the `screen_stocks` tool for breadth/screening prompts and TradingView batch quote support for watchlist checks, including delayed/unofficial-data caveats and Yahoo fallback for unresolved rows.
- Local market automation runtime pieces for V2: `opencandle monitor`, alert provider-budget backoff, resume/late alert labeling, lost-run maintenance, webhook notification delivery attempts, and TUI-visible alert runner status.
- Repo-local autoreview skill and `npm run review:pr` helper for OpenCandle-specific PR review, including first-parent diff handling for already-merged PRs.
- Repo-local autoreview now runs React Doctor for changed GUI React files, includes the structured diagnostics in review evidence, and fails UI reviews on React Doctor errors by default.
- Repo-local autoreview gate hardening: `npm run review:pr` now auto-detects the PR base branch via `gh` instead of assuming `origin/main`, gates on typecheck and unit tests run in parallel with the review, pins React Doctor to a fixed version, and warns when an oversized diff is truncated from the review bundle.

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

- OpenCandle now creates and repairs `~/.opencandle` with owner-only permissions and writes `config.json` as `0600`, reducing local exposure of saved provider credentials.
- Alert checks now fetch Yahoo fallback quotes concurrently after TradingView misses, while preserving per-symbol unavailable reasons and provider-budget backoff for later runs.
- Budget extraction no longer treats position values, dividends, gains/losses, or trading prices as investment budgets.
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
- **Request-understanding eval infrastructure** — 12 deterministic fixtures in `tests/fixtures/router/` (expected output recorded for CI), plus `npm run eval:router-live` for opt-in live verification against the real model. CI gates on 100% deterministic pass-rate.

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
