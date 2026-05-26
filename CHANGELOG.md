# Changelog

## [Unreleased]

### Added

- **Scoped improvement guardrails** — competitive-regression docs and a local unit guard now steer future fixes toward the narrowest durable layer: task selection, entity extraction, tool capability, evidence clarity, answer shape, structured checks, eval assertions, or harness behavior.
- **Traceable finance answer framework** — OpenCandle now records task family, answer intent, evidence-plan IDs, capability gaps, diagnostics, and structured-check results in traces so reviewers can see why a run chose its evidence path and answer shape.
- **Finance-specific answer guidance** — ticker disambiguation, current events, concept education, sentiment, filings, retail tradeoffs, asset comparison, single-asset decisions, macro allocation, options, portfolio review, backtests, and state-tracking prompts now have scoped answer guidance and test coverage.
- **Competitive quality evidence** — reference replay reports, product scorecards, semantic answer checks, and competitive benchmark summaries make OpenCandle's finance-agent quality measurable without baking one-off prompt text into production behavior.
- **ETF holdings overlap tool** — `analyze_holdings_overlap` fetches Yahoo fund top-holdings data and computes pairwise ETF/fund overlap by weight, giving portfolio and ETF comparison prompts a provider-backed alternative to generic correlation-only overlap checks.
- **ETF overlap workflow coverage** — asset-comparison prompts now use holdings-overlap evidence for ETF/fund diversification checks before relying on correlation-only evidence.
- **Product eval hardening** — product eval scoring now recognizes commitment-led portfolio answers, 30-day/next-month options horizons, incomplete/caution sentiment risk framing, family-aware output shapes, and unregistered hard assertions.
- **Competitive finance benchmark loop** — `npm run test:evals:competitive` compares OpenCandle against generic no-tool Claude, Codex, and Gemini baselines through `acpx`, generates broad finance prompts at runtime, supports fixed-prompt reruns, judges results with a configured model, and writes ignored JSON reports under `tests/evals/runs/`. The loop is documented in `docs/internal/competitive-benchmarking.md`, including the iteration pattern for turning generic-agent wins or OC quality gaps into targeted product fixes.
- **Shared in-process OpenCandle test harness** — `tests/harness/opencandle-runner.ts` runs OpenCandle sessions without driving the TTY, captures tool calls, `ask_user` interactions, workflow/request-understanding entries, and eval traces, and is now reused by eval suites and the competitive benchmark runner.
- **GUI `ask_user` bridge** — the local GUI now renders pending clarification prompts, accepts text/select/confirm answers, supports cancellation, scopes prompts to the active session, and broadcasts prompt state to connected browser clients.
- **Session helpers for the GUI** — browser routes now hide stale transcript entries during session switches, start a fresh home session when appropriate, and keep pending `ask_user` prompts tied to the correct session.
- **Newcomer documentation revamp** — README, docs index, and the docs site now cover first run setup, TUI usage, GUI preview, configuration files, environment variables, benchmarking, evals, screenshots, and the difference between OpenCandle's finance-specific strengths and generic agents.
- **SEC filing evidence snippets** — SEC filing search can now include primary document URLs, 8-K item metadata, ticker-to-CIK submissions feed lookup, and short evidence snippets for filing-thesis and risk prompts.

### Changed

