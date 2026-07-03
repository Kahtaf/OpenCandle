# Design: Product Audit Downscope

## Context

A verified product/code audit (2026-07-02) identified one security exposure, two quantitative tools that can emit materially wrong numbers, an unfinished report surface, a feature slated for full removal (predictions), a rotting hand-written GUI form-schema map, and a duplicated routing layer. The current state, all confirmed against source:

- `gui/server/tool-metadata.ts:83` serializes `credential.value` into the catalog payload; `CatalogOverlay.jsx:681` prefills it into the DOM.
- `src/tools/fundamentals/dcf.ts:248` falls back to `sharesOutstanding = 1`; `:257` clamps net debt to `>= 0`; `:58` divides by `discountRate - terminalGrowth` unguarded on the main path (only the sensitivity loop guards it).
- `src/tools/technical/backtest.ts:64-68` fills buys at the same close used to compute the signal, across all three strategies; no costs/slippage/dividends.
- `src/market-state/daily-report.ts:132-133` ships "Deferred unless quote/history data is available through a later section builder" to users; `:30-38` auto-creates an enabled daily template on manual runs.
- Predictions surface inventory is complete (tool, storage, GUI, routing, prompts, evals — see tasks.md); the feature is being removed as a product decision.
- `gui/web/src/features/catalog/tool-schemas.js` contains stale keys (`calculate_dcf`, `manage_portfolio`, `watchlist`) and an orphan `predict_returns` entry with no backend tool, while the server already sends real Typebox `parameters` per tool.
- `src/config.ts:144` defaults `OPENCANDLE_ROUTER_MODE` to `rules`; the LLM router is the de-facto daily driver; the "acceptance gate" is the opt-in `eval:router-live` script. A pending `remove-rule-router` change already proposes consolidation and is absorbed here.
- `OPENCANDLE_DEBATE` defaults to on; the flag only exists to select no-debate prompt variants.

The alert model (persistent local process, channels later) matches the Hermes Agent / OpenClaw daemon pattern and needs no change. Runtime answer/artifact contracts are already internal trace-only with no user-facing claims — no action.

## Goals / Non-Goals

**Goals:**

- Never expose stored credential secrets to the browser.
- Quantitative tool outputs (DCF, backtest) are either correct-with-stated-assumptions or explicit refusals — never silently wrong numbers.
- Remove the predictions feature completely, including durable storage, with a safe migration.
- One source of truth for GUI catalog tool forms (the served Typebox schemas).
- One production routing path (LLM router) with deterministic post-processing safety nets retained.
- Reports present honestly as an on-demand digest until cron + channel delivery ships.

**Non-Goals:**

- Building cron scheduling or Telegram/Slack/webhook channel delivery (future change; the digest generator is kept compatible as the future cron payload).
- Changing alert semantics or copy.
- Activating or removing the trace-only contract machinery in `src/runtime/`.
- Multi-stage DCF models or a realistic execution simulator (costs beyond a flat assumption, liquidity modeling).
- Touching the Reddit/X sentiment pipeline beyond an end-to-end verification pass.

## Decisions

**D1 — Key redaction shape.** The catalog payload replaces `apiKey: credential.value` with `{ configured: boolean, maskedHint: string }` (e.g. last 4 chars). The provider form renders a "configured" state with a replace-only empty input; saving a new key uses the existing `provider.save_api_key` path unchanged. Alternative considered: keep sending the key but only over the trusted-session channel — rejected; the browser DOM/devtools/extension surface is the exposure, not the transport.

**D2 — DCF refuses instead of guessing.** When market cap or price is unavailable, the tool returns an explicit "cannot compute per-share value" result naming the missing input, mirroring the existing negative-FCF refusal at `dcf.ts:223-233`. Net debt passes through signed (net cash increases equity value). `discountRate <= terminalGrowth` returns a validation error before computation. Alternative considered: fetching shares outstanding from a second provider — deferred; refusal is correct and honest, provider redundancy is a separate concern.

**D3 — Backtest realism floor, not a simulator.** Signals computed at bar N's close fill at bar N+1's open (requires threading opens through the shared fill loop; last-bar signals report an unfilled pending signal instead of a phantom trade). A flat default cost per side (basis points, overridable parameter) applies to every fill. Output always includes a limitations block (no dividends, taxes, liquidity, or intrabar modeling). Alternative considered: hiding the tool — rejected; it is deterministically routed, eval-covered, and only reachable by explicit "backtest" prompts, so an honest floor is cheaper and more useful than removal.

**D4 — Predictions removal is deletion plus surgical edits, with a v8 migration.** Whole-file deletions where the file is the feature (tool, page, view model, dedicated tests); surgical edits where entangled (MarketStateService, quote-snapshot poller, watchlist inspector, routing regexes, policy cards, prompt context, competitive-benchmark fixture). SQLite migrates v7 → v8 by dropping `prediction_records`; the migration is destructive by design and is the explicit opt-in this change constitutes — existing scenario language about preserving prediction rows is amended in the spec deltas. Alternative considered: leaving the orphan table — rejected; a dead table with an FK into `instruments` blocks instrument deletion semantics forever.

