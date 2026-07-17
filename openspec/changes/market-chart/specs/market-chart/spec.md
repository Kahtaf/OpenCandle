## ADDED Requirements

### Requirement: History bars preserve intraday timestamps additively

`getHistory` in `src/providers/yahoo-finance.ts` SHALL populate an additive optional `timestamp` field (UTC epoch seconds, the raw Yahoo per-bar timestamp) on each `OHLCV` bar (`src/types/market.ts`), while the existing `date` field keeps its exact current value (`new Date(ts * 1000).toISOString().split("T")[0]`) and ordering. No existing consumer of `date` SHALL change behavior.

#### Scenario: Intraday bars carry distinct timestamps

- **WHEN** `getHistory("AAPL", "1d", "5m")` returns bars for one trading day
- **THEN** each bar's `timestamp` is a distinct UTC epoch-second value matching the provider's per-bar timestamp
- **AND** each bar's `date` equals the same date-only string it produced before this change

#### Scenario: Existing date consumers are unaffected

- **WHEN** the `get_stock_history` tool or `fetchSparklineSnapshot` reads `getHistory` output
- **THEN** every `date` value and the bar count are byte-identical to pre-change behavior (the new field is additive only)

### Requirement: GUI server exposes a guarded read-only instrument history endpoint

The GUI server SHALL serve `GET /api/instruments/history?symbol=<sym>&range=<range>&interval=<interval>` from `gui/server/http-routes.ts`, registered alongside `/api/instruments/quote`, guarded by `allowTrustedGuiRequest(req, res, "Market-state API", options)`. The route SHALL be follower-safe: it uses no Pi session and takes no writer lock, so follower GUI processes serve it identically to the writer. A `compare` query parameter is reserved for a future change and SHALL be ignored when present. The response SHALL be built by `getInstrumentHistorySnapshot()` in `gui/server/market-state-api.ts` and have the shape `{ symbol, range, interval, source: "Yahoo Finance" | "Alpha Vantage" | "London Strategic Edge", fetchedAt, dataAsOf, stale, prevClose, bars: [{ time, open, high, low, close, volume }] }` where each `time` is a UTC epoch-second bar timestamp; provider failure SHALL yield an unavailable-shaped result (`status: "unavailable"` with a human-readable `reason`), not a thrown 500.

#### Scenario: Untrusted request is rejected

- **WHEN** a request without a trusted GUI session reaches `/api/instruments/history`
- **THEN** `allowTrustedGuiRequest` rejects it and no provider call is made

#### Scenario: Trusted request returns epoch-second bars

- **WHEN** a trusted request asks for `symbol=AAPL&range=1D`
- **THEN** the JSON response contains `symbol: "AAPL"`, `range: "1D"`, `interval: "5m"`, `source` attributed as one of `"Yahoo Finance"`, `"Alpha Vantage"`, or `"London Strategic Edge"`, plus `fetchedAt`, `dataAsOf`, `stale`, `prevClose`, and `bars` whose `time` values are distinct UTC epoch seconds

#### Scenario: Provider outage degrades, not crashes

- **WHEN** the Yahoo provider fails and no stale cache entry exists
- **THEN** the endpoint returns an unavailable-shaped body with a `reason`, and the HTTP request completes without an unhandled error

#### Scenario: Follower process serves history

- **WHEN** a GUI process that does not hold the writer lock receives a trusted history request
- **THEN** it serves the same response as the writer would, with no session or writer-lock interaction

### Requirement: Range labels map server-side to Yahoo range/interval pairs within intraday depth caps

