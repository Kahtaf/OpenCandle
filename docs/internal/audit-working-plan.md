# OpenCandle Audit Working Plan

Source: `/tmp/opencandle-audit-summary.txt`

This is the working document for the next set of OpenCandle audit fixes. The
original audit content is retained below, but the implementation order should
follow the scope notes in this section rather than the raw severity/counts.

## Verification Summary

- Raw audit count: confirmed 36, unverified 3, refuted 2.
- Adjusted reading: most confirmed findings are factual, but the count is
  inflated by duplicate reports of the same stale-cache issue.
- The two refuted findings should remain out of scope unless new evidence
  appears.
- The three unverified findings look likely accurate from source search and
  should be treated as low-priority cleanup candidates, pending public API
  decisions.

## Product Decisions

- Deprecated workflow wrappers: the newer API is `WorkflowDefinition` via
  `buildPortfolioWorkflowDefinition`, `buildCompareAssetsWorkflowDefinition`,
  and `buildOptionsScreenerWorkflowDefinition`. The deprecated wrappers are old
  `WorkflowPlan { initialPrompt, followUps }` adapters kept for compatibility
  after `agent-runtime-v2`. Keep the newer definition API as authoritative.
  "Deprecate" means remove the old wrappers entirely in this cleanup batch:
  migrate internal tests/callers to the definition builders, delete the old
  `WorkflowPlan` path, and remove stale exports. There are no external users to
  preserve compatibility for.
- Alert condition builders: `percentMove()` and `smaCross()` are planned alert
  types. Wire them into creation, runner evaluation, and tests instead of
  deleting them.
- `_resetSentimentSingletons()`: not a planned public/test API. Delete it.
- Toast system: implement a real shadcn-style toast system, using
  `trendy-design/llmchat` as the UI reference. Prefer the llmchat pattern of a
  root-level `Toaster`, a shared `useToast()`/`toast()` API, Radix/shadcn toast
  primitives, and destructive/default variants; Sonner is acceptable only if it
  matches the copied llmchat component style.
- Market-state mutation acknowledgement: use the cleaner acknowledged-operation
  model. See "Mutation Feedback Decision" below.
- OpenSpec cleanup: archive completed OpenSpec changes as part of the docs and
  cleanup batch.

## Subagent Coordination

- Branching: subagents should branch from the current branch and merge their
  work back into `feat/persist-user-market-state`.
- Batch ownership:
  - Runtime/provider reliability: workflow cancellation, run context, stale
    cache metadata, 429 retry behavior, and rate-limiter concurrency.
  - Tool/provider guardrails: alert not-found handling, finite tool schemas,
    numeric bounds, zero-safe required checks, Yahoo raw fetch hygiene, and SEC
    EDGAR fetch hygiene.
  - GUI: llmchat-inspired shadcn toast system, acknowledged market-state
    mutations, disconnected state, combobox semantics, mobile drawer focus
    management, and nested-button cleanup.
  - Docs/cleanup: OpenSpec archive, docs drift, old workflow wrapper removal,
    `_resetSentimentSingletons()` deletion, duplicated prompt builders, and
    other low-risk dead-code/simplification items.

## Mutation Feedback Decision

Current behavior: market-state pages send `tool.invoke` over WebSocket and then
refresh after a fixed 700 ms delay. The client never receives a success/failure
result for that specific mutation. If the tool fails, is slow, or finishes after
the refresh, the UI can close the panel and leave the user guessing.

Decision: mutation tools should become acknowledged operations.

- Implement request ids and server acknowledgements for `tool.invoke`, then
  let the UI await success/failure, show pending state, display errors through
  the toast system, close panels only after success, and refresh immediately
  after the acknowledged mutation completes.
- Do not keep the timing-based 700 ms refresh as the primary success path.
- Keep compatibility/fallback behavior only where needed for non-mutating or
  older fire-and-forget commands.

## Implementation Scope

### Upscope

- Treat workflow cancellation and run-context ownership as one runtime fix. The
  local `runRef.active` guard is ineffective, and `clearRunContext()` is
  unowned global state; fixing only one side leaves cancellation/circuit-breaker
  behavior fragile.
- Treat cache stale metadata as one cross-provider correctness fix. The three
  stale-cache findings below describe the same underlying singleton side
  channel and should be deduplicated into one task.
- Include targeted regression tests for runtime cancellation, stale metadata
  propagation under concurrency, malformed GUI request handling, 429 retry
  behavior, rate-limiter concurrency, and invalid tool params.
- Promote the three "unverified" findings to "likely accurate cleanup" after
  verifying current public-export expectations.

### Downscope

- Do not treat GUI toast rendering as a high-severity runtime blocker. It is a
  real UX bug, but it fits better with the GUI feedback/accessibility batch
  unless a critical failure path depends on it.
