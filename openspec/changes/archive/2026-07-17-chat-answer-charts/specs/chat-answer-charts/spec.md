## ADDED Requirements

### Requirement: History card renders via the shared MarketChart from persisted details

The `HistoryCard` in `gui/web/src/features/renderers/cards/market.jsx` SHALL render its price chart with the shared `<MarketChart>` component (from the `market-chart` change) as a single area-mode series built from the tool result's persisted `details` (`OHLCV[]`), keeping the existing header and stat tiles (`market.jsx:131-146`). The bespoke SVG chart implementation (`PriceChart`, `HoverTooltip`, and the tick/format helpers at `market.jsx:154-372`) SHALL be removed. The card SHALL keep serving both registry entries that point at it — `get_stock_history` and `get_crypto_history` (`cards/index.jsx:25-26`). MarketChart bars require a UTC epoch-second `time` field; persisted `OHLCV` bars carry `timestamp` (epoch seconds, added by the market-chart provider change) when fetched after that change, and only `date` before it. The card SHALL map `timestamp` to `time` when `timestamp` is a finite number, and SHALL otherwise derive `time` by parsing the `date` string as UTC midnight — sessions persisted before the market-chart change MUST keep rendering. Because the full `details` payload is persisted in session entries and both the live adapter and the reload adapter emit the same `tool.completed` output shape, the card MUST render identically for a live turn and for the same session reloaded.

#### Scenario: Live and reloaded sessions render the same chart

- **WHEN** a `get_stock_history` result renders during a live turn and the same session is later reloaded from persisted entries
- **THEN** `HistoryCard` receives the same `details` OHLCV array in both cases and renders the same MarketChart series, header, and stat tiles

#### Scenario: Pre-existing persisted bars without a timestamp field still render

- **WHEN** `HistoryCard` renders a session persisted before the market-chart change, whose bars have `date` strings but no `timestamp` field
- **THEN** the card derives each bar's `time` from `date` and renders without error

#### Scenario: Crypto history keeps rendering

- **WHEN** a `get_crypto_history` result is rendered
- **THEN** the swapped `HistoryCard` renders it through MarketChart the same way

### Requirement: Chart cards never refetch or switch range

Chart cards SHALL render exactly the bars present in the tool result's `details` and SHALL NOT initiate any data fetch or offer range switching. The displayed range is whatever the agent's tool arguments fetched. Cards SHALL NOT pass `onRangeChange` to `<MarketChart>`, so per the market-chart contract no range selector renders inside a card.

#### Scenario: Card is a pure render of persisted data

- **WHEN** a history or comparison chart card is displayed
- **THEN** no network or tool-invocation request originates from the card, and the rendered bars equal the persisted `details` bars

#### Scenario: No range selector inside cards

- **WHEN** a history or comparison chart card renders
- **THEN** no range-selector buttons are present in the card markup

### Requirement: Chart cards are height-bounded, overflow-contained, and state their scope

In-card charts SHALL render at a fixed height of 220px at viewport widths of 640px (`sm`) and above, and 180px below 640px, with width filling the card — a chart never dominates the transcript. The card SHALL contain any horizontal overflow of its chart (`overflow-hidden` on the chart container or equivalent); the transcript and page SHALL NOT scroll horizontally because of a chart card. Each chart card SHALL state its data scope in its header area: `HistoryCard` SHALL state the covered window as the first and last bar dates (its details carry no freshness stamp); the comparison card SHALL state `details.range` and the as-of line rendered from `details.freshness` via `formatAsOfLine`.

#### Scenario: Chart height is bounded per breakpoint

- **WHEN** a chart card renders at a viewport ≥640px wide and again below 640px
- **THEN** the chart container is 220px tall in the first case and 180px tall in the second, filling the card width in both

#### Scenario: Card owns overflow

- **WHEN** a chart card renders inside a narrow transcript column
- **THEN** the chart is clipped or resized within the card and the page introduces no horizontal scrollbar

#### Scenario: Scope stated on the card

- **WHEN** a comparison card renders a `1y` result
- **THEN** the card states the `1y` range and an as-of line from the result's freshness stamp, and a `HistoryCard` in the same session states its first and last bar dates

### Requirement: get_price_comparison returns aligned multi-symbol indexed history

