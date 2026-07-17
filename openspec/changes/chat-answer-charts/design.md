# Design: Chat Answer Charts

## Context

**Rendering pipeline (verified in a completed spike — both live SSE and persisted reload converge, so cards work identically in both):**

- `gui/server/chat-event-adapter.ts` `sessionEntriesToChatEvents()` turns each toolResult message into a `tool.completed` event with `output = {content, details, isError, source}` (`toolOutput()`, :277-289). The full tool `details` payload **is** persisted in session entries — OHLCV arrays survive reload.
- Live path: `gui/server/live-chat-event-adapter.ts` emits the same shapes.
- Client: `gui/shared/event-reducer.ts` stores `tool.output`; `gui/web/src/features/chat/chat-rows.js` (:107-125) builds the card message `{toolName, content, details, isError}`.
- Card registry: `gui/web/src/features/renderers/cards/index.jsx` holds a `RENDERERS` Map keyed by **exact tool-name string** → `{category, Component}`; `ToolResultCard.jsx` falls back to `GenericCard` on a miss. Cards receive props (`ToolResultCard.jsx:30-35`): `message` (`.toolName/.content/.details/.isError/.details.args`), `header`, `text`, `sessionMarketFacts`. Cards read structured details via `extractDetails(message) = message.details?.value ?? message.details ?? {}` (`cards/card-format.js`). `get_stock_history` puts `OHLCV[]` directly in `details` (`src/tools/market/stock-history.ts:102`).

**Current state of the two touch points:**

- `HistoryCard` (`gui/web/src/features/renderers/cards/market.jsx:111-152`) renders `get_stock_history` **and** `get_crypto_history` (`cards/index.jsx:25-26`) with a bespoke SVG chart: `PriceChart` (:154-310), `HoverTooltip` (:312-335), and tick/format helpers `niceFloor`/`niceCeil`/`buildTicks`/`pickTickIndices`/`formatTick`/`formatDateLong` (:337-372).
- No single tool result carries multi-symbol history: `compare_companies` (`src/tools/fundamentals/comps.ts`) returns `CompsResult` (fundamentals only); `get_stock_history` is single-symbol; the compare workflow prompt (`buildCompareAssetsPrompt`, `src/prompts/workflow-prompts.ts:367`) calls `get_stock_quote` per symbol + `compare_companies` + technical/risk tools, never history.

**Dependency:** the `market-chart` change delivers the shared `<MarketChart>` component. Its design and spec are now authored (`openspec/changes/market-chart/design.md` D6, spec requirement "MarketChart renders provided series data and never fetches"), and this change consumes exactly that landed contract:

