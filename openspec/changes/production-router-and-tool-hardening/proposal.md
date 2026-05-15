## Why

A live session against opencandle exposed three compounding failure classes that together make the agent confidently wrong on cases a human analyst would catch immediately:

1. **Entity extractor over-tags finance acronyms as tickers.** "Compare these assets: IV, ASTS" routed `IV` (Implied Volatility) to `compare_companies(symbols=["IV","ASTS"])`. Same class previously hit `SEC` (Securities and Exchange Commission). Root cause: `src/routing/entity-extractor.ts` regex matches any 1–5 char all-caps token not in a stoplist; the stoplist has SMA/EMA/RSI/MACD/EPS/etc. but is missing IV, HV, ITM, OTM, ATM, IPO, SEC, FED, FOMC, CPI, GDP, IRS, ECB, BOE, BOJ, FX, M&A.
2. **Yahoo provider returns silent `$0.00` quotes for invalid tickers.** `getQuote("IV")` returns a "successful" `StockQuote` with `price: 0`, `volume: 0`, `week52High: 0`, because Yahoo's chart endpoint emits sparse-meta responses without `chart.error` for many delisted/invalid symbols. Downstream tools and the LLM cannot distinguish "ticker is invalid" from "stock crashed to zero," so the comparison verdict cheerfully reports "ASTS wins on price" against `$0.00`.
3. **LLM router is built but gated off.** `OPENCANDLE_ROUTER_MODE=rules` is the production default; the LLM router (which `router-context-and-observability` just made conversation-aware via priorTurns and observable via `customEntries` in trace.json) is opt-in only. The richer extraction it provides — including disambiguation of ambiguous acronyms via prior-turn context — never reaches users by default.

Promoting the LLM router alone doesn't fix #1 or #2; both sit below the router and would persist regardless of mode. Patching the stoplist alone leaves the long tail of finance acronyms unaddressed and does nothing for silent-zero quotes. The three need to ship together so the rules-mode safety net, the LLM-mode capability, and the provider-layer guards all reinforce each other.

## What Changes

- **Promote LLM router to default.** Flip `OPENCANDLE_ROUTER_MODE` default from `rules` to `llm`. Rules path stays available behind explicit `OPENCANDLE_ROUTER_MODE=rules` for one release as rollback insurance, then `remove-rule-router` (separate change) deletes it. The flip is gated on a numeric acceptance bar: live eval pass-rate ≥ 90%, p95 router latency ≤ 1500ms, and cost-per-turn within budget. The current published baseline is unknown — the first task is to establish it (a prior local run produced 1/18 only because the harness shell had no `ANTHROPIC_API_KEY`, which is not a router-quality signal).
- **Acronym-aware entity post-filter, shared by both router paths.** Add `src/routing/symbol-disambiguator.ts` with a finance-acronym dictionary (IV, HV, ITM, OTM, ATM, IPO, SEC, FED, FOMC, IRS, ECB, BOE, BOJ, GDP, CPI, PPI, FX, M&A, plus all current COMMON_WORDS finance entries). Tokens in this dictionary require an additional positive signal — `$`-prefix, explicit "ticker"/"symbol" keyword, or comma-list adjacency to a known-good ticker — before being retained as a symbol. Wire as a post-filter that runs against `extractedEntities.symbols` regardless of which router path produced them, so the LLM router benefits from the same guardrail when it hallucinates a ticker.
- **Silent-zero guard at the provider boundary.** In `src/providers/yahoo-finance.ts::getQuote`, detect zero-result responses (`price === 0 && volume === 0 && week52High === 0 && week52Low === 0 && marketCap === 0`) and throw a typed `InvalidSymbolError` instead of returning a zero-filled `StockQuote`. `withFallback` already maps thrown errors to `unavailable`, so `stock_quote` will surface "⚠ Stock quote unavailable" rather than "$0.00." Same guard applied to `getOptionsChain` for empty-result responses. Confirmed assumption (per design review): there is no legitimate $0 stock quote we need to preserve — delisted/halted tickers report `null`/missing fields rather than literal `0` across all observed Yahoo response shapes.
- **Pre-flight ticker validation in workflow templating.** Before `src/prompts/workflow-prompts.ts` templates a multi-symbol workflow (`compare_companies`, `analyze_correlation`, peer screens), run a lightweight existence check via the existing `search-ticker` tool. Symbols that fail validation are dropped with an annotated note in the templated prompt; if all symbols fail, the workflow is aborted and the main agent is steered to `ask_user` for clarification. Templating-only scope (not per-tool) so latency cost is paid once per workflow run, not per tool call.
- **Partial-success in `analyze_correlation`.** Today the tool emits "could not fetch history for any symbol" only when *every* symbol fails. When only some fail, the matrix should compute over the survivors and the response should list which symbols were dropped and why. Requires ≥2 successful symbols to produce a matrix; otherwise emit unavailable with the per-symbol drop reasons.
- **Eval coverage for the new failure modes.** Add fixtures specifically for the acronym class (IV-as-vol, SEC-as-regulator, FED-as-bank, CPI-as-metric — both standalone and in compare-style prompts) and a regression fixture for silent-zero quotes against a known-bogus ticker. Update `BASELINE.json`.
- **`/forget` privacy follow-up explicitly deferred.** The prior change identified `/forget` as needed for priorTurns scrubbing; promoting LLM router to default makes this more visible but does not block the flip. Tracked as a separate change.

