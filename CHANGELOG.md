# Changelog

## [Unreleased]

### Added

- **Local GUI preview** — `npm run gui` starts a 127.0.0.1 browser workbench with sessions, chat, dashboard projection, tool/workflow/provider catalog, slash palette, UI-driven tool invocation persisted into Pi session history, tool defaults storage, and writer-lock based follower protection. The implementation uses current Pi APIs directly and avoids unsupported `pi-web-ui` assumptions. See `openspec/changes/add-local-gui/`.
- **Chat-first React GUI revamp** — the local GUI now uses a Tailwind/Vite React app with llmchat-inspired reusable primitives under `gui/web/src/components/ui/`, composable chat pieces under `gui/web/src/components/chat/`, first-class tool result renderers, mobile session history, onboarding for missing model keys, stop/retry/copy controls, and browser smoke coverage. See `openspec/changes/revamp-local-gui/`.
- **Router multi-turn context + harness observability** — LLM router now receives the last 5 prior user/assistant turns from the active session branch (previously passed an empty window), enabling coreference resolution on follow-ups like "what about at $500?". Live verified end-to-end: a two-turn session (`tell me about NVDA` → `what about at $500?`) produces a turn-2 `opencandle-router` entry whose `entities.symbols=["NVDA"]`, carried entirely from turn 1's priorTurns. Separately, `tests/harness/manual-run.ts` now captures every `opencandle-*` custom session entry into `trace.json.customEntries` after settle, so router/workflow/disclaimer decisions are inspectable without inferring from main-agent output. Six synthetic multi-turn fixtures added (013-018) covering coreference, carried-context, topic-shift, correction, preference-conflict, and dollar-phrase-preservation classes; BASELINE fixture count → 18. Prior-turn-derived entity values land in `entities` not `slots` to preserve the settled `user | preference | default` provenance enum (archived `llm-intent-router/design.md` Decision 8). Compaction and branch-summary entries are skipped during prior-turn extraction. Privacy note: `priorTurns` is not filtered by `NEVER_TRUST_FROM_MEMORY`; a future `/forget` command is the designated scrubbing primitive. See `openspec/changes/router-context-and-observability/`.
- **Research-analyst stance** — system and workflow prompts rewritten to commit to specific numbers (entry zones, price targets, stops, allocations) with reasoning chain, confidence band, and invalidation level. Refusal-shaped hedges ("I cannot provide financial advice", "consult a qualified advisor") are explicitly forbidden. Analyst framing ("our read", "the data suggests") replaces fiduciary framing everywhere. Stance is universal — injected on every turn for every workflow and fallback path. See `openspec/changes/honest-analyst-stance/`.
- **Disclaimer surfaced outside LLM instruction context** — user-visible disclaimer text lives in `src/prompts/disclaimer.ts` and surfaces via Pi's `setStatus` pinned footer plus per-turn `appendEntry("opencandle-disclaimer", ...)`. Never enters the model's instruction context, so it no longer steers behavior toward refusal.
- **LLM intent router** (behind `OPENCANDLE_ROUTER_MODE=llm`; default remains `rules`) — Haiku-class router emits structured JSON with `route ∈ {workflow, fallback}`, entities, slots with source provenance (`user | preference | default`), high-confidence preference updates, and `missing_required` slots for the main agent to surface via `ask_user`. Rule path retained behind the flag; a follow-up change will remove it after the flag flips. See `openspec/changes/llm-intent-router/`.
- **Fallback playbook** — dedicated prompt section rendered when the router picks `route: "fallback"`. Tool-first, commit-with-reasoning instructions with ask_user directive when required slots are missing. Composes with the universal analyst stance.
- **Shared Assumptions-block renderer** — `buildAssumptionsBlockFromRouter` converts router slots to the canonical provenance-labeled block (`User-specified` / `From saved preferences` / `Defaults`), consistent across workflow and fallback routes.
- **Router-turn observability** — each router output persisted as an `opencandle-router` session entry; dropped low/medium-confidence preference extractions logged as `opencandle-router-prefs-dropped`.
- **Router eval infrastructure** — 12 deterministic fixtures in `tests/fixtures/router/` (expected output recorded for CI), plus `npm run eval:router-live` for opt-in live verification against the real model. CI gates on 100% deterministic pass-rate.

### Changed

- **Workflow prompt directives** — `buildPortfolioPrompt`, `buildOptionsScreenerPrompt`, `buildCompareAssetsPrompt`, and `buildPortfolioWorkflowDefinition`'s synthesize step no longer inject "include the standard disclaimer" / "End with the standard disclaimer" / "educational sample … instead of refusing" language. Disclaimer surface is handled by the harness-level mechanism above.
- **`workflow_runs` schema bumped to v3** — additive `ALTER TABLE` adds `turn_type TEXT NOT NULL DEFAULT 'workflow'` column. Legacy rows default to `"workflow"`; fallback turns record `turn_type = "fallback"` with `workflow_type = "fallback"` sentinel. `resetSchema` path retained only for non-v2→v3 mismatches; no data loss on upgrade.
- **`options_screener` rank step** — now explicitly requires a final text response even when `get_option_chain` returns a partial-unavailable sentinel. Previously the agent could exit with only tool calls after a fetch failure.
- **Harness settle grace** — `tests/harness/manual-run.ts` applies the 30s multi-step grace to `options_screener`, `portfolio_builder`, and `compare_assets` in addition to `/analyze`, so between-step tool latency no longer truncates traces before synthesis completes.

### Fixed

- Router preference-update normalization — an explicit non-`"inferred"` source on a `preference_updates` entry now throws an invariant-violation error instead of being silently overwritten.
- Non-primitive router slot values (arrays, plain objects) render readably in the Assumptions block (`"AAPL, MSFT"` instead of `"AAPL,MSFT"`; `{"min":60,"max":80}` instead of `"[object Object]"`).
- LLM-mode input handler returns `{action: "handled"}` on workflow dispatch so Pi does not double-process the user turn alongside the workflow runner; fallback turns return `undefined` so the main agent still runs under the router-supplied fallback context.
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