- Do not delete deprecated workflow wrappers as a drive-by cleanup. The newer
  `WorkflowDefinition` builders are authoritative; formally deprecate the old
  wrappers and migrate internal tests/callers first.
- Do not mix broad docs cleanup with runtime fixes. Docs mismatches should land
  in a separate documentation batch after the runtime/tool-call issues.
- Do not implement broad refactors for "simplify" findings until the defect
  fixes are complete and covered by tests.

## Recommended Fix Order

1. Runtime correctness: workflow cancellation, run-context ownership, and
   provider circuit-breaker context safety.
2. Provider correctness: remove cache stale side-channel and propagate stale
   metadata in-band.
3. GUI server reliability: top-level async error handling and malformed JSON
   400 responses.
4. Shared reliability: retry HTTP 429 with backoff/Retry-After support and make
   rate-limiter waiting concurrency-safe.
5. Tool-call guardrails: `manage_alerts set_enabled` not-found handling,
   finite schema values for provider params, numeric bounds, and zero-safe
   required checks.
6. Provider hygiene: Yahoo crumb/options raw fetch timeout/validation and SEC
   EDGAR document fetch rate limiting/timeout/warnings.
7. GUI feedback/accessibility: rendered toast/banner, disconnected state,
   market-state mutation acknowledgements, combobox semantics, mobile drawer
   focus management, and nested-button cleanup.
8. Docs and cleanup: AGENTS/README/config/OpenSpec drift, archived completed
   specs, deprecated wrappers, duplicated prompt builders, and other low-risk
   dead-code/simplification items.

## Notes On Specific Findings

- Cancelled workflow runs: agree with the ineffective `runRef.active` finding.
  Nuance: `WorkflowRunner.cancel()` stops the runner after the current executor
  returns, so the user-visible issue is better stated as "not promptly aborted
  and can continue waiting until settlement" rather than "always sends the next
  prompt."
- Cache stale flag: agree, and deduplicate all repeated cache stale-flag
  findings into one high-priority provider correctness issue.
- GUI toast state: agree factually, downscope from high to medium GUI UX.
- Deprecated workflow wrappers: agree that they are legacy, but removal is not
  a simple cleanup because `src/workflows/index.ts` exports them and tests still
  depend on them. The replacement is the formalized `WorkflowDefinition`
  builders.
- `percentMove`/`smaCross`: planned alert capabilities; wire them.
- `_resetSentimentSingletons`: delete.
- `toWorkflowPlan`: likely removable once compatibility expectations for the
  old `WorkflowPlan` path are settled.

## Original Audit

confirmed: 36 | unverified: 3 | refuted: 2

[HIGH] (bugs-core) Cancelled workflow runs never observe cancellation (runRef.active is never set to false) and still send their next step prompt
  file: src/runtime/session-coordinator.ts:405
  desc: startWorkflowRun creates `const runRef = { active: true }` (src/runtime/session-coordinator.ts:405) and the step executor's cancellation guard is `waitForPromptSettlement(ctx, () => runRef.active)` plus `if (!settled || !runRef.active) throw new Error("run_cancelled")` (lines 427-431, 434-441). However, nothing in the codebase ever sets `runRef.active = false`: `cancelActiveWorkflow()` (lines 450-
  fix: Have startWorkflowRun register the runRef so cancellation can flip it: e.g. store `this.activeRunRef = runRef`, set `runRef.active = false` in cancelActiveWorkflow(), and also flip the previous run's ref before starting a new one (or pass an AbortSignal into the executor that WorkflowRunner.cancel()

[HIGH] (bugs-core) Cache stale-flag is process-global mutable state; concurrent provider calls cross-contaminate stale labeling, letting stale quotes be treated as fresh
  file: src/infra/cache.ts:39
  desc: Cache stores stale-hit metadata in instance fields shared by every caller: `getStale()` sets `this.lastStaleHit = true; this.lastStaleCachedAt = entry.cachedAt` (src/infra/cache.ts:39-41) and `wrapProvider` reads it after `await fn()` via `cache.consumeStaleFlag()` (src/providers/wrap-provider.ts:41). The singleton `cache` (cache.ts:78) is used by all providers, and providers run concurrently: `Pr
  fix: Remove the side-channel flag entirely. Have getStale callers return stale metadata in-band (e.g. providers return `{ value, stale: true, cachedAt }` or throw a typed StaleDataError carrying the value), and have wrapProvider derive staleness from the returned value rather than from shared Cache state

[HIGH] (reliability) Global mutable stale flag on Cache cross-contaminates concurrent provider calls
  file: src/infra/cache.ts:39-54
  desc: Cache.getStale() sets instance-level `lastStaleHit`/`lastStaleCachedAt` (cache.ts:39-41), and wrapProvider() consumes that flag only after a *successful* fn() (src/providers/wrap-provider.ts:41). The cache is a module singleton (`export const cache = new Cache()`), so concurrent provider calls share one flag. Tools run providers concurrently, e.g. src/tools/fundamentals/dcf.ts:156-160 does `Promis
  fix: Remove the global flag. Have getStale() callers return staleness explicitly: change provider catch-blocks to return the full StaleResult (value + stale + cachedAt) and have wrapProvider accept fn(): Promise<T | StaleResult<T>> (or thread a per-call context object) so stale metadata travels with the 