`getInstrumentHistorySnapshot()` SHALL map GUI range labels — matched case-sensitively against the exact set `1D 5D 1M 6M YTD 1Y 5Y MAX` — to Yahoo `(range, interval)` pairs using the existing `HISTORY_RANGES`/`HISTORY_INTERVALS` vocabularies from `src/tools/market/stock-history.ts` (shared, not retyped): 1D→(`1d`,`5m`), 5D→(`5d`,`15m`), 1M→(`1mo`,`1h`), 6M→(`6mo`,`1d`), YTD→(`ytd`,`1d`), 1Y→(`1y`,`1d`), 5Y→(`5y`,`1wk`), MAX→(`max`,`1mo`). An explicit `interval` override SHALL be validated against these intraday depth caps: `1m` → 7 days, `5m`/`15m` → 60 days, `1h` → 730 days; a combination whose range span exceeds the interval's cap SHALL be rejected with HTTP 400 and body `{ status: "invalid_request", reason }` and SHALL NOT be forwarded to the provider. Unknown `range` or `interval` values SHALL be rejected with the same status and body shape.

#### Scenario: Default mapping applies

- **WHEN** a request specifies `range=1M` with no interval
- **THEN** the provider is called with Yahoo range `1mo` and interval `1h`

#### Scenario: Out-of-depth override is rejected

- **WHEN** a request specifies `range=1Y&interval=5m` (a one-year span exceeds the 5m 60-day depth cap)
- **THEN** the endpoint returns HTTP 400 with `{ status: "invalid_request", reason }` naming the invalid combination and makes no provider call

#### Scenario: Unknown range is rejected

- **WHEN** a request specifies `range=7W`
- **THEN** the endpoint returns HTTP 400 with `{ status: "invalid_request", reason }` and makes no provider call

### Requirement: History requests are coalesced by a stale-while-revalidate memo

The history snapshot path SHALL memoize results keyed `symbol|range|interval`, mirroring `QuoteSnapshotStore` (`gui/server/quote-snapshot-store.ts`): entries fresher than 60 seconds are served without a provider call, and concurrent requests for the same key share one in-flight promise so a burst produces exactly one provider call. Provider-level cache/rate-limit behavior in `getHistory` (`yahoo:history:*` cache key, `TTL.HISTORY`, stale fallback, `rateLimiter.acquire("yahoo")`) remains unchanged underneath.

#### Scenario: Range-button burst makes one provider call

- **WHEN** five concurrent requests arrive for `AAPL|1D|5m` with a cold memo
- **THEN** exactly one provider fetch occurs and all five requests resolve with its result

#### Scenario: Fresh memo entry short-circuits

- **WHEN** a request arrives for a key fetched 10 seconds ago
- **THEN** the memoized snapshot is returned with no provider call

### Requirement: MarketChart renders provided series data and never fetches

`gui/web/src/components/market-chart.jsx` SHALL export a `MarketChart` React component built on the self-hosted `lightweight-charts` v5 npm package that renders exclusively from props and performs no data fetching of any kind. Props (STABLE API — consumed by the `symbol-page` and `chat-answer-charts` changes): `series` (array of `{ symbol, bars: [{ time, open, high, low, close, volume }], indexed?: number[] }`, 1 to 6 entries; `time` is UTC epoch seconds), `mode` (`'area' | 'candlestick' | 'indexed'`), `prevClose` (optional number), `range` (optional current range label), `onRangeChange` (optional callback), `showVolume` (boolean), `height`, `className`. In `area` and `candlestick` modes the component SHALL render exactly `series[0]` and ignore further entries; in `indexed` mode it SHALL render every entry up to the 6th and ignore entries beyond the 6th. Legend and series-color behavior SHALL be derived from the rendered series count with no additional props. The chart instance SHALL be created imperatively in a mount effect and disposed with `chart.remove()` on unmount, safe under React 19 StrictMode double-invocation.

#### Scenario: Area mode renders a single series

- **WHEN** `MarketChart` mounts with one series and `mode="area"`
- **THEN** an area series is created from the bars' `time`/`close` values and no network request is issued by the component

#### Scenario: Candlestick mode renders OHLC

- **WHEN** `MarketChart` mounts with one series and `mode="candlestick"`
- **THEN** a candlestick series is created from the bars' `time`/`open`/`high`/`low`/`close` values

