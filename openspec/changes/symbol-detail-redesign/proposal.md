# Symbol Detail Redesign

## Why

The `/symbol/$ticker` page shipped in 0.13 as a single centered column (max 1120px): quote header, area chart, an equity-only key-stats grid, position/alerts/watchlist cards, and analyze prompts. It is functional but flat: every number is printed raw with no interpretation, the page ignores the desktop canvas the other market pages now use, non-equity symbols are detected by a string heuristic (`^` prefix / `-USD` suffix) that silently misses FX and commodities, and nothing on the page connects price action to the alert and analysis flows OpenCandle actually offers.

A structural review of Obside's asset page (app.obside.com, ASTS and BTC, 2026-08-05) plus curated references (Perplexity Finance, Fey, Revolut, Origin, Quicken, OKX, Uniswap; see `design.md`) shows the same shell can serve every asset type when stats carry per-type vocabulary and non-applicable sections drop out entirely. The strongest ideas are cheap for us: every derivation below uses data OpenCandle already fetches.

## What Changes

- Rebuild the symbol page on the shared `DetailRailLayout`: full-width primary column (hero, chart, fundamentals, about) plus a fixed right rail (key levels, your position, alerts, watchlist membership, analyze actions). Mobile stacks in priority order.
- Add a hero stat strip under the price block: 5D / 1M / YTD / 1Y / distance from 52-week high / day range / volume vs 30-day average, with per-asset-type vocabulary swaps and shaped skeletons.
- Translate numbers the page already has instead of printing them bare: volume as a multiple of average, key levels with $ and % distance from the current price.
- Add a key levels card (52-week high/low, 20/50-day moving averages) with a Create alert action prefilled at the level, reusing the alert sheet's threshold prefill.
- Add a deterministic trend summary: price vs 20/50/200-day moving averages per horizon labeled in plain English, computed in the view model with no model calls.
- Replace the non-equity string heuristic with an explicit per-asset-type descriptor that selects stats, sections, and vocabulary; sections that do not apply are omitted, never rendered empty.
- Add per-symbol action chips that prefill the chat composer or alert sheet, keeping existing writer/follower degradation.
- Local GUI and hosted PWA behave the same; hosted omits sections whose data needs a capability that is not negotiated.

Explicit non-goals (see `design.md` D7): analyst consensus/targets (no ratings provider; never fake it), peers table (no peers provider), auto-generated AI summary paragraphs (our equivalent is `/analyze`), and any trade execution or simulation surface.

## Capabilities

### New Capabilities
- `symbol-detail-page`: the per-symbol research page — layout, derived stats and their honesty rules, per-asset-type degradation, and its connections into alerts, watchlists, portfolios, and chat.

### Modified Capabilities

<!-- none: alerts, watchlists, portfolio, and chart capabilities are consumed as-is; the alert threshold-prefill entry point already exists -->

## Impact

- `gui/web/src/features/symbol/` (rebuilt page composition and view models), `gui/web/src/features/market-state/` (shared formatting reuse), `gui/web/src/components/ui/detail-rail-layout.jsx` (consumed, not changed).
- New pure view-model modules with unit tests for stat-strip, key-levels, and trend derivations (fixture-driven; no live calls).
- `GET /api/instruments/history` / `overview` consumed as-is; hosted transport unchanged. No new relay endpoints.
- Tests: unit coverage for every derivation and descriptor, screenshot phases for the new layout, browser verification on both surfaces at desktop and mobile widths.
- Reference images for this work live machine-local in `tmp/screenshots/08-symbol-detail/` (served over the tailnet); they are not committed per the repo evidence policy.
