## 1. Establish LLM router baseline (gating evidence)

- [ ] 1.1 Run `npm run eval:router-live` with `ANTHROPIC_API_KEY` present against the current 18-fixture suite. Record per-fixture pass/fail, latency p50/p95, and total cost. Save the run output to `tests/fixtures/router/eval-baselines/<date>.txt`. Note: a prior run produced 1/18 passing solely because credentials were missing; that run is inadmissible.
- [ ] 1.2 For each failing fixture from 1.1, classify: (a) router defect — open a sub-task to fix; (b) fixture defect — record the corrected expected output with rationale in a PR comment; (c) accepted known-failure — document in `BASELINE.json` with reason. The acceptance gate (≥90% pass) is computed after this triage.
- [ ] 1.3 Decide per-prompt: is 1500 ms p95 achievable on `claude-haiku-4-5`? If not, document in design.md "Risks / Trade-offs" and either widen the budget or pick a faster model.

## 2. Acronym disambiguation post-filter

- [ ] 2.1 Create `src/routing/symbol-disambiguator.ts` exporting `FINANCE_ACRONYM_DICTIONARY: Set<string>` and `disambiguateSymbols(candidates: string[], rawInput: string): { kept: string[]; dropped: Array<{ token: string; reason: string }> }`. Initial dictionary: IV, HV, ITM, OTM, ATM, IPO, SEC, FED, FOMC, IRS, ECB, BOE, BOJ, GDP, CPI, PPI, FX, MA, NDA. Keep separate from `COMMON_WORDS` so the regex extractor can stay narrow.
- [ ] 2.2 Implement signal rules per design.md Decision 1: keep token if `$<token>` in raw input (case-insensitive) OR raw input contains `\b(ticker|symbol|stock)\b` OR token appears in a comma/and-list with ≥1 non-dictionary candidate.
- [ ] 2.3 Wire into `src/routing/router.ts` after both branches converge on `entities.symbols`. Apply to rules and LLM paths uniformly.
- [ ] 2.4 Emit an `opencandle-symbol-dropped` custom entry per drop containing `{ token, reason, signalsChecked, source: "rules" | "llm" }`.
- [ ] 2.5 Extend `COMMON_WORDS` in `src/routing/entity-extractor.ts` with the same dictionary entries — defense in depth so the regex doesn't even produce these as candidates in the rules path.
- [ ] 2.6 Unit tests in `tests/unit/routing/symbol-disambiguator.test.ts`: one case per signal rule (positive and negative), one for each dictionary entry, edge cases for `$IV`, "compare AAPL and SEC", "the IV ticker", and "IV crush" (no signal → dropped).

## 3. Acronym disambiguation eval fixtures

- [ ] 3.1 Author `019-iv-as-volatility.json`: input "Compare these assets: IV, ASTS" with prior turn discussing IV-as-vol. Expected: `entities.symbols = ["ASTS"]`, no IV.
- [ ] 3.2 Author `020-sec-as-regulator.json`: input "What did the SEC say about TSLA filings?". Expected: `entities.symbols = ["TSLA"]`, no SEC.
- [ ] 3.3 Author `021-fed-as-bank.json`: input "How does FED policy affect TLT?". Expected: `entities.symbols = ["TLT"]`, no FED.
- [ ] 3.4 Author `022-cpi-as-metric.json`: input "Show CPI vs SPY YTD". Expected: `entities.symbols = ["SPY"]`, no CPI.
- [ ] 3.5 Author `023-iv-with-positive-signal.json`: input "Get me a quote on $IV". Expected: `entities.symbols = ["IV"]` retained because `$`-prefix.
- [ ] 3.6 Author `024-iv-in-list-context.json`: input "compare KO, IV, PEP". Expected: `entities.symbols = ["KO","IV","PEP"]` retained because IV is in a comma-list with non-dictionary tickers.
- [ ] 3.7 Update `BASELINE.json`: bump `fixtureCount` to 24, refresh `recordedAt`, append note "fixtures 019–024 cover acronym disambiguation per production-router-and-tool-hardening".
- [ ] 3.8 Update `tests/fixtures/router/README.md`: add an "Acronym disambiguation" section explaining the dictionary and signal rules; reference `symbol-disambiguator.ts` for the source of truth.

## 4. Silent-zero guard at provider boundary

- [ ] 4.1 Add `class InvalidSymbolError extends Error { constructor(public symbol: string, public provider: string) }` in `src/providers/errors.ts` (new file).
- [ ] 4.2 In `src/providers/yahoo-finance.ts::getQuote`, after constructing the `StockQuote` object, check the zero-result heuristic from design.md Decision 2 (`price && volume && week52High && week52Low && marketCap` all zero). If matched, throw `InvalidSymbolError(symbol, "yahoo")` instead of caching/returning. Cache key still set so repeated invalid lookups are cheap.
- [ ] 4.3 Same heuristic applied in `getOptionsChain`: if `result.options` is empty and `quote.regularMarketPrice` is missing/zero, throw `InvalidSymbolError`.
- [ ] 4.4 Verify `src/providers/with-fallback.ts` maps thrown errors to `unavailable` with the error message included in `reason`. If not, add the mapping.
- [ ] 4.5 Unit test `tests/unit/providers/yahoo-finance.test.ts`: feed the provider a recorded sparse-meta fixture (capture from real Yahoo for a known-bogus ticker like `XXFAKEXX`) and assert `InvalidSymbolError` is thrown with `symbol === "XXFAKEXX"` and `provider === "yahoo"`.
- [ ] 4.6 Integration check: invoke `get_stock_quote` tool with `symbol: "XXFAKEXX"` against the harness, assert tool output contains "⚠ Stock quote unavailable" with the symbol, and that no zero-filled `details` object leaks.

