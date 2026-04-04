## CHANGED Requirements

### Requirement: Tools can access the active run's ProviderTracker

The live analysis path executes tools via Pi's tool adapter (`src/pi/tool-adapter.ts`), which wraps `tool.execute()` with no workflow context. The `ProviderTracker` lives in `WorkflowRunner` → `StepExecutionContext`, but tool execution is driven by the LLM through Pi — not by the runner's executor. A per-run context bridge SHALL make the active `ProviderTracker` accessible to tools during workflow execution.

#### Scenario: ProviderTracker is accessible during a workflow run

- **GIVEN** `SessionCoordinator.executeWorkflow()` starts a run
- **AND** the runner creates a `ProviderTracker` for this run
- **WHEN** the LLM calls a tool (e.g. `get_company_overview`) during step execution
- **THEN** the tool can access the current run's `ProviderTracker` instance
- **AND** the tool can call `isCircuitOpen(providerId)` and `recordFailure(providerId)`

#### Scenario: ProviderTracker is cleared between runs

- **GIVEN** run A completed with `alphavantage` circuit open
- **WHEN** a new run B starts via `executeWorkflow()`
- **THEN** the run context is a fresh `ProviderTracker` (existing `resetAll()` on line 74 of `workflow-runner.ts`)
- **AND** tools in run B see `alphavantage` as available

#### Scenario: ProviderTracker is not available outside workflow runs

- **GIVEN** no workflow is active (user asks a simple question, LLM calls one tool)
- **WHEN** a tool executes
- **THEN** no `ProviderTracker` is present — tools behave exactly as today (no circuit checking)

### Requirement: Provider calls in tools use `wrapProvider` to return structured results

Tools that call providers SHALL use `wrapProvider()` from `src/providers/wrap-provider.ts` so that provider failures produce `ProviderResultUnavailable` instead of uncaught exceptions. When a provider is unavailable, the tool returns a text response explaining what's missing rather than throwing.

#### Scenario: Tool returns degraded text response when provider fails

- **GIVEN** `get_company_overview` calls `getOverview(symbol, apiKey)` via `wrapProvider`
- **AND** Alpha Vantage returns HTTP 429
- **WHEN** `wrapProvider` catches the error
- **THEN** it returns `{ status: "unavailable", reason: "HTTP 429 Too Many Requests", provider: "alphavantage" }`
- **AND** the tool returns a text response like `"⚠ Company overview unavailable (Alpha Vantage rate limited). Analysis will proceed without fundamentals."`
- **AND** the step does NOT throw — the LLM sees the warning and adapts its analysis

#### Scenario: Tool returns normal response when provider is healthy

- **GIVEN** Alpha Vantage is responding normally
- **WHEN** `get_company_overview` executes
- **THEN** behavior is identical to today — formatted text + details object
- **AND** `wrapProvider` returns `{ status: "ok", data, timestamp }`

#### Scenario: Tool skips provider call when circuit is open

- **GIVEN** `alphavantage` has failed twice in the current run and circuit is open
- **WHEN** `get_company_overview` executes
- **THEN** it checks `providerTracker.isCircuitOpen("alphavantage")` BEFORE calling the provider
- **AND** returns the degraded text response immediately without making the HTTP call
- **AND** the degraded response includes `"(provider circuit open — skipping)"`

### Requirement: Provider failure is recorded on the ProviderTracker

When a provider call fails (caught by `wrapProvider`), the tool SHALL call `providerTracker.recordFailure(providerId)` using the canonical provider ID. After `maxFailures` (default 2) failures for the same provider, the circuit opens.

#### Scenario: Two failures open the circuit

- **GIVEN** `get_company_overview` calls `wrapProvider("alphavantage", ...)` and gets `status: "unavailable"`
- **AND** `providerTracker.recordFailure("alphavantage")` is called (failure count: 1)
- **WHEN** `get_earnings` later calls `wrapProvider("alphavantage", ...)` and also fails
- **AND** `providerTracker.recordFailure("alphavantage")` is called (failure count: 2)
- **THEN** `providerTracker.isCircuitOpen("alphavantage")` returns `true`
- **AND** subsequent tools skip Alpha Vantage calls entirely

### Requirement: Canonical provider IDs match rate limiter keys

All provider ID references SHALL use the same strings as `src/infra/rate-limiter.ts` (lines 54-57): `"yahoo"`, `"alphavantage"`, `"coingecko"`, `"fred"`. New providers not in the rate limiter (SEC EDGAR, Reddit, Fear & Greed) SHALL define IDs as: `"sec-edgar"`, `"reddit"`, `"feargreed"`.

#### Scenario: Provider IDs are consistent

- **WHEN** any component references a provider by ID (ProviderTracker, wrapProvider, rate limiter, evidence provenance)
- **THEN** it uses one of the canonical IDs: `"yahoo"`, `"alphavantage"`, `"coingecko"`, `"fred"`, `"sec-edgar"`, `"reddit"`, `"feargreed"`

## CHANGED (by this spec + stale-cache-degradation spec together)

- `ProviderResultOk<T>` — gains optional `stale: boolean` and original `cachedAt` timestamp so consumers can distinguish fresh from stale success. The stale-cache-degradation spec defines the full contract; this spec's `wrapProvider` usage depends on it.
- `wrapProvider()` — success path now propagates stale metadata from provider return values. Error path is unchanged (still returns `ProviderResultUnavailable`). Implementation detail lives in the stale-cache spec; this spec documents the dependency.
- `toEvidenceRecord()` — must handle `stale: true` on `ProviderResultOk` to set `provenance.source: "stale_cache"` and `provenance.provider` (today `provider` is `undefined` for successful fetches — that changes).

## NOT Changed

- `ProviderTracker` implementation — the class is correct as-is
- `httpGet` retry logic — HTTP-level retries remain unchanged
- `skippable` step behavior — still the last line of defense if an entire step fails
- `WorkflowRunner.executeSteps()` — already builds `StepExecutionContext` with `providerTracker` (line 131-134); the gap is between Pi tool execution and this context, not inside the runner
- `prompt-step.ts`, `promptStepOutput()` — step outputs remain evidence-free in the prompt path (evidence is surfaced via tool text responses, not structured step outputs)
