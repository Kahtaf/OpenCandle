## Context

This change builds on `router-context-and-observability` (29/31 complete), which wired `priorTurns` into the LLM router and made `opencandle-*` custom entries visible in `trace.json`. With those two primitives in place, the LLM router can finally be evaluated as a production candidate. This change ships the deterministic safety nets now and keeps default promotion gated until credentialed acceptance evidence exists.

Three failure classes from one live trace drove the scope:
- IV-as-Implied-Volatility tagged as a ticker, then run through `compare_companies` against ASTS.
- `getQuote("IV")` returning a zero-filled `StockQuote` that downstream tools treated as success.
- LLM router default needs production proof and deterministic safety nets before a branch can safely ship with `llm` as the default.

## Goals / Non-Goals

### Goals
- Keep the LLM router as an opt-in mode until a measurable acceptance gate passes.
- Add a guard at the entity layer so finance acronyms (IV, SEC, FED, CPI, …) require positive ticker signal before being treated as symbols, regardless of router mode.
- Stop the provider layer from emitting zero-filled "successful" quotes for invalid symbols.
- Catch invalid symbols at workflow-templating time so failed multi-symbol comparisons get a clarifying turn instead of garbage data.
- Make `analyze_correlation` survive partial symbol-history failures.

### Non-Goals
- Removing the rules-router code path. Deferred to `remove-rule-router` after one release with `llm` default green.
- Rewriting ticker search/autocomplete. We consume the existing resolver/search layer.
- Adding new providers, new languages, or expanding the workflow taxonomy.
- `/forget` command. Tracked as a follow-up; LLM-router opt-in does not block on it because priorTurns are not persisted across sessions.
- Changing the LLM router prompt structure (rendering of priorTurns, slot definitions, etc.). Existing prompt is the contract.

## Decisions

### Decision 1 — Acronym disambiguation lives as a post-filter, not inside `extractSymbols`

**Choice.** Add `src/routing/symbol-disambiguator.ts` with `disambiguateSymbols(candidates: string[], rawInput: string): string[]`. Call it from `router.ts` against the `entities.symbols` array on both router-mode branches (rules and LLM).

**Why not inside `extractSymbols`.** Two reasons:
1. The LLM router can hallucinate or echo a non-ticker token into `entities.symbols` too. Putting the filter inside the rules-only extractor leaves the LLM path unprotected.
2. Post-filter cleanly composes: rules → extractor → disambiguator → router output, and LLM → router output → disambiguator. Same module called from both paths means one source of truth for the dictionary and the signal rules.

**Defense in depth.** We still extend `COMMON_WORDS` in `entity-extractor.ts` with the missing acronyms, because dropping them at the regex stage avoids spurious downstream signal computations. The post-filter is the safety net; the stoplist patch is the cheap baseline.

**Rule structure.** A token in the finance-acronym dictionary survives the post-filter only when it has a direct per-token ticker signal:
- The raw input contains `$<token>` (case-insensitive),
- The raw input contains a local ticker phrase for that token, such as "IV ticker", "ticker IV", "IV stock", "symbol IV", or "stock IV",
- The token has another explicit per-token ticker marker introduced by a future parser and covered by tests.

Bare comma-list or "and"-list adjacency is **not** a positive signal. "Compare these assets: IV, ASTS" must drop IV when there is no `$IV` or local ticker phrase, even though ASTS is a real ticker in the same list. This trades off some rare legitimate bare-acronym ticker cases in favor of avoiding confident false comparisons. Users can retain the ticker with `$IV` or "IV ticker".

If no positive signal, the token is dropped from `entities.symbols`, with the drop logged as an `opencandle-symbol-dropped` custom entry containing `{ token, reason, signalsChecked }` for observability.

In rules mode, a compare-style prompt can drop from two apparent assets to one real symbol before workflow dispatch. That case must not fall through to the main agent with the original raw prompt, because the main agent can reintroduce the ambiguous acronym as a tool argument. Instead, the extension records `opencandle-workflow-aborted`, injects clarification context, and steers the next agent turn to `ask_user` before any comparison tool is called.

### Decision 2 — Silent-zero detection is provider-side, not tool-side

**Choice.** Throw a typed `InvalidSymbolError` from `getQuote`/`getOptionsChain` when the response shape matches the zero-result heuristic. `wrapProvider` catches the error and returns `unavailable`; `withFallback` propagates the same unavailable shape for fallback-backed tools. Tools see only the existing `unavailable` status; no per-tool change required.

