# Market Chart: Interactive Price Charts for the Local GUI

## Why

The GUI's only price visualization today is the hand-rolled SVG sparkline (`gui/web/src/components/market-sparkline.jsx`, fed by `fetchSparklineSnapshot` at `gui/server/market-state-api.ts:425`) — no candlesticks, no range switching, no crosshair, no volume, no multi-series comparison. Two in-flight changes (`symbol-page`, `chat-answer-charts`) both need a real chart; without a shared foundation each would grow its own. This change ships that foundation once: a reusable `MarketChart` component on self-hosted TradingView lightweight-charts v5 (Apache-2.0, canvas, ~35 kB min, no external network), plus the read-only GUI server history endpoint that page-level consumers fetch from.

A completed library spike (recorded in `design.md`) chose lightweight-charts v5 over TradingView iframe widgets (external network, TV-sourced data bypassing OpenCandle's provider layer and freshness ledger, and a free-license ban on private/internal use), recharts (no candlestick series, SVG performance ceiling), extending the hand-rolled SVG, and uPlot/visx.

## What Changes

- **Blocking provider fix:** `getHistory` in `src/providers/yahoo-finance.ts:510` maps each bar's epoch-second timestamp to a date-only string (`new Date(ts * 1000).toISOString().split("T")[0]`), so intraday bars (e.g. 1d/5m) all collapse to the same date. Add an additive epoch-second `timestamp` field to `OHLCV` (`src/types/market.ts:26`) populated by `getHistory`, preserving the existing `date` field and every current consumer.
- **New GUI server endpoint** `GET /api/instruments/history?symbol=&range=&interval=` in `gui/server/http-routes.ts`, registered beside `/api/instruments/quote` (~line 254), guarded by `allowTrustedGuiRequest`, follower-safe (no session, no writer lock — same read-only pattern as `fetchSparklineSnapshot`). Backed by a new `getInstrumentHistorySnapshot()` in `gui/server/market-state-api.ts` with a server-side range→interval map that respects Yahoo intraday depth caps, and a small SWR memo keyed `symbol|range|interval` mirroring `QuoteSnapshotStore` (`gui/server/quote-snapshot-store.ts`: 60s max age, single in-flight promise) to coalesce range-button bursts. This change **owns** the history endpoint; the parallel `symbol-page` change consumes it and must not duplicate it.
- **New `MarketChart` component** (`gui/web/src/components/market-chart.jsx`) on lightweight-charts v5 (new npm dependency in `gui/web`): area / candlestick / indexed (multi-series % change) modes, controlled keyboard-operable range selector, previous-close price line, default-on crosshair tooltip (date/time, OHLC/price, volume, tabular numerals), volume histogram on its own bottom scale margin, design-token theming with a shared fixed categorical series palette (extracted from `PortfolioPage`'s `ALLOCATION_COLORS` into `gui/web/src/lib/series-colors.js`), legend + line-end direct labels so series identity is never color-alone, container aria-label, mobile auto-resize, on-canvas TradingView attribution kept on. Styling parameterizes into the existing minimal-shadcn design language (DESIGN.md normative) — no new aesthetic. The prop contract is a **stable API** — `symbol-page` and `chat-answer-charts` build against it. Data always arrives via props; the component never fetches.
- **New `useInstrumentHistory(symbol, range)` hook** (`gui/web/src/hooks/`) fetching the endpoint with loading/stale states, for page-level consumers (chat cards pass data directly).
- **No-embed test guard:** alongside the existing `expect(html).not.toContain("ticker-line.com")` assertion (`tests/unit/gui-web/market-state-page-render.test.ts:144`), add sibling assertions that chart markup contains no `<iframe>` and no `tradingview.com` src, encoding the no-embed decision.
- **Attribution compliance:** keep the default-on on-canvas `attributionLogo`; add the two-line NOTICE attribution to an about/attribution surface.

## Capabilities

### New Capabilities

- `market-chart`: the GUI instrument-history endpoint (shape, guard, follower access, range→interval map, depth caps, SWR memo), the intraday timestamp fix on `OHLCV`, and the `MarketChart` component contract (modes, controlled range selector with interaction/keyboard standards, prevClose line, volume, crosshair tooltip, token theming, shared series palette, legend/direct-label identity rules, accessibility label, unmount cleanup, no-network/no-iframe guarantee, attribution).

### Modified Capabilities

_None — no existing spec's requirements change. The `OHLCV` timestamp addition is additive and covered inside `market-chart`._

## Non-Goals

- No indicator overlays or RSI/MACD sub-panes (follow-up; `src/tools/technical/indicators.ts` already computes SMA/EMA/BB/RSI/MACD locally for a later panes change).
- No live `series.update()` streaming from the quote poller (follow-up).
- No extended-hours shading (follow-up).
- No per-chart compare-fetching UI (the `compare=` query param is reserved, unimplemented).
- No demo page or production mount — `symbol-page` and `chat-answer-charts` mount the component; this change ships a minimal render test only.
- No replacement of the existing sparkline or recharts usage.

## Dependencies

None — this change is a **foundation**. `symbol-page` and `chat-answer-charts` hard-depend on the `MarketChart` prop contract, and `symbol-page` on the history endpoint: land this before or simultaneously with those. Safe to build in parallel with `lse-data-provider` (its LSE `/candles` deep-intraday fallback lands in the provider layer, so this endpoint benefits automatically through `getHistory`'s fallback chain — a soft, non-blocking enhancement, not a dependency).

## Impact

- `src/providers/yahoo-finance.ts` — populate `timestamp` in `getHistory` bars (additive).
- `src/types/market.ts` — optional `timestamp` on `OHLCV` (additive).
- `gui/server/http-routes.ts`, `gui/server/market-state-api.ts` — new guarded read-only route + snapshot builder + SWR memo.
- `gui/web/package.json` — new `lightweight-charts` v5 dependency (self-hosted, Apache-2.0; bundle impact ~35 kB min, lazy-loaded).
- `gui/web/src/components/market-chart.jsx`, `gui/web/src/hooks/` — new component + hook.
- `gui/web/src/lib/series-colors.js` (new) and `gui/web/src/features/market-state/PortfolioPage.jsx` — the 6-color oklch `ALLOCATION_COLORS` palette moves to the shared module; `PortfolioPage` imports it with no behavior change.
- `tests/` — server unit tests (mocked provider), route guard test, component static-render tests, no-embed assertions.
- No prompt, routing, tool, or memory-schema changes. No changes to TUI.
