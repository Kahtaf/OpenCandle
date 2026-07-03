# Product Audit Downscope

## Why

A product/code audit of the current checkout (verified against source, 2026-07-02) found: saved provider API keys are serialized into the GUI catalog payload and prefilled into the browser DOM; `compute_dcf` can emit materially wrong intrinsic values (shares-outstanding fallback of 1, net-cash clamp, unguarded terminal-value spread); `backtest_strategy` fills at the signal close with no costs; daily reports ship an internal placeholder sentence to users and imply scheduling that does not exist; the predictions feature is not wanted as a product surface; the GUI catalog keeps a hand-written form-schema map that has rotted (`calculate_dcf`, `manage_portfolio`, `watchlist`, and a `predict_returns` entry with no backend tool); and two routing paths persist even though the LLM router has been the de-facto daily driver. This change captures the agreed downscope-and-harden direction in one coordinated effort, and absorbs the pending `remove-rule-router` change.

## What Changes

- **Security:** Stop sending saved API keys to the browser. Catalog payload returns configured-status plus masked hint; the provider form offers replace-only input.
- **BREAKING — Remove predictions:** Delete the `track_prediction` tool, PredictionsPage, prediction view model/card/nav, prediction storage methods, prompt-context blocks, routing triggers, policy-card references, and competitive-benchmark prediction seeding. Add a schema migration that drops `prediction_records`.
- Delete the orphaned `predict_returns` GUI form schema (no backend tool exists).
- **Catalog integrity:** Generate GUI catalog tool forms from the served Typebox `parameters` already in the catalog payload; delete the hand-written `tool-schemas.js` map (keep a thin label/default overrides layer).
- **DCF hardening:** Refuse to compute without a real share count, allow negative net debt (net cash), guard `discountRate <= terminalGrowth` on the main path; add a TUI harness test driving a DCF prompt end to end.
- **Backtest realism:** Fill at the next bar's open instead of the signal close, apply a flat cost/slippage assumption, and disclose limitations (no dividends, taxes, liquidity modeling) in output.
- **Reports reframing:** Present daily reports as an on-demand watchlist digest until cron + channel delivery exists: remove the shipped "Deferred unless quote/history data is available through a later section builder" placeholder, stop auto-creating an enabled schedule template on manual runs, and drop cadence/scheduling UI from the GUI report surface.
- **BREAKING — LLM router becomes the only production path:** Flip the unset-env default to `llm`, remove the legacy rules-router input dispatch, preserve deterministic post-processing safety nets (acronym disambiguation, symbol preflight, provider/tool validation), and remove `OPENCANDLE_ROUTER_MODE=rules` as a production mode (implements the pending `remove-rule-router` change).
- **BREAKING — Fold debate into `/analyze`:** Remove `OPENCANDLE_DEBATE` (already defaults on); comprehensive analysis always runs the bull/bear/rebuttal debate; delete the no-debate prompt variants.
- **Positioning:** Demote `/analyze` from first-suggested prompt to a clearly-labeled deep-research option in the GUI empty state, README, and docs; lead with fast keyless prompts.
- **Verification (no code change unless it fails):** Reddit/X sentiment end-to-end pass with live `rdt`/`twitter` sessions.

Explicitly no action (audit closed these): alerts keep the persistent-process model with no apologetic always-on copy (matches Hermes Agent / OpenClaw daemon model; channels arrive later); runtime answer/artifact contracts are already internal trace-only with no user-facing product claims.

## Capabilities

### New Capabilities

- `quant-tool-integrity`: Correctness and honesty requirements for quantitative tools that emit authoritative-looking numbers — DCF input guards and refusal behavior, backtest execution realism and limitations disclosure, end-to-end harness coverage.

### Modified Capabilities

- `pi-synced-gui`: Catalog payload never contains credential secrets; tool invocation forms derive from served tool parameter schemas rather than a hand-written map; empty-state prompt suggestions lead with fast keyless prompts and label `/analyze` as deep research.
- `user-market-state`: The `Prediction Lifecycle Is Explicit` requirement is removed; schema upgrade drops `prediction_records` while preserving all other user rows.
- `stateful-market-surfaces`: Durable market-state navigation and equivalent TUI workflows no longer include predictions; stateful tracking routes cover watchlist/portfolio/alerts/reports only.
- `market-state-user-experience`: The daily report's stable user-facing shape has no placeholder sections and presents as an on-demand digest; prediction page UX requirements are removed.
- `market-alerts-and-reports`: Manual report generation does not create or imply an enabled schedule; report templates/runs remain durable.
- `intent-routing`: The LLM router is the primary and only production routing path; the deterministic router survives only as post-processing safety nets; the `rules` mode value is removed.
- `structured-analysts`: Comprehensive analysis always includes the adversarial debate steps; no configuration gate.
- `agent-planning-layer`: The stateful-tracking policy scope no longer includes prediction recording/checking.

## Impact

- **Code:** `gui/server/tool-metadata.ts`, `gui/web/src/features/catalog/` (CatalogOverlay, tool-schemas), `src/tools/fundamentals/dcf.ts`, `src/tools/technical/backtest.ts`, `src/tools/portfolio/predictions.ts` (deleted), `src/tools/index.ts`, `src/market-state/service.ts`, `src/memory/sqlite.ts` (v8 migration), `src/market-state/daily-report.ts`, `gui/server/market-state-api.ts`, `gui/server/invoke-tool.ts`, `gui/web/src/features/market-state/` (PredictionsPage deleted, WatchlistPage/MarketStatePage surgery), `gui/web/src/router.jsx`, `App.jsx`, `SessionHistory.jsx`, `FinancialContextPanel.jsx`, renderers cards, `src/routing/` (route-manifest, classify-intent, router, router-prompt, legacy-rule-router deleted), `src/config.ts`, `src/pi/opencandle-extension.ts`, `src/analysts/orchestrator.ts`, `src/runtime/session-coordinator.ts`, `src/prompts/policy-cards.ts`, `src/prompts/context-builder.ts`, `src/system-prompt.ts`, `gui/web/src/components/chat/prompt-suggestions.jsx`, README/docs.
- **Data:** SQLite schema v7 → v8 (drop `prediction_records`); existing watchlist/portfolio/alert/report rows preserved.
- **Config surface:** `OPENCANDLE_ROUTER_MODE=rules` removed; `OPENCANDLE_DEBATE` removed; both are breaking for users pinning those env vars.
- **Tests:** prediction test files deleted; shared market-state/routing/prompt/eval tests updated; competitive benchmark seed fixture trimmed; new DCF harness test; router eval gate (`npm run eval:router-live`) run as acceptance evidence before the rules-router removal lands.
- **Supersedes:** `openspec/changes/remove-rule-router/` (its proposal/spec/tasks are folded into this change; archive it when this lands).
- **Dependencies:** none added.