**D5 — Catalog forms derive from served schemas.** `CatalogOverlay` builds forms from each tool's `parameters` (already in the payload) via a Typebox-JSON-schema-to-form-field mapper; `tool-schemas.js` is deleted and replaced by a thin optional overrides map keyed by *current* tool names (labels, placeholder examples, curated defaults only — never field definitions). The existing `deriveGenericSchema` fallback becomes the primary path, upgraded to honor descriptions, enums, defaults, and required flags. Alternative considered: regenerating the handwritten map — rejected; it recreates the drift class this fixes.

**D6 — Router consolidation lands in two moves inside one change.** Move 1: flip the default to `llm` and run the acceptance evidence (`npm run eval:router-live` at 100% pass, recorded in the PR). Move 2: remove the rules-mode dispatch branch and `legacy-rule-router.ts`, keeping deterministic post-processing (acronym disambiguation, symbol preflight, compare-abort clarification, provider/tool validation) which already runs on LLM output. `OPENCANDLE_ROUTER_MODE` validation rejects `rules` with a clear migration error rather than silently accepting it. Alternative considered: a deprecation window keeping `rules` functional — rejected by product owner; the LLM path has been the daily driver and the rules path is where recurring bugs live.

**D7 — Debate flag deleted, debate unconditional.** `buildComprehensiveAnalysisDefinition` loses its `debate` option; the no-debate prompt variants (`SYNTHESIS_PROMPT_NO_DEBATE`, `VALIDATION_PROMPT_NO_DEBATE`) are deleted; config resolution for `OPENCANDLE_DEBATE` and its docs row are removed. Setting the env var becomes a no-op (ignored, not an error) since it was a tuning flag, not a mode.

**D8 — Reports become "digest on demand".** The generator drops the Technical snapshot placeholder section entirely (it returns when a real section builder exists). Manual generation records a run without creating or linking an enabled schedule template; `getOrCreateDefaultWatchlistReportTemplate` is only invoked by an explicit "set up a morning report" flow, which stores schedule intent but is presented as inert until a scheduler exists. GUI Reports page drops cadence/time-picker UI in favor of "Generate digest" + history. The durable template/run schema is unchanged, so the future cron change is additive.

**D9 — `/analyze` repositioning is copy-only.** GUI empty-state suggestions, README example order, and docs first-prompt lists lead with keyless quick prompts; `/analyze` moves down with a "deep research — runs a multi-analyst debate, takes a few minutes" label. No routing or workflow changes.

## Risks / Trade-offs

- [Dropping `prediction_records` destroys user data] → v8 migration logs what it drops; this change's proposal/spec is the explicit destructive opt-in required by the existing schema-upgrade spec; release notes flag it as BREAKING.
- [Removing the rules router deletes the rollback path if the LLM router regresses] → acceptance evidence recorded before removal lands; deterministic post-processing safety nets stay; git history preserves the router for emergency restoration; the `eval:router-live` fixture suite remains the regression tripwire.
- [Schema-derived catalog forms render worse than hand-tuned ones for complex tools] → overrides layer allows curated labels/defaults per tool without redefining fields; Typebox descriptions already exist on most tool params per code style.
- [Next-open fills change backtest eval baselines] → faithfulness/routing eval fixtures assert tool selection and metric presence, not exact returns; verify and re-baseline only if a scorer pins numbers.
- [Users with `OPENCANDLE_ROUTER_MODE=rules` or `OPENCANDLE_DEBATE` pinned break or silently change behavior] → `rules` fails fast with a migration message; `OPENCANDLE_DEBATE` is ignored (documented in CHANGELOG); both listed as BREAKING.
- [Predictions removal misses an entangled reference and breaks shared tests] → the removal inventory in tasks.md was generated by exhaustive search; `npm test` + typecheck gate each surgical edit; explicitly-do-not-touch list (watchlist `thesis`, analyst `conviction`, `filing_thesis_review`, eval superiority scorecard) guards against over-deletion.

## Migration Plan

1. Land key redaction (isolated, highest severity).
2. Land predictions removal + v8 migration + `predict_returns`/catalog-schema work (shrinks every downstream surface).
3. Flip router default to `llm` with acceptance evidence; remove rules dispatch + `legacy-rule-router.ts` in the same release once green.
4. Delete debate flag; harden DCF and backtest with new tests (including the DCF TUI harness test).
5. Reports reframing + `/analyze` repositioning + docs updates.
6. Reddit/X sentiment end-to-end verification pass; file follow-up fixes only for what it surfaces.
7. Archive the superseded `openspec/changes/remove-rule-router/` change.

Rollback: each step is an independent PR; steps 1, 4, 5 revert cleanly. Step 2's migration is one-way (table drop) — rollback restores code but not user prediction rows. Step 3 rollback = revert the PR (router code returns via git).

## Open Questions

- Backtest default cost assumption (flat bps per side): pick 5 bps default unless the product owner prefers a different figure — parameterized either way.
- Should the "set up a morning report" flow remain reachable at all before the scheduler exists, or be hidden entirely until the cron change? Default: keep reachable but explicitly inert ("stored; will run when scheduling ships").
