# Design — market-chart

## Context

The GUI has two chart-ish surfaces today: the hand-rolled intraday SVG sparkline (`gui/web/src/components/market-sparkline.jsx`, data from `fetchSparklineSnapshot` at `gui/server/market-state-api.ts:425`, which calls `wrapProvider("yahoo", () => getHistory(symbol, "1d", "5m"))`) and recharts primitives added in 0.12.0 for page overhauls. Neither supports candlesticks, range switching, crosshair inspection, volume, or multi-series comparison. Two in-flight changes need exactly that: `symbol-page` (a full instrument page) and `chat-answer-charts` (charts inside chat answers, including multi-series indexed comparisons). This change defines the shared component contract and the server data path once, so those changes compose instead of forking.

Constraints:

- **Data must flow through OpenCandle's provider layer** (cache, rate limiter, stale fallback, freshness disclosure) — never a third-party widget's own data feed.
- **No external network from the browser bundle.** An existing guard test (`tests/unit/gui-web/market-state-page-render.test.ts:144`) already asserts rendered market-state markup contains no `"ticker-line.com"`.
- **GUI server read-model rules**: browser-facing data endpoints are guarded by `allowTrustedGuiRequest`, are follower-safe (no Pi session, no writer lock), and coalesce refresh bursts (`QuoteSnapshotStore`, `gui/server/quote-snapshot-store.ts`: 60s max age, single shared in-flight promise).
- React 19, Vite, `.jsx` components, design tokens from `packages/ui/src/styles.css` (the normative token source per DESIGN.md).

## Goals / Non-Goals

**Goals:**

- A stable, precisely specced `MarketChart` prop contract that `symbol-page` and `chat-answer-charts` can build against without further negotiation.
- A read-only `GET /api/instruments/history` endpoint whose bars carry real intraday timestamps.
- Fix the intraday timestamp loss in `getHistory` additively.
- Ship license-compliant, fully self-hosted charting.

**Non-Goals:**

- Indicator overlays / RSI-MACD sub-panes, live streaming updates, extended-hours shading, compare-fetching UI, replacing the sparkline or recharts (see proposal Non-Goals).

## Decisions

### D1: Charting library — TradingView lightweight-charts v5 (npm, self-hosted)