The system SHALL provide a `get_price_comparison` tool (`src/tools/market/price-comparison.ts`, named export `priceComparisonTool`) with Typebox params: `symbols` (array of 2 to 6 ticker strings, `minItems: 2, maxItems: 6`), `range` (the same literal union as `get_stock_history`'s `HISTORY_RANGES`, `src/tools/market/stock-history.ts:12-24`), and optional `interval` (same literals as `HISTORY_INTERVALS`, `stock-history.ts:25`, default `1d`). For each symbol it SHALL fetch history through the same provider chain as `get_stock_history` — Yahoo with Alpha Vantage fallback via `withFallback` for daily intervals when an Alpha Vantage key is configured, Yahoo only otherwise (`stock-history.ts:60-69`) — reusing that logic, not duplicating it.

Alignment SHALL be the intersection of bar dates across surviving series: aligned bars contain only dates present in **all** surviving series (correct for mixed calendars — a 7-day-week crypto series compared against a 5-day-week equity aligns to the equity's trading dates). `baseDate` SHALL be the first common date, and per-series `indexed[i] = close[i] / close[0] * 100` SHALL be computed from the aligned bars (deterministic formatting, not analysis). If the intersection drops more than 30% of any surviving series' fetched bars, the content text SHALL note the reduced aligned window and the symbol(s) whose calendars drove the loss.

The canonical `details` shape (defined only here; other artifacts reference it) SHALL be:

```ts
{
  range: string;                 // the HISTORY_RANGES literal used
  interval: string;              // the HISTORY_INTERVALS literal used
  baseDate: string;              // first common aligned date, same format as OHLCV.date
  series: Array<{
    symbol: string;
    bars: OHLCV[];               // aligned bars only ({date, open, high, low, close, volume}, src/types/market.ts:26-33, plus optional timestamp after market-chart)
    indexed: number[];           // same length as bars; indexed[0] === 100
  }>;
  unavailableSymbols: string[];  // symbols with no usable history from any provider
  freshness: FreshnessStamp;     // src/infra/freshness.ts, built from the latest aligned bar date
}
```

#### Scenario: Two symbols align and index to base 100

- **WHEN** the tool is called with `symbols: ["AAPL", "MSFT"]` and both provider fetches succeed with overlapping dates
- **THEN** `details.series` has two entries whose bars share the same date sequence, each `indexed[0]` is 100, later indexed values equal `close/close[0]*100`, and `details.baseDate` is the first common date

#### Scenario: Symbol count is validated

- **WHEN** the tool is called with fewer than 2 or more than 6 symbols
- **THEN** parameter validation rejects the call before any provider fetch

#### Scenario: Per-symbol provider fallback

- **WHEN** the Yahoo history fetch fails for one symbol at a daily interval with an Alpha Vantage key configured
- **THEN** that symbol's history is fetched from Alpha Vantage via `withFallback` while other symbols proceed independently

#### Scenario: Misaligned calendars intersect to common dates

- **WHEN** one series is missing dates the other has (holiday gap or shorter listing history)
- **THEN** aligned bars contain only dates present in every surviving series, and indexing is computed over that intersection with `baseDate` reflecting it

#### Scenario: Mixed trading calendars align to the common dates and disclose heavy loss

- **WHEN** a 7-day-week series (e.g. a crypto symbol) is compared against a 5-day-week equity series and the intersection drops more than 30% of the crypto series' fetched bars
- **THEN** aligned bars are the equity trading dates common to both, indexing is computed over that intersection, and the content text notes the reduced aligned window naming the affected symbol

### Requirement: Unavailable symbols are reported, not fatal

When a symbol's history is unavailable from all providers in its chain, `get_price_comparison` SHALL list it in `details.unavailableSymbols` and name it in the content text, and SHALL still return aligned indexed series for the remaining symbols as long as at least 2 remain. If fewer than 2 series remain usable, the tool SHALL return an explicit unavailability text result (with empty `series`) instead of a single-series or fabricated comparison.

#### Scenario: One of three symbols fails

- **WHEN** history for one of three requested symbols is unavailable from all providers
- **THEN** the result contains two aligned indexed series, the failed symbol appears in `unavailableSymbols`, and the content text names it as unavailable

#### Scenario: Too few series to compare

- **WHEN** all but one (or all) requested symbols are unavailable
- **THEN** the tool returns an explicit unavailability message identifying the failed symbols, with empty `series`, rather than a one-symbol "comparison"

### Requirement: get_price_comparison content text is a compact table with freshness disclosure

The tool's `content` text (the agent/TUI-visible form) SHALL be a compact table with exactly one row per surviving symbol carrying: the symbol, the first aligned close, the last aligned close, and the percent change over the aligned window (`(lastClose/firstClose − 1) × 100`, i.e. the indexed end value minus 100). After the table, in order: the reduced-aligned-window note when the >30% intersection-loss threshold is met; a line naming any unavailable symbols when `unavailableSymbols` is non-empty; and, always last, an as-of freshness disclosure line built with `buildFreshnessStamp` and `formatAsOfLine` from `src/infra/freshness.ts`, using the latest aligned bar date as the provider as-of input (the same stamp stored in `details.freshness`). The text SHALL contain numbers and dates only — no analysis language. TUI output SHALL remain plain text — cards are a GUI-only rendering.

#### Scenario: Content table and as-of line

- **WHEN** the tool returns two aligned series ending at a given bar date
- **THEN** the content text contains one table row per symbol with symbol, first aligned close, last aligned close, and percent change over the aligned window, and ends with an as-of line derived from that bar date via `formatAsOfLine`

#### Scenario: TUI output is unchanged by card work

- **WHEN** the tool result is displayed in the TUI
- **THEN** only the content text is shown; no card or chart rendering applies

### Requirement: Comparison results render as an indexed chart card

The GUI card registry (`gui/web/src/features/renderers/cards/index.jsx` `RENDERERS`) SHALL map the exact tool name `get_price_comparison` to `{category: "Comparison", Component: PriceComparisonCard}` (new file `gui/web/src/features/renderers/cards/price-comparison.jsx`). The card SHALL read `extractDetails(message)`, pass each series' precomputed `indexed` values through, and render them via `<MarketChart mode="indexed">`, rendering only persisted details (no refetch). The card SHALL be built from the shared card primitives (`ToolCard`, `ToolHeader` from `cards/_shared.jsx`). It SHALL carry a subtitle stating the indexing basis, exactly the pattern `% change, indexed to 100 at {baseDate}`, and SHALL NOT present indexed values as prices: no currency symbol appears on the indexed axis, legend, or end-of-line labels. When `unavailableSymbols` is non-empty the card SHALL render them in a `WarningRow` (`cards/_shared.jsx:33`) naming each dropped symbol. The chart container SHALL carry an `aria-label` naming the compared symbols and range (pattern: `Indexed price comparison of {symbols, comma-separated} over {range}`); the tool's content text remains the accessible/TUI-parity alternative. Like all cards, an unregistered or malformed result falls back to `GenericCard` via the existing registry behavior.

#### Scenario: Indexed comparison chart renders from details

- **WHEN** a `get_price_comparison` result with two indexed series is rendered in the GUI
- **THEN** the comparison card renders a multi-series indexed MarketChart (both series starting at 100) with a subtitle reading `% change, indexed to 100 at {baseDate}` and no currency symbols on indexed values

#### Scenario: Missing symbols disclosed on the card

- **WHEN** the result's `unavailableSymbols` contains a symbol
- **THEN** the card renders a `WarningRow` naming that symbol as unavailable

#### Scenario: Chart is labeled for assistive technology

- **WHEN** the comparison card renders NVDA and AMD over `1y`
- **THEN** the chart container's `aria-label` is `Indexed price comparison of NVDA, AMD over 1y`

### Requirement: Comparison series identity is color-stable and never color-alone

Comparison series colors SHALL come from the shared series-color module at `gui/web/src/lib/series-colors.js` (`SERIES_COLORS`, the fixed categorical palette created by the `market-chart` change from `ALLOCATION_COLORS`; this change SHALL import it and SHALL NOT re-extract the palette). Colors SHALL be assigned by symbol position in the tool result's `details.series` order and SHALL remain stable across rerenders and session reloads — never cycled or reassigned, including when requested symbols land in `unavailableSymbols`. Series identity SHALL never be conveyed by color alone: whenever 2 or more series render, a legend SHALL be present pairing a colored dot with the symbol text in text tokens; when 4 or fewer series render, each line SHALL additionally carry a direct end-of-line symbol label. The crosshair tooltip SHALL show the hovered date plus, per series, the indexed value to one decimal place and the raw close in parentheses, in tabular numerals.

#### Scenario: Colors are positional and stable

- **WHEN** the same `get_price_comparison` result renders live and again after session reload
- **THEN** each symbol receives the palette color at its `details.series` index both times

#### Scenario: Legend and end-of-line labels

- **WHEN** a comparison card renders 3 series
- **THEN** a legend shows a colored dot plus symbol text for each series, and each line carries a direct end-of-line symbol label

#### Scenario: Tooltip shows indexed and raw values

- **WHEN** the user hovers a bar date on the comparison chart
- **THEN** the tooltip shows the date and, for each series, the indexed value to one decimal with the raw close in parentheses (e.g. `NVDA 142.3 ($131.14)`)

### Requirement: Chart card numerals and motion follow the card system

All numerals rendered by the chart cards — stat tiles, tooltips, legends, and scope/subtitle lines — SHALL use tabular numerals (`tabular-nums`). Chart cards SHALL NOT add enter animations beyond the transcript's existing row behavior and SHALL NOT render loading skeletons (card rows exist only for completed tool results — `gui/web/src/features/chat/chat-rows.js:51` skips tools with neither output nor error — so a chart card cannot exist before its data). Any CSS transition in the chart cards SHALL name specific properties; `transition: all` SHALL NOT be used.

#### Scenario: Card renders once, fully, from completed data

- **WHEN** a chart card first appears in a streaming transcript
- **THEN** it renders its chart directly from the completed tool result with no skeleton state and no card-specific enter animation

#### Scenario: Numerals are tabular

- **WHEN** a chart card renders legend values, tooltip values, or stat tiles
- **THEN** those numerals render with `tabular-nums`

### Requirement: compare_companies card behavior is unchanged

The existing `CompareCard` (`market.jsx:374`) SHALL continue to render `compare_companies` fundamentals results exactly as today; this change SHALL NOT modify its registry entry, props, or rendering.

#### Scenario: Fundamentals comparison still renders the metrics table

- **WHEN** a `compare_companies` result is rendered after this change
- **THEN** `CompareCard` renders its fundamentals metrics table as before

### Requirement: Compare workflow instructs the comparison tool

`buildCompareAssetsPrompt` (`src/prompts/workflow-prompts.ts:367`) SHALL include one additional step instructing use of `get_price_comparison` with the resolved symbols (and a range appropriate to the resolved time horizon) so compare answers include an indexed price comparison. `get_price_comparison` SHALL be registered in `src/tools/index.ts` and added to the `core_market` tool bundle (`src/routing/route-manifest.ts` `TOOL_BUNDLE_TOOLS`) so tool-scope enforcement admits it on compare dispatches. The prompt step SHALL be generic — no ticker-, sector-, or benchmark-specific wording — and the prompt-debt guard (`tests/unit/prompts/prompt-debt-guard.test.ts`) SHALL pass with the change, with prompt-output snapshots updated to match.

#### Scenario: Compare prompt names the tool

- **WHEN** `buildCompareAssetsPrompt` is built for any symbol set
- **THEN** the prompt's steps include using `get_price_comparison` on the resolved symbols

#### Scenario: Tool is in scope for compare dispatches

- **WHEN** a compare workflow turn is dispatched under tool-scope enforcement
- **THEN** `get_price_comparison` is an allowed tool via the `core_market` bundle

#### Scenario: Prompt-debt guard stays green

- **WHEN** the prompt change lands
- **THEN** `npx vitest run tests/unit/prompts/prompt-debt-guard.test.ts` passes and prompt-output snapshots reflect the new step

### Requirement: Large tool details survive the event pipeline round trip

The chat-event pipeline SHALL persist and replay large tool `details` arrays (multi-symbol OHLCV payloads) intact: a toolResult session entry carrying such details, adapted via `sessionEntriesToChatEvents` and reduced by the shared event reducer, SHALL yield the identical details payload on the card message.

#### Scenario: Round-trip assertion on a large details array

- **WHEN** a session entry with a multi-symbol OHLCV details payload is adapted and reduced
- **THEN** the resulting `tool.completed` output's `details` deep-equals the persisted payload