#### Scenario: Indexed mode rebases multiple series

- **WHEN** `MarketChart` mounts with three series and `mode="indexed"` and no precomputed `indexed` arrays
- **THEN** each series renders as `close / bars[0].close * 100`, all starting at 100, one line per symbol

#### Scenario: Unmount disposes the chart

- **WHEN** the component unmounts (including a StrictMode mount/unmount/remount cycle)
- **THEN** `chart.remove()` is called for every created chart instance and no instance leaks

### Requirement: Range selector is controlled and presence-toggled

When `onRangeChange` is provided, `MarketChart` SHALL render range buttons labeled `1D 5D 1M 6M YTD 1Y 5Y MAX`, mark the button matching the `range` prop with `aria-pressed="true"`, and invoke `onRangeChange(<label>)` on click without fetching or mutating its own data. When `onRangeChange` is absent, no range selector SHALL render. Each range button SHALL present a hit area of at least 40×40px (extended via padding or a pseudo-element when the visual footprint is smaller), SHALL apply `active:scale-[0.96]` press feedback, and SHALL scope any CSS transition to named properties — `transition: all` SHALL NOT be used. The selector SHALL be keyboard-operable: ArrowLeft/ArrowRight move focus between buttons (wrapping, following the roving pattern in `gui/web/src/features/market-state/shared.jsx:368`) and Enter or Space on a focused button invokes `onRangeChange` with that button's label.

#### Scenario: Selector present and controlled

- **WHEN** `MarketChart` renders with `range="1D"` and an `onRangeChange` handler, and the user clicks `1M`
- **THEN** `onRangeChange("1M")` is called and the displayed data is unchanged until the parent passes new `series`

#### Scenario: Selector absent for chat cards

- **WHEN** `MarketChart` renders without `onRangeChange`
- **THEN** no range buttons appear in the markup

#### Scenario: Selector is keyboard-operable

- **WHEN** focus is on the `1D` button and the user presses ArrowRight then Enter
- **THEN** focus moves to the `5D` button and `onRangeChange("5D")` is called

### Requirement: Single-series modes support prev-close reference and volume histogram

In `area` and `candlestick` modes: when `prevClose` is a finite number, the chart SHALL render a horizontal previous-close price line at that value; when `showVolume` is true, the chart SHALL render the bars' volumes as a histogram series on a dedicated volume price-scale id whose `scaleMargins` confine it to the bottom of the pane, visually separated from the price series. The pane SHALL show exactly one visible price axis — volume SHALL NOT render as a second price axis and no configuration SHALL produce two y-scales in one pane.

#### Scenario: Prev-close line renders

- **WHEN** `MarketChart` renders in area mode with `prevClose={197.14}`
- **THEN** a horizontal price line appears at 197.14

#### Scenario: Volume histogram on its own bottom margin

- **WHEN** `MarketChart` renders in candlestick mode with `showVolume`
- **THEN** a volume histogram renders on a dedicated price-scale id with bottom-confining `scaleMargins`, and only the price axis is visible

### Requirement: Crosshair tooltip is default-on and layout-stable

`MarketChart` SHALL enable the crosshair and render a tooltip by default (no opt-in prop). At the hovered time the tooltip SHALL show: the bar's date (with time for intraday bars), open/high/low/close in `candlestick` mode or the price in `area` mode (per-series values in `indexed` mode), and volume when volume data is present. The tooltip SHALL render as an absolutely positioned overlay inside the chart container so showing, moving, or hiding it causes no layout shift, and every numeral it displays SHALL use `font-variant-numeric: tabular-nums`.

#### Scenario: Candlestick tooltip content

- **WHEN** the crosshair hovers a bar in candlestick mode with volume data
- **THEN** the tooltip shows the bar's date/time, open, high, low, close, and volume in tabular numerals

#### Scenario: Tooltip causes no layout shift

- **WHEN** the tooltip appears, moves, and disappears
- **THEN** the chart container's size and the position of surrounding elements are unchanged