[HIGH] (reliability) GUI HTTP handler has no top-level error handling; malformed request body causes unhandled rejection
  file: gui/server/server.ts:110-112
  desc: `createServer((req, res) => { void handleHttpRequest(req, res); })` fires an async function and discards the promise, and handleHttpRequest (server.ts:114-195) contains no try/catch. Any throw becomes an unhandled promise rejection, which crashes the Node process by default and leaves the HTTP request hanging with no response. Concrete trigger: POST /api/chat/run with malformed JSON — handleSseCha
  fix: Wrap the body of handleHttpRequest (or the call site at line 111) in try/catch that logs the error and responds 500 with a JSON error body if headers are not yet sent. Also wrap readJsonBody's JSON.parse so malformed bodies return a 400 instead of throwing.

[HIGH] (gui-ux) Toast/error state is stored but never rendered anywhere in the app
  file: gui/web/src/hooks/useGuiConnection.jsx:163
  desc: useGuiConnection exposes `toast`/`setToast`, and setToast is called from at least 7 places to report failures: WS `error` messages (useGuiConnection.jsx:108), 'GUI connection is not open.' (useGuiConnection.jsx:131), newSession failures (useGuiConnection.jsx:147), chat run failures and aborts (useChatRun.jsx:34,41,44), and follower-mode mutation warnings (MarketStatePage.jsx:80). However, a repo-w
  fix: Add a toast/banner component rendered at the AppShell level (e.g. a fixed-position `role="status"`/`aria-live="polite"` region) that displays `gui.toast` with a dismiss button and auto-clear timeout, or adopt a small toast library. Until then, every setToast call site is dead UX.

[MEDIUM] (bugs-core) Superseded workflow's .finally(clearRunContext) wipes the new workflow's run context, silently disabling circuit breaker and failure tracking
  file: src/runtime/session-coordinator.ts:444
  desc: startWorkflowRun calls the module-global `setRunContext({ providerTracker: this.providerTracker })` (src/runtime/session-coordinator.ts:420) and attaches `.finally(() => clearRunContext())` to the runner promise (lines 444-446). run-context is a single module-level variable (src/runtime/run-context.ts:7-17). When workflow B starts while workflow A is still running, B calls setRunContext, then `run
  fix: Make clearRunContext ownership-aware: setRunContext should return a token/context object, and the finally handler should only clear the context if it still owns it (e.g. `if (activeContext === myContext) activeContext = null`), or track contexts per runId instead of a single global slot.

[MEDIUM] (tool-calls) manage_alerts set_enabled with an unknown id crashes with an opaque TypeError instead of a 'not found' result
  file: src/tools/portfolio/alerts.ts:221
  desc: alerts.ts:217-228 calls service.setAlertRuleEnabled(args.id, args.enabled) without checking the rule exists. In src/market-state/service.ts:982-992 the UPDATE silently no-ops for a missing id and then calls getAlertRule(id); getAlertRule (service.ts:1959-1961) does `.get(id) as AlertRuleRow` with no undefined check, so mapAlertRule(undefined) (service.ts:2084-2086) throws `TypeError: Cannot read p
  fix: In the set_enabled branch, look up the rule first (or make setAlertRuleEnabled return null for missing ids) and return a structured text result like `Alert #${args.id} not found. Use the list action to see alert ids.` instead of letting mapAlertRule throw.

[MEDIUM] (tool-calls) Free-form string params (range/interval/period/expiration) are passed unvalidated into provider URLs
  file: src/tools/market/stock-history.ts:15-24
  desc: get_stock_history declares `range` and `interval` as plain Type.String with the valid values only in the description; the values are interpolated raw into the Yahoo URL (src/providers/yahoo-finance.ts:141 `?interval=${interval}&range=${range}`), so a model typo like `1w` or `3y` becomes a provider round-trip plus a generic "unavailable" error rather than an immediate schema rejection. Same pattern
  fix: Constrain finite vocabularies with Type.Union of literals (or `Type.String({ enum: [...] })` as screen-stocks.ts:66 does), and for `expiration` validate `/^\d{4}-\d{2}-\d{2}$/` plus `Number.isNaN(date.getTime())` at the top of execute, returning a clear error result listing the available expirations