**Heuristic.**
```
isZeroResultQuote(q) =
  q.price === 0 &&
  q.volume === 0 &&
  q.week52High === 0 &&
  q.week52Low === 0 &&
  q.marketCap === 0
```
The conjunction is intentional. A real low-priced stock can have `price` near zero; a halted ticker can have `volume === 0` for the day; but the simultaneous absence of all five fields uniquely identifies a sparse-meta response from Yahoo's chart endpoint for an unrecognized symbol.

**Confirmed.** Per scope review, no legitimate stock returns literal `0` across all five fields. Halted/delisted symbols return `null`/missing fields rather than zero, which the existing `?? 0` defaults convert to zero — exactly the case we want to catch.

**Why not at the tool layer.** Because every other tool that calls `getQuote` (and there are several: portfolio analysis, watchlist, alerts) would otherwise need its own zero-check. Throwing from the provider centralizes the policy.

### Decision 3 — Pre-flight ticker validation runs at workflow templating, not per-tool

**Choice.** In `src/prompts/workflow-prompts.ts`, before substituting `${symbolList}` into the workflow template, call a resolver-layer helper for each candidate. The helper should use `searchYahooInstruments` or a thin wrapper around it; it must not import or execute the `search_ticker` AgentTool object. Drop unknown symbols and annotate the templated prompt:

```
[Pre-flight: dropped 1 unknown symbol — IV (no matching ticker found via resolver search)]
```

If `< 2` symbols remain for a comparison workflow, abort templating and instead instruct the main agent to invoke `ask_user` with a clarifying question.

**Why templating-only.** Latency budget. Per-tool pre-flight would double the latency on every multi-symbol tool call (and many of those calls feed each other within a single workflow). Templating-only pays the cost once per workflow run. The tradeoff: a single-symbol invocation outside a workflow (e.g., direct `get_stock_quote("IV")`) won't get pre-flight protection — but that case is now handled by Decision 2's silent-zero guard.

**Why not LLM-side disambiguation.** The LLM router *should* learn to distinguish acronyms from tickers in its prompt; we'll add eval fixtures for that. But pre-flight is a deterministic floor that catches both LLM hallucinations and entity-extractor leaks — it's complementary, not redundant.

### Decision 4 — `analyze_correlation` partial-success threshold is 2

**Choice.** If ≥2 symbols return successful history, compute the correlation matrix over the survivors and append a "Symbols dropped" section listing each dropped symbol with its reason. Below 2, emit unavailable with the same per-symbol breakdown.

**Why 2.** Correlation requires a pair. A 1-symbol "matrix" carries no information.

**Why not silently drop.** Listing the dropped symbols is a feature, not a regression — users learn which inputs were invalid and can re-prompt cleanly.

### Decision 5 — Acceptance gate is numeric, not subjective

**Targets.**
| Metric | Target | Rationale |
|---|---|---|
| `eval:router-live` pass-rate | ≥ 90% | Below 90% means the router regularly mis-routes; the rules path's deterministic rules are roughly 70–80% on the same fixtures, so 90% is a meaningful upgrade. |
| p95 router latency | ≤ 1500 ms | Adds at most one network round-trip's latency to the user's perceived response time. |
| Cost per router call | ≤ $0.005 | claude-haiku-4-5 input+output for a typical fixture is well under this. Tracks regressions if we widen the prompt. |

**Process.** Task 1.1 establishes the current baseline with credentials present. Task 1.2 lists which fixtures (if any) fail and decides per-fixture: fix the router, fix the fixture (if recorded answer is wrong), or accept as known-failure with documented reason. A local run without `ANTHROPIC_API_KEY` is inadmissible, so Task 7 keeps `routerMode` defaulting to `rules` and leaves the LLM default promotion to a later change.