### Requirement: Chart colors come from design tokens read at runtime

`MarketChart` SHALL derive all chart colors from the design tokens in `packages/ui/src/styles.css` by reading CSS custom properties via `getComputedStyle(document.documentElement)` at mount — `--tw-foreground`, `--tw-muted-foreground`, `--tw-border`, `--tw-card`, `--tw-background`, `--tw-secondary`, and semantic `--tw-success` (up moves) / `--tw-destructive` (down moves) — wrapping each raw HSL triple as `hsl(<triple>)`. Single-series price direction SHALL use only the `--tw-success` / `--tw-destructive` pair (the pair the sparkline uses, `gui/web/src/features/renderers/cards/market.jsx:193`). Gridlines and axis text SHALL use only `--tw-border` and `--tw-muted-foreground` so chrome stays recessive. The component SHALL re-read tokens and re-apply chart options when the root element's theme designation (class or `data-theme` attribute) changes, so a future dark theme restyles mounted charts without remount. No color values SHALL be hardcoded except the shared categorical series palette defined in the multi-series color requirement.

#### Scenario: Up and down colors are semantic tokens

- **WHEN** `MarketChart` renders a candlestick series
- **THEN** up candles use `hsl(var(--tw-success))`'s computed value and down candles use `hsl(var(--tw-destructive))`'s computed value

#### Scenario: Gridlines and axis text are recessive

- **WHEN** `MarketChart` creates a chart
- **THEN** grid line colors resolve from `--tw-border` and axis text color resolves from `--tw-muted-foreground`

#### Scenario: Theme toggle restyles without remount

- **WHEN** the root element's theme class/attribute changes while a chart is mounted
- **THEN** the component re-reads token values and applies updated colors to the existing chart instance

### Requirement: Multi-series colors come from a shared fixed categorical palette

The six oklch color literals currently defined as `ALLOCATION_COLORS` in `gui/web/src/features/market-state/PortfolioPage.jsx` SHALL be extracted into `gui/web/src/lib/series-colors.js` as a named export `SERIES_COLORS` (exactly six entries, order preserved), and both `PortfolioPage` and `MarketChart` SHALL import it — the literals SHALL NOT be duplicated. In `indexed` mode, `MarketChart` SHALL assign `SERIES_COLORS[i]` to the series at position `i` of the `series` prop on first render, keyed by `symbol` thereafter: when a later `series` prop omits a symbol, the remaining symbols SHALL keep their previously assigned colors (color follows the entity — colors are never reassigned by new position and never cycled). `--tw-success` / `--tw-destructive` SHALL NOT be used as series-identity colors, and series-identity colors SHALL NOT be used to signal status.

#### Scenario: Colors assigned by initial position

- **WHEN** `MarketChart` mounts in indexed mode with three series
- **THEN** the series receive `SERIES_COLORS[0]`, `SERIES_COLORS[1]`, and `SERIES_COLORS[2]` in prop order

#### Scenario: Removing a series repaints nothing

- **WHEN** the middle of three indexed series is removed by a new `series` prop
- **THEN** the two remaining symbols keep the exact colors they already had

#### Scenario: One palette source

- **WHEN** `PortfolioPage` renders allocation segments after this change
- **THEN** its colors come from the `SERIES_COLORS` export in `gui/web/src/lib/series-colors.js` and no oklch literal remains in `PortfolioPage.jsx`

### Requirement: Series identity is never conveyed by color alone

When `MarketChart` renders two or more series, it SHALL render a legend listing every rendered series; when it renders four or fewer series (but at least two), it SHALL additionally direct-label each series at its line end with the symbol text; when it renders exactly one series, it SHALL render neither legend nor direct labels. Legend and direct-label text SHALL use the `--tw-foreground` or `--tw-muted-foreground` text tokens — never the series color — with a dot or mark in the series color beside the text carrying the color identity.

#### Scenario: Two series get a legend and direct labels