- **Request understanding** — OpenCandle now keeps task selection, entity extraction, clarification, tool-bundle suggestions, and answer-shape guidance traceable for review.
- **Prompt assembly diagnostics** — production prompt assembly now reports per-section lengths and prevents active non-memory section truncation across standard, workflow dispatch, clarification, pass-through, and no-tool variants.
- **Macro and portfolio handling** — macro/rates/portfolio prompts ask the agent to convert raw economic series into interpretable rates or trends and to search for direct regional macro facts before declaring data unavailable.
- **Competitive runner portability** — the benchmark runner no longer contains user-specific executable or Node paths, resolves Claude from `CLAUDE_CODE_EXECUTABLE` or `PATH`, prefers useful stdout answers over stderr diagnostics on non-zero adapter exits, and keeps unavailable baselines in `skippedCompetitors` unless `OPENCANDLE_COMPETITIVE_REQUIRE_ALL=1`.
- **Finance workflow evidence** — sentiment, backtest, rate-cut, SEC filing, bull/bear, options, compare, and owned-holdings risk prompts now land on more useful tool-backed paths. Compare workflows can request sentiment evidence; options screener output now includes full Greeks in the final table.
- **Open-source hygiene** — package metadata, license text, and archived OpenSpec examples no longer contain personal repository URLs or local home-directory paths.
- **Covered-call workflow context** — options screener prompts now preserve cost basis, owned-underlying context, catalyst tickers, natural-language DTE hints, stale quote caveats, and broker-verification guidance.

### Fixed

- Existing-holdings growth additions and crash-protection reviews now use portfolio-review behavior instead of single-asset or simple comparison behavior.
- Company/ticker mismatch hype prompts now warn that identity is unverified and give a verification checklist before discussing speculative catalysts.
- Option-chain output now labels bid/ask and last prices as per-share quotes and states the 100-share contract math.
- Retail mortgage-vs-investing guidance now uses the user's supplied debt rate instead of benchmark-specific wording.
- Ambiguous ticker event-risk prompts now accept an `ask_user` clarification as valid unresolved-ticker handling and continue with a risk framework when the symbol cannot be verified.
- Product replay subprocesses now have a bounded timeout, preventing stale eval processes from hanging comparison and worktree cleanup indefinitely.
- Exact SEC filing lookups now filter EDGAR search results to the requested company, resolve common tickers through the SEC submissions feed, and avoid text-search decoys.
- Covered-call recommendations no longer use long-call premium-paid max-loss framing; weekly and `1-2 week` horizons normalize to 7-to-14-day expirations, and fallback guidance keeps usable candidates when option quotes are stale or incomplete.
- Portfolio slot resolution now honors ETF-focused scope and explicit multi-year horizons from the user prompt.
- GUI options follow-up prompts no longer drop gamma, theta, vega, and rho from the ranked contract table.
- Generic finance workflow selection no longer leaks benchmark-specific macro-hedge guidance, misreads lowercase asset-class or macro nouns as tickers, treats cost basis as portfolio budget, or strands the GUI home screen when HTTP fallback mode cannot issue session actions.
- Competitive Codex baseline preflight now uses the ACP adapter's advertised model id syntax by default.
- Competitive judge parsing now repairs common missing-comma JSON so benchmark runs are less likely to abort after model formatting glitches.
- Retail-investor prompts now handle brokerage selection, ETF tradeoffs/overlap, ticker aliases, unknown-ticker earnings risk, crypto position sizing, and market-closed "today" move questions with more direct guidance instead of punting or sending tradeoffs to portfolio construction.
- Task metadata now normalizes dispatchable compare workflows, keeps crypto sizing in advisory behavior instead of portfolio construction, and prefers specific sentiment, SEC filing, current-event, ticker-disambiguation, retail, and macro task families over generic single-asset metadata.

## [0.4.0] - 2026-05-16

### Added

- **Local GUI preview** — `npm run gui` starts a 127.0.0.1 browser workbench with sessions, chat, dashboard projection, tool/workflow/provider catalog, slash palette, UI-driven tool invocation persisted into Pi session history, tool defaults storage, and writer-lock based follower protection. The implementation uses current Pi APIs directly and avoids unsupported `pi-web-ui` assumptions. See `openspec/changes/add-local-gui/`.
- **Chat-first React GUI revamp** — the local GUI now uses a Tailwind/Vite React app with llmchat-inspired reusable primitives under `gui/web/src/components/ui/`, composable chat pieces under `gui/web/src/components/chat/`, first-class tool result renderers, mobile session history, onboarding for missing model keys, stop/retry/copy controls, and browser smoke coverage. See `openspec/changes/revamp-local-gui/`.
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