## 5. Pre-flight ticker validation in workflow templating

- [ ] 5.1 Add `preflightSymbols(symbols: string[]): Promise<{ valid: string[]; dropped: Array<{ symbol: string; reason: string }> }>` to `src/prompts/workflow-prompts.ts` (or a sibling module if it grows). Implementation calls the existing `searchTicker` provider once per symbol; cache results per turn via a `Map<string, boolean>` passed in from the session coordinator.
- [ ] 5.2 Hook into the multi-symbol workflow templates (`compare_assets`, `analyze_correlation`-bearing prompts, peer screens). Drop unknown symbols, append a `[Pre-flight: dropped ...]` annotation to the templated prompt for each drop.
- [ ] 5.3 If a comparison workflow ends up with `< 2` valid symbols after pre-flight, do not template the workflow. Instead emit a fallback that instructs the main agent to invoke `ask_user` with the dropped-symbol context.
- [ ] 5.4 Per-turn cache: extend `SessionCoordinator` with a `tickerValidationCache: Map<string, { valid: boolean; checkedAt: number }>` cleared at turn boundaries.
- [ ] 5.5 Unit tests in `tests/unit/prompts/workflow-prompts.test.ts`: (a) all valid → no drops; (b) one invalid → annotated drop; (c) all invalid → workflow not templated, ask_user steered; (d) cache hit on second call within the same turn.
- [ ] 5.6 Emit `opencandle-symbol-preflight-dropped` custom entry per drop for observability.

## 6. `analyze_correlation` partial success

- [ ] 6.1 In `src/tools/portfolio/correlation.ts::execute`, replace the all-fail short-circuit with: collect `unavailable` per symbol, build the matrix only over `succeeded`. If `succeeded.length >= 2`, compute as today and append a "Symbols dropped:" section listing each dropped symbol with the wrapped reason. If `succeeded.length < 2`, emit unavailable with the same per-symbol breakdown.
- [ ] 6.2 Unit test in `tests/unit/tools/correlation.test.ts`: (a) 3 symbols, 1 fails → matrix over 2, drop noted; (b) 3 symbols, 2 fail → unavailable with 2 reasons; (c) 2 symbols both succeed → unchanged behavior.
- [ ] 6.3 Update tool docstring/`description` to mention partial-success behavior so the LLM doesn't re-fetch the workflow on partial drops.

## 7. Flip the default

- [ ] 7.1 In `src/config.ts::resolveRouterMode`, change the default from `"rules"` to `"llm"`. Update the doc comment to describe `OPENCANDLE_ROUTER_MODE=rules` as the rollback flag.
- [ ] 7.2 Gate this commit on tasks 1, 2, 3, 4, 5, 6 all green AND the acceptance gate from 1.1/1.2 met (≥90% pass-rate, p95 ≤ 1500ms, cost ≤ $0.005/call). If any condition slips, do not flip — open a sub-task to investigate and document.
- [ ] 7.3 Update `AGENTS.md` ENV FLAGS section: describe the new default and the rollback flag.
- [ ] 7.4 Update `CHANGELOG.md` (Unreleased): one-line entry crediting the LLM-router default flip and the silent-zero/disambiguation safety nets.

## 8. Live verification (real-runtime, gating per CLAUDE.md §5)

- [ ] 8.1 Start the dev agent locally with default config (LLM mode after 7.1). Run the IV-as-vol scenario from the original session. Confirm: (a) "Compare these assets: IV, ASTS" results in IV being dropped with an annotated `customEntries` entry; (b) `get_stock_quote("IV")` returns "⚠ Stock quote unavailable"; (c) the agent does not produce a comparison verdict against `$0.00`.
- [ ] 8.2 Run a positive-control scenario: "compare $IV with $TICK" with $-prefix on both. Confirm IV survives the disambiguator and is treated as a ticker.
- [ ] 8.3 Run the SEC-as-regulator and FED-as-bank scenarios. Confirm both are dropped from `entities.symbols`.
- [ ] 8.4 Run a 3-symbol correlation where one symbol is bogus. Confirm the matrix returns over the 2 valid symbols with the third surfaced as a drop.
- [ ] 8.5 Document each scenario's `trace.json` evidence in the PR description.

## 9. Proposal housekeeping

- [ ] 9.1 Confirm spec deltas in `openspec/changes/production-router-and-tool-hardening/specs/` align with `src/` changes after implementation; reconcile any drift before merge.
- [ ] 9.2 Open follow-up changes: `forget-command` (priorTurns scrub) and `remove-rule-router` (post-release).