- **WHEN** `MarketChart` renders two indexed series
- **THEN** a legend lists both symbols with a colored dot per entry, both lines are direct-labeled at their ends, and the legend/label text color is a text token, not the series color

#### Scenario: Six series get a legend only

- **WHEN** `MarketChart` renders six indexed series
- **THEN** a legend lists all six symbols and no line-end direct labels render

#### Scenario: Single series gets no legend

- **WHEN** `MarketChart` renders one series in any mode
- **THEN** no legend and no direct labels appear in the markup

### Requirement: Chart numerals are tabular and motion respects user preference

Every dynamically updating numeral `MarketChart` renders in the DOM (tooltip values, legend values, price readouts) SHALL use `font-variant-numeric: tabular-nums`. The component SHALL apply no enter animation on first paint. Any tick-update animation SHALL be CSS-driven so the global `prefers-reduced-motion` suppression rule (`gui/web/src/styles.css:269`) disables it; the component SHALL NOT run JavaScript-driven animations that bypass that rule.

#### Scenario: No enter animation on first paint

- **WHEN** `MarketChart` mounts with data
- **THEN** the chart and its DOM shell render at full opacity and final position immediately, with no fade/slide/scale-in

#### Scenario: Numerals are tabular

- **WHEN** any tooltip or readout numeral renders
- **THEN** its computed style includes `font-variant-numeric: tabular-nums`

### Requirement: Chart container is labeled for assistive technology

The chart container SHALL carry an `aria-label` that names the symbol(s), the current range label, the latest close, and the change over the displayed range, following the sparkline's aria-label precedent (`gui/web/src/components/market-sparkline.jsx:35`). Consumers' surrounding stat grids or tool text tables serve as the full text alternative; the component's obligation is the summary label.

#### Scenario: Container aria-label summarizes the chart

- **WHEN** `MarketChart` renders AAPL over `1D` with a latest close of 197.14
- **THEN** the container's `aria-label` contains the symbol, the range label, the latest close, and the signed change

### Requirement: Chart is self-hosted with no embeds and preserved attribution

The chart SHALL load `lightweight-charts` from the local npm bundle only: its rendered markup SHALL contain no `<iframe>` element and no `tradingview.com` URL in any `src` attribute, and the component SHALL issue no network requests. The library's default-on on-canvas `attributionLogo` (`LayoutOptions`) SHALL NOT be disabled, and the two-line lightweight-charts NOTICE attribution ("TradingView Lightweight Charts™ / Copyright (c) 2025 TradingView, Inc. https://www.tradingview.com/") SHALL appear on a GUI about/attribution surface. A unit test sibling to the existing `ticker-line.com` guard (`tests/unit/gui-web/market-state-page-render.test.ts:144`) SHALL assert the no-iframe/no-tradingview-src properties.

#### Scenario: No-embed guard test

- **WHEN** the chart component's static markup is rendered in the unit test
- **THEN** it contains no `<iframe>` and no `src` attribute referencing `tradingview.com`

#### Scenario: Attribution stays on

- **WHEN** the chart is created
- **THEN** `attributionLogo` is left at its default-on value and the NOTICE text is present on the attribution surface

### Requirement: useInstrumentHistory hook fetches the endpoint for page consumers

A `useInstrumentHistory(symbol, range)` hook in `gui/web/src/hooks/` SHALL fetch `/api/instruments/history`, expose `{ snapshot, loading, error }` (with the snapshot's `stale` and `dataAsOf` passed through), re-fetch when `symbol` or `range` changes, and discard responses superseded by a newer request so a fast range-click sequence cannot render out-of-order data.

#### Scenario: Range change refetches

- **WHEN** a consumer's `range` argument changes from `1D` to `1Y`
- **THEN** the hook fetches the new range and `loading` is true until it resolves

#### Scenario: Superseded response is discarded

- **WHEN** a `1D` request resolves after a later `1Y` request was issued
- **THEN** the hook's `snapshot` reflects the `1Y` response, never the stale `1D` one
