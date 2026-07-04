## 1. Establish LLM router baseline (gating evidence)

- [ ] 1.1 [superseded by the product-audit-downscope classified-evidence gate — see design addendum] Run `npm run eval:router-live` with `ANTHROPIC_API_KEY` present against the current 26-fixture suite. Record per-fixture pass/fail, latency p50/p95, and total cost. Save the run output to `tests/fixtures/router/eval-baselines/<date>.txt`. Note: local runs without `ANTHROPIC_API_KEY` are inadmissible and require keeping or reverting the default to `rules`.
- [ ] 1.2 [superseded by the product-audit-downscope classified-evidence gate — see design addendum] For each failing fixture from 1.1, classify: (a) router defect — open a sub-task to fix; (b) fixture defect — record the corrected expected output with rationale in a PR comment; (c) accepted known-failure — document in `BASELINE.json` with reason. The acceptance gate (≥90% pass) is computed after this triage.
- [ ] 1.3 [superseded by the product-audit-downscope classified-evidence gate — see design addendum] Decide per-prompt: is 1500 ms p95 achievable on `claude-haiku-4-5`? If not, document in design.md "Risks / Trade-offs" and either widen the budget or pick a faster model.

## 2. Acronym disambiguation post-filter

- [x] 2.1 Create `src/routing/symbol-disambiguator.ts` exporting `FINANCE_ACRONYM_DICTIONARY: Set<string>` and `disambiguateSymbols(candidates: string[], rawInput: string): { kept: string[]; dropped: Array<{ token: string; reason: string }> }`. Initial dictionary: IV, HV, ITM, OTM, ATM, IPO, SEC, FED, FOMC, IRS, ECB, BOE, BOJ, GDP, CPI, PPI, FX, NDA. Keep separate from `COMMON_WORDS` so the regex extractor can stay narrow; do not blanket-drop the common Mastercard ticker `MA`.
- [x] 2.2 Implement signal rules per design.md Decision 1: keep token only if `$<token>` appears in raw input (case-insensitive), or if a local per-token phrase marks it as a ticker/stock/symbol (examples: "IV ticker", "ticker IV", "IV stock", "symbol IV"). Bare comma/and-list adjacency is not a positive signal.
- [x] 2.3 Wire into `src/routing/router.ts` after both branches converge on `entities.symbols`. Apply to rules and LLM paths uniformly.
- [x] 2.4 Emit an `opencandle-symbol-dropped` custom entry per drop containing `{ token, reason, signalsChecked, source: "rules" | "llm" }`.
- [x] 2.5 Extend `COMMON_WORDS` in `src/routing/entity-extractor.ts` with the same dictionary entries — defense in depth so the regex doesn't even produce these as candidates in the rules path.
- [x] 2.6 Unit tests in `tests/unit/routing/symbol-disambiguator.test.ts`: one case per signal rule (positive and negative), one for each dictionary entry, edge cases for `$IV`, "compare AAPL and SEC", "the IV ticker", and "IV crush" (no signal → dropped).
- [x] 2.7 Ensure LLM-router slot merging cannot reintroduce symbols already dropped by acronym disambiguation.
- [x] 2.8 Ensure dropped LLM-router symbols are removed from `symbol`/`symbols` slots before missing-slot checks and fallback context rendering.

## 3. Acronym disambiguation eval fixtures

- [x] 3.1 Author `019-iv-as-volatility.json`: input "Compare these assets: IV, ASTS" with prior turn discussing IV-as-vol. Expected: `entities.symbols = ["ASTS"]`, no IV.
- [x] 3.2 Author `020-sec-as-regulator.json`: input "What did the SEC say about TSLA filings?". Expected: `entities.symbols = ["TSLA"]`, no SEC.
- [x] 3.3 Author `021-fed-as-bank.json`: input "How does FED policy affect TLT?". Expected: `entities.symbols = ["TLT"]`, no FED.
- [x] 3.4 Author `022-cpi-as-metric.json`: input "Show CPI vs SPY YTD". Expected: `entities.symbols = ["SPY"]`, no CPI.
- [x] 3.5 Author `023-iv-with-positive-signal.json`: input "Get me a quote on $IV". Expected: `entities.symbols = ["IV"]` retained because `$`-prefix.
- [x] 3.6 Author `024-iv-bare-list-dropped.json`: input "compare KO, IV, PEP". Expected: `entities.symbols = ["KO","PEP"]`; IV is dropped because bare list context alone is insufficient.
- [x] 3.7 Author `025-iv-local-ticker-phrase.json`: input "compare KO, the IV ticker, and PEP". Expected: `entities.symbols = ["KO","IV","PEP"]`; IV is retained because the local phrase marks it as a ticker.
- [x] 3.8 Update `BASELINE.json`: bump `fixtureCount` to 26, refresh `recordedAt`, append note "fixtures 019–025 cover acronym disambiguation per production-router-and-tool-hardening".
- [x] 3.9 Update `tests/fixtures/router/README.md`: add an "Acronym disambiguation" section explaining the dictionary and signal rules; reference `symbol-disambiguator.ts` for the source of truth.