- `series`: array of `{ symbol, bars: [{time, open, high, low, close, volume}], indexed?: number[] }`, 1..N entries; bar `time` is UTC epoch **seconds**.
- `mode`: `'area' | 'candlestick' | 'indexed'` (indexed is the multi-series comparison mode; when `indexed` arrays are absent the component computes `close / bars[0].close * 100` itself, and a caller may precompute via the optional per-series `indexed` array).
- `onRangeChange` absent → **no range selector renders** (per market-chart's "Range selector renders only when a change handler is provided" requirement) — exactly what chat cards need.
- Note the field split: market-chart adds an optional `timestamp` field (UTC epoch seconds) to `OHLCV` in the **provider layer** (its D2), while the `MarketChart` bar prop field is named `time`. Tool-persisted bars therefore carry `date` (always) and `timestamp` (when fetched after market-chart lands) — never `time`; card wrappers map `timestamp` → `time`.

**Land market-chart first** — this change's cards import the component and must not stub it.

## Goals / Non-Goals

**Goals:**

- History card renders through the shared `<MarketChart>` from persisted `details`, identical live and on reload; bespoke SVG deleted.
- One typed tool result (`get_price_comparison`) carrying aligned multi-symbol indexed history, rendered as an indexed comparison chart card, wired into the compare workflow.
- TUI output unaffected: every tool keeps a compact text `content` form; cards are a GUI-only rendering of `details`.

**Non-Goals:**

- Analyst-level chart annotations (entry/target/stop lines): `opencandle-analyst-step` entries carry only `{stage}` (`src/runtime/session-coordinator.ts:916/930/944`) and synthesis is free prose plus a string-templated VERDICT block (`src/analysts/orchestrator.ts` ~:153) — no structured numeric levels exist to annotate with. Future change.
- In-card range switching/refetch (see Decision 2).
- `technical.jsx` swap (needs MarketChart indicator panes, deferred in market-chart).
- Any change to `compare_companies` output or `CompareCard` (`market.jsx:374`).

## Decisions

### 1. New `get_price_comparison` tool over client-side join or server chart-spec entries

Options considered in the spike:

- **(a) Client-side join across sibling tool results** — rejected: `chat-rows.js` has no combine seam (each toolResult becomes one card message independently); correlating N `get_stock_history` cards client-side is fragile and breaks on partial failures and reload ordering.
- **(b) New tool returning aligned multi-symbol indexed history in one typed result** — **chosen**: one tool call → one persisted `details` payload → one card, riding the existing pipeline unchanged; the agent/TUI gets a real text table; partial symbol failure is representable inside the single result.
- **(c) Server-side chart-spec session entries** — rejected: a parallel render path alongside the card registry, over-engineered for one chart.

Tool shape (per repo conventions: Typebox params, named `AgentTool` export `priceComparisonTool`, snake_case name; tools fetch + format, never analyze):

- **Params**: `symbols` (2..6 tickers, `minItems: 2, maxItems: 6`), `range` (reuse the `HISTORY_RANGES` literal union from `src/tools/market/stock-history.ts:12-24` — export it rather than duplicating), optional `interval` (reuse `HISTORY_INTERVALS`, default `1d`).
- **Fetch**: per symbol, the exact provider chain `get_stock_history` uses — `withFallback([{provider: "yahoo", fn: getHistory}, {provider: "alphavantage", fn: getDailyHistory}])` for daily intervals with an Alpha Vantage key, `wrapProvider("yahoo", ...)` otherwise (`stock-history.ts:60-69`). Reuse by extracting that fetch into a shared exported function in `stock-history.ts`, not by forking the chain. Symbols whose fetch is `unavailable` go to `unavailableSymbols` — not fatal while ≥2 series remain.
- **Alignment + indexing**: the aligned date set is the intersection of bar dates across surviving series — only dates present in **all** surviving series survive (this is deliberately correct for mixed calendars: a crypto series trading 7 days/week compared against an equity trading 5 days/week aligns to the equity's trading dates, dropping the crypto weekend bars). `baseDate` = first common date; `indexed[i] = close[i] / close[0] * 100` over the aligned bars. If the intersection drops more than 30% of any surviving series' fetched bars, the content text notes the reduced aligned window (count of dropped bars and which symbol drove it). This is deterministic arithmetic reformatting of fetched data — the same class as `stock-history`'s table formatting — not analysis.
- **`details`**: the canonical typed shape is defined once, in the spec ("get_price_comparison returns aligned multi-symbol indexed history") — `{ range, interval, baseDate, series: [{symbol, bars, indexed}], unavailableSymbols, freshness }`. Do not restate it elsewhere; the spec is normative.
- **`content` text**: a compact table with exactly one row per surviving symbol carrying symbol, first aligned close, last aligned close, and percent change over the aligned window (`(lastClose/firstClose − 1) × 100`, i.e. indexed end value − 100); then the >30%-intersection-loss note when applicable; then a line naming any unavailable symbols; ending with an as-of freshness disclosure line built with `buildFreshnessStamp` + `formatAsOfLine` from `src/infra/freshness.ts` using the latest aligned bar date (the `stock-quote.ts:44-66` usage pattern; note `stock-history.ts` itself predates the freshness ledger and does not stamp — the new tool does it from the start, and the stamp is also included in `details.freshness` for card use).

### 2. Cards render persisted details only — no refetch, no range switching

The range is chosen by the agent's tool args. A client→tool refetch seam does not exist in the card layer, and adding one would desync what the session persisted from what the card displays (reload would show different data than the answer discussed). Both cards render exactly the bars in `details`. Alternative (interactive range picker calling the tool invocation API) rejected for v1 on those grounds.

### 3. History card swap keeps the card, replaces the chart

`HistoryCard` keeps its header/stat-tiles and swaps `<PriceChart bars={bars} .../>` (`market.jsx:140`) for `<MarketChart series={[{symbol, bars}]} mode="area">`. Bar mapping: MarketChart bars need a `time` field (UTC epoch seconds); persisted tool bars carry `timestamp` (epoch seconds, added to `OHLCV` by market-chart's provider change) when fetched after that change lands, and only `date` before it. The card maps `timestamp` → `time` when `timestamp` is a finite number, else derives `time` by parsing `date` as a UTC midnight — old persisted sessions predate `timestamp` and must keep rendering. The ~220 lines of bespoke SVG (`PriceChart`, `HoverTooltip`, tick helpers, `market.jsx:154-372`) are deleted, not kept as fallback. Both registry entries (`get_stock_history`, `get_crypto_history`) go through the swapped card.

### 4. Workflow wiring is one additive prompt step plus bundle/registration entries

- `buildCompareAssetsPrompt` (`workflow-prompts.ts:367`) gains one numbered step instructing `get_price_comparison` with the resolved symbols and a range fitting the time horizon, so the answer can include an indexed price-comparison chart. Generic wording only — AGENTS.md forbids ticker/benchmark-specific prompt text; prompt changes require a green `tests/unit/prompts/prompt-debt-guard.test.ts` and prompt-output snapshot updates.
- `get_price_comparison` joins the `core_market` bundle (`src/routing/route-manifest.ts:13-35`) so tool-scope enforcement admits it on compare dispatches, and is imported/exported/registered in `src/tools/index.ts` (which also puts it through `tests/unit/tools/tool-schema-guardrails.test.ts` and the schema-generated GUI catalog form automatically).

## UI/UX guidance

Anchor: OC chat cards follow the existing card system — the shared primitives in `gui/web/src/features/renderers/cards/_shared.jsx` (`ToolCard` :8, `ToolHeader` :22, `WarningRow` :33, `MoneyTile` :46, `StatRow` :65, `DeltaChip` :82, `RangeBar` :150) and DESIGN.md tokens (zinc neutrals, success `#1A9948` / danger `#EF4343`). Cards are compact evidence renderings inside a chat transcript — not full-page charts.

**Card chart sizing & composition:**

- In-card charts are height-bounded so a chart never dominates the transcript: fixed 220px at `sm` (640px) and above, 180px below `sm`, implemented as container classes (`h-[180px] sm:h-[220px]`) with MarketChart's `autoSize` tracking the container. Width fills the card.
- The card keeps its existing header + stat tiles above the chart: `HistoryCard` retains its current header/price/DeltaChip/stat-tile block (`market.jsx:131-146`); the comparison card composes `ToolCard`/`ToolHeader` + a stat block + chart the same way.
- No range selector inside cards — `onRangeChange` is never passed, so MarketChart renders no selector. The card states its scope honestly instead: the covered range and the as-of. For the comparison card that is `details.range` + `formatAsOfLine(details.freshness)`; for `HistoryCard` (whose details are bare bars with no freshness stamp) it is the first→last bar dates as the window, with the last bar date as the as-of.
- Charts must not horizontally overflow the transcript: the card, not the page, owns any overflow (`overflow-hidden` on the chart container; the canvas autosizes to it).

**Comparison card dataviz rules (`get_price_comparison`):**

- Indexed axis honesty: the card carries a subtitle stating the indexing basis — `% change, indexed to 100 at {baseDate}` — and indexed values are never presented as prices (no currency symbols on the indexed axis, legend, or end-of-line labels).
- Series colors come from the shared `gui/web/src/lib/series-colors.js` module (`SERIES_COLORS`, the fixed categorical palette extracted from `ALLOCATION_COLORS` by the market-chart change's task 5.2 — this change only imports it, never re-extracts). Assignment is by symbol position in the tool result's `details.series` order — stable across rerenders and reloads, never cycled or repainted when a requested symbol lands in `unavailableSymbols`.
- Identity is never color-alone: a legend is always present when ≥2 series render (colored dot + symbol text in text tokens), plus direct end-of-line symbol labels when ≤4 series render.
- `unavailableSymbols` render through the existing `WarningRow` primitive listing the dropped symbols — visible, not silent.
- Crosshair tooltip shows the date plus, per series, the indexed value to one decimal AND the raw close in parentheses (e.g. `NVDA 142.3 ($131.14)`), in tabular-nums.
- The tool's content text table remains the accessible/TUI-parity alternative; the chart container carries an `aria-label` naming the compared symbols and range (e.g. "Indexed price comparison of NVDA, AMD over 1y").

**Numbers / typography / motion:**

- `tabular-nums` on all numerals in stat tiles, tooltips, and legends (the shared tiles already do this; the chart wrapper's own text must too).
- No enter animation when a card streams in beyond the transcript's existing behavior. No loading skeleton: verified — card rows exist only for completed tool results (`gui/web/src/features/chat/chat-rows.js:51` skips tools with neither `output` nor `error`), so a chart card can never exist before its data does.
- CSS transitions, where used at all, are scoped to named properties — never `transition: all`.

## Risks / Trade-offs

- **[MarketChart implementation drift from its authored contract]** → The market-chart spec now pins the prop contract this change consumes (`series` with optional per-series `indexed`, `mode: 'area'|'candlestick'|'indexed'`, bar `time` in epoch seconds, no selector without `onRangeChange`); hard sequencing remains — implement after `market-chart` lands — and the card wrappers are the only adaptation point if its implementation deviates from its spec.
- **[Per-series color seam]** → RESOLVED by market-chart's tasks (5.2/5.4/5.5): MarketChart's indexed mode consumes `SERIES_COLORS` from `gui/web/src/lib/series-colors.js` internally, assigned by initial series position and held in a symbol→color map so removals never repaint survivors. No `series[].color` prop exists. The comparison card's legend/end-of-line labels use the same `SERIES_COLORS[index]` assignment over `details.series` order, which matches MarketChart's internal assignment because the card builds the `series` prop from `details.series` in order.
- **[Session-entry size growth ×N symbols per comparison]** → Same class as `get_stock_history`'s existing full-OHLCV `details`; accepted and noted. The event-pipeline round-trip test gains an assertion that a large details array survives persist/reload intact.
- **[N-symbol provider fan-out hitting rate limits]** → Reuse the per-symbol `cache`/`rateLimiter`/`withFallback` infra (each symbol degrades independently into `unavailableSymbols`); symbol count is capped at 6 by the params schema.
- **[Sparse/misaligned calendars (new listing, holiday gaps, crypto 7-day weeks) shrinking the common-date intersection]** → Deterministic and honest: intersection over dates present in all surviving series, `baseDate` + as-of line report the aligned window, and a >30%-of-any-series bar-loss threshold triggers an explicit note in the content text; if fewer than 2 usable aligned series remain, return an explicit unavailable-style text result instead of a fabricated chart.

## Migration Plan

Additive only: new tool, new card, one prompt step. No schema changes, no data migration. Rollback = revert the commits; persisted sessions containing `get_price_comparison` results degrade to `GenericCard` rendering of the details JSON, which is the registry's existing fallback behavior.

## Open Questions

- None. The per-series color question is resolved (see the per-series color seam risk above): market-chart owns the `series-colors.js` extraction (its task 5.2) and MarketChart applies `SERIES_COLORS` internally; this change only imports the module for the card's legend/end-of-line labels. The rest of the MarketChart contract is settled by market-chart's authored spec.