**Concrete starting evidence.** A run on this branch produced `1/18` pass-rate and 0–40ms latencies — but with no `ANTHROPIC_API_KEY` in the shell, so the router fell through to the deterministic minimal-fallback path on every call. That run is documented as inadmissible evidence in Task 1.1.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Acronym dictionary incomplete; new finance terms emerge | Dictionary lives in one file; fixture suite catches regressions; observability (`opencandle-symbol-dropped`) lets us discover false negatives in production |
| LLM router cost spike if prompt grows | Cost target in acceptance gate; cost-per-call measured before keeping the `llm` default; alarm threshold for prod monitoring tracked as follow-up |
| Pre-flight resolver search adds latency to comparison workflows | Templating-only scope (single round of validation per workflow); cache validation results within a turn |
| Silent-zero heuristic false-positive on a legitimate near-zero ticker | Heuristic requires all five fields to be zero simultaneously; documented in Decision 2 with explicit confirmation that no observed Yahoo response matches |
| `IV` is technically a real ticker (InvestView Inc., OTC) — disambiguation might block legitimate use | Post-filter retains the symbol when `$IV` or "the IV ticker" is in the input; the bare-acronym case is the one we want dropped. Documented in fixture 019 |
| Rules-mode pass-through can reintroduce a dropped acronym through main-agent tool choice | Compare prompts that drop below two symbols are converted to clarification context before the main agent starts |
| LLM default ships while prod LLM credentials are misconfigured | Acceptance gate must run with credentials present before promotion; this change keeps `rules` as the default and documents `OPENCANDLE_ROUTER_MODE=llm` as opt-in |
| Acceptance gate of 90% chosen on intuition, not measured baseline | Task 1.1 measures actual baseline; if 90% is unrealistic, gate is renegotiated in design.md before keeping `llm` as the default |

## Migration Plan

1. Land acronym/provider/pre-flight/correlation hardening with `rules` as the default and `llm` opt-in.
2. Run `eval:router-live` with credentials; record baseline. (Task 1.1)
3. Triage failures, fix or document. (Task 1.2)
4. If all three numeric targets are green for one continuous verification run in a later change, promote `src/config.ts` to default `llm`. Until then, keep the default at `rules`.
5. Monitor for one release window. Track silent-zero hits, acronym drops, pre-flight aborts via the `opencandle-*` custom entries.
6. Open `remove-rule-router` once stable.

## Open Questions

- **Should `opencandle-symbol-dropped` entries surface to the user, or stay observability-only?** Current plan: observability-only, but display in trace.json. If users frequently re-prompt with `$IV` the silent drop is bad UX. Resolve in eval reading.
- **Do we need a workflow-templating pre-flight cache shared across the workflow's tool calls?** If `compare_companies` validates "AAPL, MSFT, GOOG" up front and `analyze_correlation` re-validates them downstream, that's wasted latency. Resolve when wiring Decision 3 — likely a per-turn `Map<symbol, validation>` in the session coordinator.
- **`InvalidSymbolError` shape.** It should carry `provider` and `symbol`, so `wrapProvider` and `withFallback` unavailable reasons can preserve the failing symbol/provider for tool output and logs.

## Addendum: 2026-07-03 router promotion evidence

The LLM-only router default shipped in 0.11.0 through `product-audit-downscope`, which amended the removal gate from this change's original numeric threshold to the current classified-evidence requirement in the baseline `intent-routing` spec. The accepted gate evidence is recorded at `openspec/changes/archive/2026-07-03-product-audit-downscope/router-live-eval-evidence.md`: `gemini-2.5-flash`, the maintainer's production daily-driver model, reached 6/26 exact routing-contract matches and **25/26 route-kind agreement**. The evidence classifies every failure into classes A-D and explains the single route-kind gap on fixture 017.

This change's original section-1 numeric gate (>= 90% exact match, p95 <= 1500 ms, defined against `claude-haiku-4-5`) is superseded by the `product-audit-downscope` classified-evidence gate. Tasks 1.1-1.3 remain unchecked and are marked superseded rather than completed.

The separate `remove-rule-router` change was created for the same promotion/removal decision and was absorbed by `product-audit-downscope`. It was archived on 2026-07-03 as `openspec/changes/archive/2026-07-03-remove-rule-router/`, with its gate tasks left unchecked because the downscope change supplied the superseding gate record.

A second live `gemini-2.5-flash` run is archived at `tests/fixtures/router/eval-baselines/2026-07-03-gemini-2.5-flash.txt` with 9/26 exact matches and latency p50 1924 ms / p95 2184 ms. The cross-run variance that matters for triage is fixture 022 (`cpi-as-metric`): in the downscope evidence run it held route kind and was classified Class A benign, but in the second run it flipped to `workflow_dispatch` / `compare_assets` with `CPI` surviving in `slots.symbols`, using the same model at temperature 0. Improvements item I9 owns exact-match drift and cross-run instability for Gemini router-contract hardening. Optional Pi-auth Claude-family comparison baseline work belongs to improvements item I5. `acpx` was evaluated and rejected as a router-eval transport because it drives a full agent CLI, not the router's raw prompt-to-JSON `completeSimple` path.