## 4. Silent-zero guard at provider boundary

- [x] 4.1 Add `class InvalidSymbolError extends Error { constructor(public symbol: string, public provider: string) }` in `src/providers/errors.ts` (new file).
- [x] 4.2 In `src/providers/yahoo-finance.ts::getQuote`, after constructing the `StockQuote` object, check the zero-result heuristic from design.md Decision 2 (`price && volume && week52High && week52Low && marketCap` all zero). If matched, throw `InvalidSymbolError(symbol, "yahoo")` instead of caching/returning. Cache key still set so repeated invalid lookups are cheap.
- [x] 4.3 Same heuristic applied in `getOptionsChain`: if `result.options` is empty and `quote.regularMarketPrice` is missing/zero, throw `InvalidSymbolError`.
- [x] 4.4 Verify `src/providers/wrap-provider.ts` maps `InvalidSymbolError` to `unavailable` with the error message included in `reason`, and that `src/providers/with-fallback.ts` preserves that reason when all providers fail. If not, add the mapping.
- [x] 4.5 Unit test `tests/unit/providers/yahoo-finance.test.ts`: feed the provider a recorded sparse-meta fixture (capture from real Yahoo for a known-bogus ticker like `XXFAKEXX`) and assert `InvalidSymbolError` is thrown with `symbol === "XXFAKEXX"` and `provider === "yahoo"`.
- [x] 4.6 Integration check: invoke `get_stock_quote` tool with `symbol: "XXFAKEXX"` against the harness, assert tool output contains "⚠ Stock quote unavailable" with the symbol, and that no zero-filled `details` object leaks. Evidence: `/tmp/oc-hardening-invalid-tool-IFxvvI/trace.json`.
- [x] 4.7 Regression checks for direct `wrapProvider` Yahoo callers: watchlist check, portfolio view, alert check, daily report run, and prediction check should surface unavailable/data-gap status for an invalid symbol rather than zero-filled quote data.

## 5. Pre-flight ticker validation in workflow templating

- [x] 5.1 Add `preflightSymbols(symbols: string[]): Promise<{ valid: string[]; dropped: Array<{ symbol: string; reason: string }> }>` to `src/prompts/workflow-prompts.ts` (or a sibling module if it grows). Implementation calls resolver-layer search (`searchYahooInstruments` or a thin helper around it), not the `search_ticker` AgentTool object. Cache results per turn via a `Map<string, boolean>` passed in from the session coordinator.
- [x] 5.2 Hook into the multi-symbol workflow templates (`compare_assets`, `analyze_correlation`-bearing prompts, peer screens). Drop unknown symbols, append a `[Pre-flight: dropped ...]` annotation to the templated prompt for each drop.
- [x] 5.3 If a comparison workflow ends up with `< 2` valid symbols after pre-flight, do not template the workflow. Instead emit a fallback that instructs the main agent to invoke `ask_user` with the dropped-symbol context.
- [x] 5.4 Per-turn cache: extend `SessionCoordinator` with a `tickerValidationCache: Map<string, { valid: boolean; checkedAt: number }>` cleared at turn boundaries.
- [x] 5.5 Unit tests in `tests/unit/prompts/workflow-prompts.test.ts`: (a) all valid → no drops; (b) one invalid → annotated drop; (c) all invalid → workflow not templated, ask_user steered; (d) cache hit on second call within the same turn.
- [x] 5.6 Emit `opencandle-symbol-preflight-dropped` custom entry per drop for observability.
- [x] 5.7 Ensure rules-mode preflight aborts set fallback clarification context rather than falling through with the raw prompt.
- [x] 5.8 Ensure Yahoo instrument search uses the shared provider cache and Yahoo rate limiter.
- [x] 5.9 Ensure resolver search outages do not cause workflow preflight to drop user-provided symbols as unknown tickers.
- [x] 5.10 Ensure routed core-market tool bundles include `manage_alerts` and `daily_watchlist_report`.