[MEDIUM] (reliability) Yahoo crumb and options-chain raw fetch calls have no timeout and skip response validation
  file: src/providers/yahoo-finance.ts:302-312
  desc: getYahooCrumb() uses raw `fetch` with no AbortController/timeout for both the cookie request (line 302) and the crumb request (line 309) — unlike every httpGet call, which gets a 10s timeout from src/infra/http-client.ts:9. A hung Yahoo endpoint blocks getOptionsChain() (and the quoteSummary crumb retry path at line 240-249) indefinitely; getOptionsChain has already consumed a rate-limiter token (
  fix: Add `signal: AbortSignal.timeout(10_000)` to all four raw fetch calls (matching exa-search.ts:222), and fail fast in getYahooCrumb when `cookieRes.ok` is false or set-cookie is absent, with a message naming the failing step.

[MEDIUM] (reliability) HTTP 429 responses are treated as non-retryable client errors in the shared HTTP client
  file: src/infra/http-client.ts:85-86
  desc: httpRequest's retry loop bails on `error.status >= 400 && error.status < 500` with the comment "Don't retry client errors", which includes 429 Too Many Requests. Every provider built on httpGet (Yahoo quote/history, Reddit, Finnhub, FRED, Brave, Alpha Vantage, SEC EDGAR) therefore turns a transient rate-limit response into an immediate hard failure with no backoff and no Retry-After handling — eve
  fix: Special-case 429 (and optionally 408) as retryable: `if (error instanceof HttpError && error.status >= 400 && error.status < 500 && error.status !== 429) throw error;` and honor the Retry-After header when present for the backoff delay.

[MEDIUM] (reliability) RateLimiter lets concurrent waiters all proceed after the same wait, bursting past the provider limit
  file: src/infra/rate-limiter.ts:39-43
  desc: When the bucket is empty, acquire() computes `waitMs = ((1 - bucket.tokens) / refillRate) * 1000` from shared bucket state, sleeps, then does `bucket.tokens -= 1` unconditionally without re-checking `tokens >= 1`. N concurrent callers (e.g. Promise.all quote fans like src/tools/portfolio/correlation.ts:98 or src/tools/fundamentals/comps.ts:104) all read the same deficit, sleep the same duration, t
  fix: Loop instead of single-shot: after waking, re-run refill() and re-check `tokens >= 1` before decrementing (while-loop with recomputed wait), or serialize waiters per bucket with a FIFO promise queue so each waiter reserves its token.

[MEDIUM] (reliability) SEC EDGAR document fetches have no rate limiting, no timeout, and swallow failures into empty snippets
  file: src/providers/sec-edgar.ts:225-245
  desc: Three issues compound in the filing-evidence path: (1) sec-edgar.ts never calls rateLimiter.acquire — it is the only HTTP provider in src/providers/ without a configured bucket (see rate-limiter.ts:59-75), and enrichWithEvidenceSnippets fires `Promise.all` over filings (line 226-236), fetching full filing documents in parallel against sec.gov, which enforces a fair-access limit (10 req/s) and bloc
  fix: Configure a `sec_edgar` bucket (e.g. 5 burst / 5 req/s) and acquire it in fetchText; add `AbortSignal.timeout(10_000)`; and record fetch failures on the filing (e.g. `evidenceError: message`) or in a warnings array so the tool output can say "evidence fetch failed" instead of implying the filing had

[MEDIUM] (simplify) Superseded alert-persistence methods duplicate the v2 evaluation path
  file: src/market-state/service.ts:1326
  desc: `recordAlertCheckResult` (service.ts:1326-1390) is an older compare-and-swap-style alert check writer that duplicates the insert-event + update-rule transaction now handled by `recordAlertEvaluationResult` (service.ts:1392-1517). Production code uses only the newer method (src/market-state/alert-runner.ts:249) plus `recordAlertUnavailable` (alert-runner.ts:220); `recordAlertCheckResult`, `updateAl
  fix: Delete `recordAlertCheckResult`, `updateAlertObservation`, and `recordAlertEvent` from MarketStateService and port the two test files to `recordAlertEvaluationResult`, which already covers the conditional-trigger and dedupe semantics those tests verify.

[MEDIUM] (simplify) postProcessRouterOutput is a 355-line function of ~12 hand-rolled correction rules
  file: src/routing/router.ts:184
  desc: `postProcessRouterOutput` (router.ts:184-539) sequentially applies about twelve route-correction rules, each repeating the same boilerplate: a predicate, a `diagnostics.push({code, message})`, and a spread-override of `next` (e.g. options-education correction at 242-259, stateful-tracking at 318-339, macro at 354-371, portfolio-evaluation at 373-386 and 420-433, crypto-sizing at 405-418, tradeoff-
  fix: Extract the corrections into a declarative table `{ when(text, output), code, message, patch }` iterated by a small loop, and split entity enrichment / disambiguation / tool-bundle selection into named helper functions. Behavior-preserving, makes each rule independently testable, and removes ~150 li

[MEDIUM] (simplify) Global mutable stale-flag side channel between Cache and wrapProvider
  file: src/infra/cache.ts:39
  desc: Cache stores `lastStaleHit`/`lastStaleCachedAt` as instance state set by `getStale()` (cache.ts:39-41) and consumed by `wrapProvider` via `cache.consumeStaleFlag()` after every successful provider call (wrap-provider.ts:41). This is a hidden process-global side channel on the `cache` singleton: with concurrent provider calls — which the codebase does (e.g. `Promise.allSettled` over four providers 
  fix: Remove the flag and pass staleness explicitly: have provider-level stale fallbacks return the existing `StaleResult<T>` shape (cache.ts:7-11) and let wrapProvider detect it structurally (e.g. a `stale: true` marker on the value or a small wrapper type), so stale metadata travels with the value inste

[MEDIUM] (gui-ux) WebSocket disconnect/connecting states are never surfaced; market-state pages stay 'writable' while disconnected
  file: gui/web/src/features/market-state/MarketStatePage.jsx:71
  desc: When the WS closes, useGuiConnection sets role to 'disconnected' and silently retries every 1s (useGuiConnection.jsx:111-117); initial state is 'connecting' (line 12). No component renders these states: ChatPanel only special-cases `role === 'follower'` for the placeholder (ChatPanel.jsx:60-62), so while disconnected the composer is just disabled with the normal 'Ask anything' placeholder and no e
  fix: Surface connection state: render a visible 'Reconnecting…' banner when `role === 'disconnected' || role === 'connecting'`, change the composer placeholder accordingly, and make MarketStatePage treat any non-'writer' role as read-only (`readOnly = role !== 'writer'`) so mutation buttons are disabled 

[MEDIUM] (gui-ux) Market-state mutations are fire-and-forget with a 700ms timing-based refresh and no pending/success/error feedback
  file: gui/web/src/features/market-state/MarketStatePage.jsx:78-86
  desc: `invokeTool` sends `tool.invoke` over the WS and schedules `refresh()` 700ms later: `window.setTimeout(() => void refresh(), 700)`. The tool result is never inspected — if the tool fails server-side (invalid symbol, provider error), the panel closes (e.g. closePanel() after submit at line 650) and the row simply never appears, with no error shown. If the tool takes longer than 700ms the refresh ra
  fix: Have the server ack tool.invoke (or expose the invocation as an HTTP POST returning the result) so the UI can await success/failure, show a pending state on the triggering row/button, and surface failures. At minimum set a `refreshing` flag in refresh()/refreshQuotes() and spin the RefreshCw icon wh

[MEDIUM] (gui-ux) Symbol autocomplete and alert form lack combobox semantics, keyboard navigation, and labels
  file: gui/web/src/features/market-state/MarketStatePage.jsx:954-1008
  desc: SymbolSearchInput renders a text input plus an absolutely-positioned suggestion list of plain `<button>`s with no ARIA combobox wiring: no `role="combobox"`, `aria-expanded`, `aria-controls`, `role="listbox"`/`option`, and no ArrowDown/ArrowUp/Enter/Escape handling — a screen-reader user is never told suggestions appeared, and keyboard users must Tab through suggestions (which also blurs the field
  fix: Add proper combobox ARIA (aria-expanded, aria-controls, role=listbox/option, aria-activedescendant) and arrow-key/Enter/Escape handling to SymbolSearchInput, and give every market-state form control a visible or sr-only <label> (the codebase already has the `sr-only` label pattern in PageToolbar at 

[MEDIUM] (gui-ux) Hand-rolled mobile tool-drawer dialog has no focus trap or focus management, unlike every other overlay
  file: gui/web/src/features/chat/tool-drawer.jsx:35-58
  desc: ToolDrawerOverlay renders `role="dialog" aria-modal="true"` markup by hand: a fixed backdrop button plus a fixed section. There is no focus trap, no initial focus move into the dialog, and no focus restoration on close — keyboard/screen-reader users can Tab straight through to the chat content behind the 'modal', and aria-modal="true" tells AT the background is inert when it is not. Every other ov
  fix: Reimplement ToolDrawerOverlay on the existing Sheet/vaul Drawer primitive (the file's own comment says 'Mobile bottom-sheet overlay using vaul' but the code doesn't use vaul), or at minimum add a focus trap, move focus to the dialog on open, and restore it on close.

[MEDIUM] (docs) AGENTS.md STRUCTURE tree omits major src/ subsystems and mislabels the entry point
  file: AGENTS.md:17-33
  desc: The STRUCTURE tree in AGENTS.md (lines 17-33) does not list src/market-state/ (8 files incl. service.ts, alert-runner.ts, daily-report.ts), src/runtime/ (13 files incl. session-coordinator.ts, workflow-runner.ts — SessionCoordinator is one of the most-connected core abstractions), src/sentiment/ (pipeline.ts, scorer.ts, adapters/), src/monitor.ts (backs the documented `opencandle monitor` command,
  fix: Update the STRUCTURE block to add market-state/, runtime/, sentiment/, cli.ts, monitor.ts, and tool-kit.ts; relabel index.ts as 'Public package exports' and cli.ts as the entry point; refresh the providers/ annotation to the current provider list (or drop the parenthetical list so it cannot go stale

[MEDIUM] (docs) intent-routing spec's SlotSource contract diverged from src/routing/types.ts
  file: openspec/specs/intent-routing/spec.md:58
  desc: The spec requires: 'a `source` field with one of: "user" ... "preference" ... or "default" ... These values match the existing SlotSource type in src/routing/types.ts.' That claim is now false: src/routing/types.ts:70 defines `export type SlotSource = "user" | "preference" | "default" | "prior_context" | "memory"`, and buildDisclosureBlock (src/prompts/workflow-prompts.ts:86-103) renders the extra
  fix: Update the Per-Slot Source Provenance requirement in openspec/specs/intent-routing/spec.md to the five-value SlotSource enum (adding prior_context and memory with their Assumptions-block labels), and rename or reword the 'Two-Value Route Categorization' heading.

[LOW] (bugs-core) Alert run durable record stamps completedAt with the run's start time and counts never-evaluated rules as checked
  file: src/market-state/alert-runner.ts:280
  desc: runAlertChecks computes `now` once at entry (src/market-state/alert-runner.ts:164) before any provider IO, then uses it for the durable run record's `completedAt` (line 281, and line 296 on the failure path), so `completed_at` always equals `started_at` even when TradingView/Yahoo fetches take many seconds — and every observation's `at`/`observedAt` (lines 240-241) and trigger `triggeredAt` (line 
  fix: Capture a fresh timestamp (`new Date().toISOString()`) at completion time for completedAt (keeping options.now only as the logical check time for determinism in tests if desired), and report `checkedCount: runnable.length` (or rules.length minus the pre-filtered count) so checked/unavailable totals 

[LOW] (tool-calls) GUI '__enabled' meta-flag is injected into every tool call's arguments via the defaults wrapper
  file: src/pi/tool-adapter.ts:25-27
  desc: The GUI persists tool enablement as a tool default: gui/server/tool-metadata.ts:76 calls setDefault(toolName, "__enabled", enabled). getOpenCandleToolDefinitions() (src/pi/tool-adapter.ts:25-27) filters on defaults.__enabled !== false but then passes the ENTIRE defaults object — including the __enabled key — to wrapWithDefaults. mergeDefaults in src/runtime/tool-defaults-wrapper.ts:23 starts from 
  fix: Strip the `__enabled` key (or any reserved `__`-prefixed meta keys) from the defaults object before calling wrapWithDefaults, e.g. `const { __enabled, ...paramDefaults } = defaults` in getOpenCandleToolDefinitions, and add a unit test asserting wrapped tools never receive `__enabled` in args.

[LOW] (tool-calls) Unavailable-result boilerplate is duplicated across ~20 tools with inconsistent shapes and `details: null as any`
  file: src/tools/market/stock-quote.ts:31-35
  desc: Every tool hand-rolls its provider-unavailable result, and the shapes diverge: `details: null as any` appears in at least 16 tools (option-chain.ts:39, fred-data.ts:34, comps.ts:125, risk-analysis.ts:27/36, web-search.ts:122/136, twitter-sentiment.ts:44, sentiment-summary.ts:136, reddit-sentiment.ts:68, fear-greed.ts:20, crypto-price.ts:25, correlation.ts:120, etc.), while stock-history.ts:57 retu
  fix: Add a shared helper in src/tool-kit.ts, e.g. `unavailableResult(label: string, reason: string, opts?)` returning a canonical `{ content, details: null }`, and widen the AgentTool result details type to `TDetails | null` so the casts can be deleted. This also gives one place to standardize the failur

[LOW] (tool-calls) Numeric inputs lack bounds and truthiness-based required checks reject legitimate zero values
  file: src/tools/portfolio/predictions.ts:171-173
  desc: track_prediction documents `conviction` as "1-10" but the schema is an unbounded Type.Number, and conviction feeds directly into the conviction-weighted accuracy math (predictions.ts:150 `weightedHitRate: correctConviction / totalConviction`), so a model passing conviction 100 silently distorts the scorecard. Similarly tracker.ts shares/avg_cost and fred-data.ts limit accept negative numbers. Sepa
  fix: Add `minimum`/`maximum` to the Typebox schemas (e.g. `Type.Number({ minimum: 1, maximum: 10 })` for conviction, `minimum: 0` for shares/limit), and replace truthiness required-checks with `== null` so 0 is accepted where it is semantically valid.

[LOW] (tool-calls) getDefaults/getAllDefaults leak a new SQLite connection per call via default parameter
  file: src/memory/tool-defaults.ts:6
  desc: getDefaults and getAllDefaults (tool-defaults.ts:6, 20) take `db: SqliteDb = initDefaultDatabase()`, and initDefaultDatabase (src/memory/sqlite.ts:368-370 → initDatabase:355-365) always opens a brand-new better-sqlite3 Database (WAL mode) that these functions never close. safeGetDefaults in src/pi/tool-adapter.ts:30-36 calls getDefaults once per tool — 32 leaked connections at every extension acti
  fix: In getDefaults/getAllDefaults/setDefault, when no db is supplied, open the connection locally and close it in a finally block (or accept a required db from callers that already hold one), matching the open/close discipline the tools themselves use.

[LOW] (dead-code) Exported const ROLE_EXPECTED_EVIDENCE is never used anywhere
  file: src/analysts/contracts.ts:13
  desc: ROLE_EXPECTED_EVIDENCE (a Record<AnalystRole, string[]> documented as "Evidence fields expected per analyst role") is exported but the identifier appears exactly once in the whole repository -- its own declaration. It is not referenced within contracts.ts, not imported by src/analysts/orchestrator.ts, not used by any test, and src/analysts is not a public package export. It looks like planned evid
  fix: Either delete the constant or wire it into the analyst output validation/prompting it was evidently intended for. If kept for a planned feature, add a TODO referencing the spec so it doesn't read as dead code.

[LOW] (dead-code) @deprecated workflow wrappers and WorkflowPlan type survive only to serve tests
  file: src/workflows/options-screener.ts:120
  desc: buildOptionsScreenerWorkflow (options-screener.ts:120-127), buildPortfolioWorkflow (portfolio-builder.ts:49-56), and buildCompareAssetsWorkflow (compare-assets.ts:84-93) are all marked @deprecated in favor of their *Definition variants, and production code uses only the Definition variants (src/pi/opencandle-extension.ts:613, 623, 669, 824, 848, 901). The deprecated wrappers' only remaining caller
  fix: Migrate the unit tests to assert against the *Definition variants (the wrappers are trivial { initialPrompt, followUps } projections, so test conversion is mechanical), then remove the three wrappers and WorkflowPlan from src/workflows/index.ts in the next semver-minor/major since "./workflows" is a

[LOW] (simplify) Deprecated WorkflowPlan code path kept alive only by tests
  file: src/workflows/portfolio-builder.ts:49
  desc: Each workflow builder ships a `@deprecated` wrapper that converts the WorkflowDefinition back to the old WorkflowPlan shape: `buildPortfolioWorkflow` (src/workflows/portfolio-builder.ts:49-56), `buildCompareAssetsWorkflow` (src/workflows/compare-assets.ts:84-93), and `buildOptionsScreenerWorkflow` (src/workflows/options-screener.ts:120-127). Grep shows zero production callers — only tests (tests/u
  fix: Delete the three deprecated wrappers, src/workflows/types.ts, the `WorkflowPlan` re-export in src/workflows/index.ts:4, and the unused `toWorkflowPlan` in src/runtime/prompt-step.ts:66. Migrate the tests to call the `*Definition` builders and assert on `def.steps[i].prompt` (a mechanical change sinc

[LOW] (simplify) Two parallel builders for the same comprehensive-analysis prompt sequence
  file: src/analysts/orchestrator.ts:176
  desc: `getComprehensiveAnalysisPrompts` (orchestrator.ts:176-197) and `buildComprehensiveAnalysisDefinition` (orchestrator.ts:202-266) independently assemble the identical sequence (initial fetch, 5 analyst prompts, debate or no-debate synthesis, validation), so any prompt-order change must be made twice and the two paths can silently diverge. Production uses only the definition variant (src/pi/opencand
  fix: Make the definition the single source of truth: reimplement `getComprehensiveAnalysisPrompts` as `buildComprehensiveAnalysisDefinition(symbol, options).steps.map((s) => s.prompt)` (one line, removes ~20 duplicated lines and the divergence risk), or delete it and `runComprehensiveAnalysis` entirely a

[LOW] (simplify) Reddit fetch/filter/dedupe/comment pipeline duplicated across two sentiment tools
  file: src/tools/sentiment/sentiment-summary.ts:260
  desc: `fetchRedditCrossSubreddit` (sentiment-summary.ts:260-308) reimplements the same pipeline as the body of `redditSentimentTool.execute` (reddit-sentiment.ts:53-114): per-subreddit `wrapProvider("reddit", () => getSubredditPosts(...))`, the identical topic-filter predicate (`r.text.toLowerCase().includes(queryLower) || r.title?.toLowerCase().includes(queryLower)` — sentiment-summary.ts:280-283 vs re
  fix: Extract a shared helper, e.g. `fetchRedditRecords(query, subreddits, { limit, topPostsForComments })` in src/sentiment/ returning `{ records, warnings }`, and have both the tool and the summary call it with their respective parameters.

[LOW] (gui-ux) Nested <button> inside <button> in StepsCard source pill
  file: gui/web/src/features/chat/steps-card.jsx:67-71
  desc: StepsCard renders its whole card as a `<button type="button" onClick={() => open(run)}>` (steps-card.jsx:42-50). Inside it, when sources exist, it renders `<SourceStack sources={sources} onClick={() => open(run)} />` — and SourceStack renders a `<button>` whenever onClick is a function (source-stack.jsx:10-14). Button-in-button is invalid HTML: browsers may hoist the inner button out of the outer 
  fix: Since both click targets do the same thing (`open(run)`), pass SourceStack no onClick here so it renders its non-interactive `div` variant, or restructure StepsCard so the card is a div with a single overlaid button (stretched-link pattern) instead of nesting interactive elements.

[LOW] (docs) config.ts doc comment says LLM router is the default; code and docs say rules
  file: src/config.ts:24-29
  desc: The doc comment on `routerMode` reads: 'Intent-router mode. `"llm"` (default) runs the LLM router ahead of prompt assembly. `"rules"` is the explicit legacy rule-router rollback path'. But `resolveRouterMode()` at src/config.ts:129 returns "rules" when the env var is unset, and the error message at src/config.ts:132 says 'Allowed values: "rules" (default) or "llm"'. AGENTS.md (ENV FLAGS) and docs/
  fix: Fix the comment to state that "rules" is the current default and "llm" is the opt-in mode, or land the remove-rule-router change; the comment and resolveRouterMode() must agree.

[LOW] (docs) README 'Project shape' omits market-state, runtime, and sentiment directories
  file: README.md:163-174
  desc: The README project-shape tree lists providers/, tools/, infra/, routing/, workflows/, memory/, analysts/, pi/, index.ts but not src/market-state/, src/runtime/, or src/sentiment/. These are not minor: src/market-state/service.ts hosts MarketStateService (watchlists/portfolio/alerts, a top-connected abstraction) and src/runtime/session-coordinator.ts hosts SessionCoordinator. README.md:155 also des
  fix: Add market-state/ (durable user market state + alert/report automation), runtime/ (workflow runner, session coordinator), and sentiment/ (cross-source sentiment pipeline) entries to the project-shape tree.

[LOW] (docs) Seven fully-completed openspec changes were never archived
  file: openspec/changes/add-local-gui/tasks.md:1
  desc: openspec/changes/ mixes in-flight work with changes that shipped releases ago and have 100% of tasks checked: add-exa-search (10/10), add-finnhub-news (36/36), add-local-gui (26/26), agent-runtime-v2 (63/63), revamp-local-gui (48/48), persist-user-market-state (92/92), local-market-automations-v2 (58/58). All correspond to shipped features in CHANGELOG.md (0.2.0–0.5.0/Unreleased). The repo follows
  fix: Run the openspec archive flow for the seven completed changes, moving them to openspec/changes/archive/ with date prefixes so openspec/changes/ reflects only in-flight proposals. Update the CHANGELOG references (e.g. 'See openspec/changes/add-local-gui/') to the archived paths.

[LOW] (docs) Configuration docs miss two env vars the code reads
  file: docs/configuration.md:51-58
  desc: docs/configuration.md presents itself (and is referenced by README.md:130) as 'the full reference, including advanced routing and diagnostic switches', and its Advanced Developer Diagnostics table lists only OPENCANDLE_ROUTER_MODE and OPENCANDLE_TOOL_SCOPE_MODE. The code reads two more: OPENCANDLE_PLANNING_MIGRATION_STATUSES (src/config.ts:146, with strict validation that throws 'Invalid OPENCANDL
  fix: Add OPENCANDLE_PLANNING_MIGRATION_STATUSES (format `task_family=status,...`, invalid entries fail startup) and OPENCANDLE_AUTOMATION_HEARTBEAT_MS to the Advanced Developer Diagnostics table in docs/configuration.md.

=== UNVERIFIED ===
[medium] (dead-code) Dead backward-compat helper toWorkflowPlan() has zero callers — src/runtime/prompt-step.ts:66
[medium] (dead-code) Alert-condition builders percentMove() and smaCross() are dead -- no creator and no runner evaluation path — src/market-state/alert-conditions.ts:26
[low] (dead-code) "For testing" helper _resetSentimentSingletons() is not used by any test — src/sentiment/index.ts:52

=== REFUTED ===
- bugs-core: Alert runner getTradingViewQuotes has an unreachable stale branch, and getYahooQuote labels TTL-cached quotes as cacheStatus "live" — The dead ternary is technically true but trivial — the throw is the intended stale handling, and the inte
- dead-code: All three "known import cycles" from the knowledge graph are false positives — The factual claims check out (tool-drawer.jsx -> ToolDrawerStep.jsx is one-directional, App.jsx has no self-import, and finnhub.ts imports a different file in s