## Capabilities

### New Capabilities

- `tool-input-validation` — multi-symbol workflows validate symbols against an existence check before templating; unknown symbols are surfaced as drops or escalated to `ask_user` rather than silently passed through to providers.

### Modified Capabilities

- `intent-routing` — default mode is `llm`. Acronym disambiguation post-filter runs against extracted symbols regardless of mode. Numeric acceptance gate documented for the flip.
- `provider-registry` — `getQuote` and `getOptionsChain` MUST surface `unavailable` for zero-result responses rather than emitting zero-filled successes.
- `router-evals` — fixture set MUST include acronym-class disambiguation cases (IV/SEC/FED/CPI) covering both standalone-acronym and acronym-in-compare-list shapes.

## Impact

- **Code:**
  - `src/config.ts` — flip default `routerMode`, document rollback flag.
  - `src/routing/symbol-disambiguator.ts` — new post-filter module.
  - `src/routing/entity-extractor.ts` — extend `COMMON_WORDS` with the missing finance acronyms (defense-in-depth alongside the post-filter).
  - `src/routing/router.ts` — call the post-filter on the symbols field for both rules and LLM paths.
  - `src/providers/yahoo-finance.ts` — `InvalidSymbolError`, zero-result detection in `getQuote` and `getOptionsChain`.
  - `src/providers/with-fallback.ts` — ensure typed-error mapping to `unavailable`.
  - `src/prompts/workflow-prompts.ts` — pre-flight validation hook before multi-symbol templating.
  - `src/tools/portfolio/correlation.ts` — partial-success path with per-symbol drop reasons.
- **Tests:**
  - `tests/fixtures/router/` — new acronym-disambiguation fixtures (~6); updated `BASELINE.json`.
  - `tests/unit/providers/yahoo-finance.test.ts` — zero-result handling regression test.
  - `tests/unit/routing/symbol-disambiguator.test.ts` — full-truth-table coverage of the dictionary + signal rules.
  - `tests/unit/tools/correlation.test.ts` — partial-success path coverage.
  - `tests/unit/prompts/workflow-prompts.test.ts` — pre-flight drops/escalates correctly.
- **Dependencies:** none added.
- **Flags:** `OPENCANDLE_ROUTER_MODE` default flips `rules → llm`. Rules path stays opt-in for one release.
- **Acceptance gate (must be green before flipping default in `src/config.ts`):**
  - `npm run eval:router-live` pass-rate ≥ 90% on the full fixture set, with credentials present (re-run after first attempt produced 1/18 due to missing `ANTHROPIC_API_KEY`).
  - p95 router latency ≤ 1500ms.
  - Cost-per-turn ≤ $0.005 (claude-haiku-4-5 baseline).
  - All new acronym-disambiguation fixtures pass.
- **Follow-ups (separate changes, NOT in this proposal):**
  - `forget-command` — `/forget` slash command scrubs priorTurns and matching memory.
  - `remove-rule-router` — delete rules path entirely after one release with `llm` default green.
  - Optional: per-tool pre-flight if the templating-only scope proves insufficient.