Chosen: [`lightweight-charts`](https://github.com/tradingview/lightweight-charts) v5, Apache-2.0, canvas-rendered, ~35 kB min. It is purpose-built for financial series: candlestick/area/baseline/histogram series, time scale with epoch-second support, crosshair, price lines, autoSize — everything in scope, nothing to hand-build.

License and attribution facts (verified during the spike):

- The NOTICE file is two lines — "TradingView Lightweight Charts™ / Copyright (c) 2025 TradingView, Inc. https://www.tradingview.com/" (https://github.com/tradingview/lightweight-charts/blob/master/NOTICE). Apache-2.0 §4(d) requires preserving that attribution.
- TradingView additionally asks for a visible link to tradingview.com. This is satisfied by the default-on `attributionLogo` option in `LayoutOptions`, which is drawn **on-canvas with no network call** (https://tradingview.github.io/lightweight-charts/docs/api/interfaces/LayoutOptions).
- Compliance plan: keep `attributionLogo` on (never set it `false`), and surface the two-line NOTICE attribution on an about/attribution surface in the GUI.

Alternatives rejected:

- **TradingView iframe widgets / Advanced Charts**: external network requests and TradingView-sourced data that bypasses OpenCandle's provider layer and freshness ledger entirely; the free Advanced Charts license explicitly disallows private/internal use (https://s3.amazonaws.com/tradingview/charting_library_license_agreement.pdf). Also an `<iframe>`, which we explicitly test against (D7).
- **recharts** (already a dependency): no candlestick series, and SVG rendering hits a performance ceiling around 5–10k points — a 5Y/1wk or MAX/1mo series is fine, but 1D/5m plus future streaming is not. recharts stays where it is (existing cards); it does not become the price chart.
- **Extending the hand-rolled SVG sparkline**: amounts to rebuilding lightweight-charts by hand (axes, time scale, crosshair, candles, zoom).
- **uPlot / visx**: fast but low-level; all financial semantics (candles, price lines, baseline modes) would have to be built and maintained locally.

### D2: Intraday timestamp fix — additive `timestamp` on `OHLCV`

`src/providers/yahoo-finance.ts:510` maps each bar via `new Date(ts * 1000).toISOString().split("T")[0]`, discarding time-of-day; every 1d/5m bar collapses to the same date string. lightweight-charts needs UTC epoch-second timestamps for intraday series.

Decision: add optional `timestamp?: number` (UTC epoch seconds, raw Yahoo `ts`) to `OHLCV` in `src/types/market.ts:26`, populated by `getHistory` alongside the existing `date` field. Additive-only: `date` keeps its exact current value and semantics, so existing consumers (`get_stock_history` tool, sparkline `dataAsOf`, correlation/backtest history paths) are untouched. Alternative — a chart-specific mapper that re-derives timestamps in `gui/server` — was rejected because it would re-parse dates lossily (the date string cannot recover intraday time) and because the provider is the honest place to preserve what Yahoo returns. Note: cached `OHLCV[]` entries written before this change lack `timestamp`; the snapshot builder treats bars without a finite `timestamp` as unusable for intraday and falls back per D4's error handling until the cache entry expires (TTL.HISTORY).

### D3: Endpoint shape — `GET /api/instruments/history`

Registered in `gui/server/http-routes.ts` next to `/api/instruments/quote` (~line 254), same guard (`allowTrustedGuiRequest(req, res, "Market-state API", options)`), same follower-safe read-only character as `fetchSparklineSnapshot` — no session, no writer lock, so a follower GUI process serves charts identically to the writer.

Query params: `symbol` (required), `range` (one of the GUI range labels, default `1D`), `interval` (optional override, validated against the server map), `compare` (**reserved**, rejected-if-present is not required — simply ignored in v1; the param name is reserved so `symbol-page`/`chat-answer-charts` never squat on it).

Response (built by new `getInstrumentHistorySnapshot()` in `gui/server/market-state-api.ts`):

```jsonc
{
  "symbol": "AAPL",
  "range": "1D",
  "interval": "5m",
  "source": "Yahoo Finance",
  "fetchedAt": 1789000000000,   // ms, provider fetch time
  "dataAsOf": "2026-07-15",     // last bar's date (string, matches sparkline semantics)
  "stale": false,
  "prevClose": 197.14,          // previous regular-session close, when derivable; else null
  "bars": [
    { "time": 1788975000, "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1 }
  ]
}
```

`time` is the bar's UTC epoch-second `timestamp` from D2 — exactly what lightweight-charts consumes. Unavailable/error results reuse the sparkline pattern: `{ status: "unavailable", reason, dataAsOf?, stale? }`.

### D4: Server-side range→interval map with Yahoo depth caps

Reuse the literal vocabularies `HISTORY_RANGES` / `HISTORY_INTERVALS` from `src/tools/market/stock-history.ts:12-25` (export them or lift them into a shared module — do not retype the lists). GUI range label → Yahoo `(range, interval)`:

| GUI range | Yahoo range | Interval |
|-----------|-------------|----------|
| 1D        | `1d`        | `5m`     |
| 5D        | `5d`        | `15m`    |
| 1M        | `1mo`       | `1h`     |
| 6M        | `6mo`       | `1d`     |
| YTD       | `ytd`       | `1d`     |
| 1Y        | `1y`        | `1d`     |
| 5Y        | `5y`        | `1wk`    |
| MAX       | `max`       | `1mo`    |

Yahoo intraday depth caps (the validation constants): `1m` → 7 days, `5m`/`15m` → 60 days, `1h` → 730 days. Range labels are matched case-sensitively against the exact set `1D 5D 1M 6M YTD 1Y 5Y MAX`. The map above never requests an interval beyond its depth, and the interval-override validation enforces the same invariant (`range=1Y&interval=5m` is rejected with HTTP 400 and body `{ status: "invalid_request", reason }` via `writeJson(res, body, 400)`, not forwarded to Yahoo; unknown ranges/intervals get the same shape). Soft, non-blocking enhancement: the parallel `lse-data-provider` change adds LSE `/candles` as a deep-intraday fallback inside the provider layer; because this endpoint calls `getHistory`, it benefits automatically with no endpoint change.

### D5: SWR memo for range-button bursts

A user tabbing across range buttons fires a burst of identical requests. Provider-level caching and rate limiting already exist in `getHistory` (`src/providers/yahoo-finance.ts:483-526`: cache key `yahoo:history:*`, `TTL.HISTORY`, stale fallback via `cache.getStale`, `rateLimiter.acquire("yahoo")`), but a burst still races before the first response lands in cache. Add a small server-side stale-while-revalidate memo keyed `symbol|range|interval`, mirroring `QuoteSnapshotStore` (`gui/server/quote-snapshot-store.ts`): 60s max age, one shared in-flight promise per key so N concurrent identical requests produce one provider call. Alternative — client-side dedupe only — rejected because multiple GUI windows/followers hit the same server and the server is the natural coalescing point.

### D6: Component contract — imperative lightweight-charts inside a stable props API

`gui/web/src/components/market-chart.jsx`. lightweight-charts is imperative: the component creates the chart in a `useEffect` against a container ref, applies series/options imperatively, and calls `chart.remove()` on unmount (React 19, no third-party React wrapper package — wrappers lag v5 and add nothing over ~50 lines of effect code).

Props (STABLE API — see spec for normative statements):

```ts
{
  series,        // [{ symbol, bars: [{ time, open, high, low, close, volume }], indexed?: number[] }]
                 // 1..6 entries; data ALWAYS via props — the component never fetches.
                 // 'area'/'candlestick' render exactly series[0]; 'indexed' renders all.
  mode,          // 'area' | 'candlestick' | 'indexed'
  prevClose,     // optional number → horizontal price line on single-series modes
  range,         // optional current range label for the built-in selector
  onRangeChange, // optional (range) => void; presence toggles the selector (see below)
  showVolume,    // volume histogram on its own bottom scale margin (single-series modes)
  height,
  className
}
```

Legend and series-color behavior are derived from the rendered series count — no extra props (see UI/UX guidance below): ≥2 rendered series always get a legend, ≤4 also get line-end direct labels, 1 gets neither.

Key contract decisions:

- **Controlled range selector, presence-toggled**: when `onRangeChange` is provided, the component renders range buttons `1D 5D 1M 6M YTD 1Y 5Y MAX` and calls back; the parent owns fetching and passes new `series` down. When absent, no selector renders — chat cards display fetched data only. This keeps the component fetch-free while giving pages a built-in selector.
- **`indexed` mode is multi-series** (`chat-answer-charts` needs it in v1): each series is rebased to % of its first close (`close / bars[0].close * 100`). The component computes this itself when `indexed` values are not supplied; a caller may precompute via the optional `indexed` array.
- **Theming via design tokens, read at runtime**: tokens live in `packages/ui/src/styles.css` as raw HSL triples (e.g. `--tw-success: 142 71% 35%`), consumed elsewhere as `hsl(var(--tw-*))`. lightweight-charts needs concrete color strings, so the component reads tokens via `getComputedStyle(document.documentElement).getPropertyValue(...)` at mount and wraps them as `hsl(<triple>)`: `--tw-foreground`, `--tw-muted-foreground`, `--tw-border`, `--tw-card`, `--tw-background`, `--tw-secondary`, plus semantic `--tw-success` (up) / `--tw-destructive` (down) — the same pair existing chart code uses (`gui/web/src/features/renderers/cards/market.jsx:193`). Re-read and `applyOptions` on theme toggle (observe root-element `class`/`data-theme` attribute mutations; the GUI is light-only today — `:root { color-scheme: light }` — so this is forward-compat, not dead code to remove).
- **Crosshair + tooltip are default-on**: the tooltip shows date/time, O/H/L/C (candlestick) or price (area; per-series in indexed mode), and volume, as a positioned overlay that never causes layout shift; all numerals tabular-nums.
- **Mobile**: `autoSize: true` (lightweight-charts' built-in ResizeObserver) so the chart tracks its container across breakpoints and sheet layouts.
- **Attribution**: `attributionLogo` stays default-on.

### D7: Encode the no-embed decision as a test

The existing `market-state-page-render.test.ts:144` assertion (`not.toContain("ticker-line.com")`) guards against one specific third-party embed. Add sibling assertions on the chart component's rendered markup: no `<iframe>` and no `tradingview.com` in any `src` attribute. A self-hosted npm canvas library trivially passes; a future regression toward embedded widgets fails loudly.

### D8: Data hook for page consumers

`useInstrumentHistory(symbol, range)` in `gui/web/src/hooks/` (sibling of `useMarketState.jsx`): fetches `/api/instruments/history`, exposes `{ snapshot, loading, error }` including the endpoint's `stale`/`dataAsOf` fields, re-fetches on `symbol`/`range` change, aborts superseded requests. Chat cards do not use it (they receive data in the message payload); `symbol-page` does.

### D9: Bundle impact — lazy-load the chart

`lightweight-charts` (~35 kB min) plus the component load via `React.lazy`/dynamic `import()` at the consumer boundary, so sessions that never render a chart never download it. The dependency is added to `gui/web/package.json` (not the root package).

## UI/UX guidance

OpenCandle's design language is minimal shadcn — `DESIGN.md` (repo root) is normative alongside the token source `packages/ui/src/styles.css`: Inter, zinc neutrals, ink `#18181B` actions, success `#1A9948` / danger `#EF4343`, radii sm 6px / md 8px / lg 12px, code font ships `tnum`. The chart is parameterized into this system; it does not invent a new aesthetic. The user-visible, testable rules below are promoted to spec requirements; the rest bind the implementation and the consuming changes.

**Color follows the data's job:**

- Single-series price direction uses only the semantic `--tw-success` / `--tw-destructive` tokens (up/down) — the same pair the sparkline and history card already use (`gui/web/src/features/renderers/cards/market.jsx:193`). Status colors are never reused as series-identity colors.
- Multi-series (indexed mode) colors come from a fixed categorical order: the 6-color oklch palette currently hardcoded as `ALLOCATION_COLORS` in `gui/web/src/features/market-state/PortfolioPage.jsx:26-33`, extracted into a shared `gui/web/src/lib/series-colors.js` (named export `SERIES_COLORS`) that both `PortfolioPage` and `MarketChart` import. Colors are assigned by series position on first render and follow the entity thereafter — never cycled (no modulo) and never re-painted when a series is removed. The `chat-answer-charts` compare tool caps at 6 symbols (`minItems: 2, maxItems: 6`) and the component caps `series` at 6, so a 7th color is never generated.
- Identity is never color-alone: ≥2 rendered series always get a legend, and ≤4 additionally get direct labels at each line's end; a single series gets no legend (the card/page header names it). Legend and direct-label text wears text tokens (`--tw-foreground` / `--tw-muted-foreground`), never the series color — a colored dot/mark beside the text carries identity.

**Composition:**

- One axis per pane, never two y-scales. Volume renders as a histogram on its own visually separated scale margin at the bottom of the pane (the standard lightweight-charts pattern: histogram series on a dedicated price-scale id with `scaleMargins` confining it to roughly the bottom fifth), never as a second price axis.
- Recessive chrome: gridlines and axis text use `--tw-border` / `--tw-muted-foreground`; data ink dominates.
- Concentric radii: when the chart sits inside a `rounded-xl` (lg 12px) panel, the chart surface's own radius equals the outer radius minus the panel padding.

**Crosshair, tooltip, numerals:**

- Crosshair + tooltip are default-on; content and no-layout-shift behavior are specced (see D6 bullet and spec). Every dynamically updating numeral the component renders (tooltip values, price readouts, updating axis labels) uses `font-variant-numeric: tabular-nums` (existing pattern: `gui/web/src/styles.css:115`).

**Interaction & motion:**

- Range selector buttons: ≥40×40px hit area (extend via padding or a pseudo-element when visually smaller), `active:scale-[0.96]` press feedback, CSS transitions scoped to named properties (never `transition: all`), interruptible for hover/active.
- Range selector is keyboard-operable: arrow keys move focus between buttons and Enter/Space activates, following the existing roving arrow-key tab-strip pattern (`gui/web/src/features/market-state/shared.jsx:318` tablist, `:368` arrow-key index math).
- No enter animation on first paint. Any tick-update animation must be CSS-driven so the global `prefers-reduced-motion` suppression rule (`gui/web/src/styles.css:269`) applies — the same precedent as the price-flash suppression.
- Loading and staleness (binding on consumers, `symbol-page` first): while `useInstrumentHistory` is loading, render the existing `Skeleton` primitive (`gui/web/src/components/ui/skeleton.jsx`) sized to the final chart height so layout does not jump; when the snapshot reports `stale`, reuse the existing amber freshness-badge convention ("Quotes Nm old" / "As of <date>", `gui/web/src/features/market-state/format.js:33`) rather than inventing a new indicator.

**Accessibility:**

- The chart container carries an `aria-label` summarizing symbol(s), range, latest close, and change, following the sparkline precedent (`gui/web/src/components/market-sparkline.jsx:35`). The surrounding stat grid / tool text table is the text alternative for the canvas.

## Risks / Trade-offs

- [Yahoo intraday depth caps drift or differ per listing] → the map is conservative (never near a cap boundary), the override validation rejects out-of-depth combos server-side, and provider errors surface as the sparkline-style `unavailable` result rather than a broken chart.
- [Stale cached `OHLCV[]` without `timestamp` right after deploy] → snapshot builder detects missing `timestamp` and reports `unavailable` for intraday ranges until `TTL.HISTORY` expiry; daily+ ranges can fall back to date-derived midnight timestamps (dates are lossless at 1d/1wk/1mo granularity).
- [lightweight-charts v5 API churn] → pin a caret range on v5; the imperative surface used (chart create/remove, addSeries, setData, price lines, applyOptions) is the library's stable core.
- [Imperative chart + React 19 StrictMode double-effects] → effect must be idempotent: create in effect, `chart.remove()` in cleanup; render tests assert unmount disposes.
- [License/attribution regression] → spec requirement pins `attributionLogo` on and NOTICE attribution present; the no-iframe test blocks the embed route.
- [Two parallel changes racing on the endpoint] → ownership is stated in the proposal: this change owns `/api/instruments/history`; `symbol-page` consumes it. If `symbol-page` lands first it must stub against this spec, not implement the endpoint.

## Migration Plan

Additive throughout: new endpoint, new component, new optional type field. No schema migrations, no config, no breaking changes. Rollback = revert the PR; cached history entries with the extra `timestamp` field remain valid for old readers (unknown-field tolerant).

## Open Questions

- 5D interval: `15m` chosen over `30m` (finer resolution, still ~130 bars, well inside the 60-day cap). Revisit only if payload size becomes a concern.
- Where the NOTICE attribution surface lives (Diagnostics footer vs. a dedicated about section) — implementer's choice; the requirement is only that it exists and contains the two NOTICE lines.