## 6. `analyze_correlation` partial success

- [x] 6.1 In `src/tools/portfolio/correlation.ts::execute`, replace the all-fail short-circuit with: collect `unavailable` per symbol, build the matrix only over `succeeded`. If `succeeded.length >= 2`, compute as today and append a "Symbols dropped:" section listing each dropped symbol with the wrapped reason. If `succeeded.length < 2`, emit unavailable with the same per-symbol breakdown.
- [x] 6.2 Unit test in `tests/unit/tools/correlation.test.ts`: (a) 3 symbols, 1 fails → matrix over 2, drop noted; (b) 3 symbols, 2 fail → unavailable with 2 reasons; (c) 2 symbols both succeed → unchanged behavior.
- [x] 6.3 Update tool docstring/`description` to mention partial-success behavior so the LLM doesn't re-fetch the workflow on partial drops.

## 7. Verify or Revert the Default

- [x] 7.1 Verify `src/config.ts::resolveRouterMode` defaults to `"rules"` after the credentialed acceptance gate could not be completed; document `OPENCANDLE_ROUTER_MODE=llm` as the opt-in flag.
- [x] 7.2 Gate keeping the `"llm"` default on tasks 1, 2, 3, 4, 5, 6 all green AND the acceptance gate from 1.1/1.2 met (≥90% pass-rate, p95 ≤ 1500ms, cost ≤ $0.005/call). If any condition slips, revert the default to `"rules"` before merge and open a follow-up LLM-default promotion change.
- [x] 7.3 Update `AGENTS.md` ENV FLAGS section: describe the new default and the rollback flag.
- [x] 7.4 Update `CHANGELOG.md` (Unreleased): one-line entry crediting the verified LLM-router default and the silent-zero/disambiguation safety nets, or noting that the default was reverted if the gate failed.

## 8. Live verification (real-runtime, gating per CLAUDE.md §5)

Note 2026-07-03: the `/tmp/.../trace.json` runtime evidence paths below were ephemeral; durable equivalents are the unit/fixture suites covering IV-drop (`tests/unit/routing/symbol-disambiguator.test.ts`), zero-quote invalid-symbol handling (`tests/unit/providers/yahoo-finance.test.ts`), and preflight behavior (`tests/unit/prompts/symbol-preflight.test.ts`, plus dispatch coverage in `tests/unit/pi/opencandle-extension.test.ts`).

- [x] 8.1 Start the dev agent locally with default config. Run the IV-as-vol scenario from the original session. Confirm: (a) "Compare these assets: IV, ASTS" results in IV being dropped with an annotated `customEntries` entry; (b) `get_stock_quote("IV")` returns "⚠ Stock quote unavailable" if IV reaches the quote tool; (c) the agent does not produce a comparison verdict against `$0.00`. Evidence: `/tmp/oc-hardening-iv-jMxjB0/trace.json` and `/tmp/oc-hardening-cashtag2-h1h7Or/trace.json`.
- [x] 8.2 Run positive-control scenarios: "compare $IV with $TICK" and "compare KO, the IV ticker, and PEP". Confirm IV survives the disambiguator and is treated as a ticker. Evidence: `/tmp/oc-hardening-compare-cashtag-TdPXig/trace.json` and `/tmp/oc-hardening-positive-ZEG5YB/trace.json` show IV entered workflow symbols before resolver preflight dropped it as an unavailable ticker; `/tmp/oc-hardening-cashtag2-h1h7Or/trace.json` shows `$IV` reached `get_stock_quote`.
- [x] 8.3 Run the SEC-as-regulator and FED-as-bank scenarios. Confirm both are dropped from `entities.symbols`. Evidence: `/tmp/oc-hardening-sec-eJmVjb/trace.json` and `/tmp/oc-hardening-fed-4047Ba/trace.json`.
- [x] 8.4 Run a 3-symbol correlation where one symbol is bogus. Confirm the matrix returns over the 2 valid symbols with the third surfaced as a drop. Evidence: `/tmp/oc-hardening-corr3-DYvTTJ/trace.json`.
- [x] 8.5 Document each scenario's `trace.json` evidence in the PR description.

## 9. Proposal housekeeping

- [x] 9.1 Confirm spec deltas in `openspec/changes/production-router-and-tool-hardening/specs/` align with `src/` changes after implementation; reconcile any drift before merge.
- [x] 9.2 Open follow-up changes: `forget-command` (priorTurns scrub) and `remove-rule-router` (post-release).
