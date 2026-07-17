# Chat Answer Charts: Real Charts Inside Chat Answers

## Why

Google Finance's AI beta embeds an indexed NVDA-vs-AMD comparison chart inside its answer; OpenCandle answers the same prompts with fundamentals tables and a bespoke single-symbol SVG history card, but no comparison chart — and today **no single tool result carries multi-symbol price history** (`compare_companies` in `src/tools/fundamentals/comps.ts` returns fundamentals only; `get_stock_history` is single-symbol; the compare workflow prompt at `src/prompts/workflow-prompts.ts:367` calls `get_stock_quote` per symbol + `compare_companies` + technical/risk tools, never history). OC should render its own comparison chart from primary provider data, through the existing tool-result card pipeline it already persists and replays.

## What Changes

- **History card swap**: `HistoryCard` in `gui/web/src/features/renderers/cards/market.jsx` (component at :111-152, plus ~220 lines of bespoke SVG — `PriceChart` :154-310, `HoverTooltip` :312-335, tick/format helpers :337-372) replaces its bespoke chart internals with the shared `<MarketChart>` component from the `market-chart` change, keeping the existing header and stat tiles. The bespoke SVG helpers are deleted. `HistoryCard` renders both `get_stock_history` and `get_crypto_history` (`cards/index.jsx:25-26`); both keep working. **No in-card range switching or refetching** — the card renders exactly the bars the tool fetched (range is chosen by the agent's tool args; no client→tool refetch seam exists, and adding one would desync persisted vs displayed data).
- **New tool `get_price_comparison`** at `src/tools/market/price-comparison.ts`: takes 2-6 symbols + range (+ optional interval), fetches history per symbol reusing `get_stock_history`'s Yahoo → Alpha Vantage `withFallback` provider chain (`src/tools/market/stock-history.ts:60-69` — reuse, don't fork), date-aligns the series to their common dates, and computes an indexed series (`close/close[0]*100` — deterministic formatting, not analysis, honoring the tools-never-analyze rule). The canonical typed `details` shape (range, interval, baseDate, per-symbol aligned bars + indexed values, unavailableSymbols, freshness stamp) is defined once, in the spec. Content text stays a compact table (the agent/TUI-visible form, required like every tool) with an as-of freshness disclosure line.
- **New comparison chart card**: `RENDERERS` in `gui/web/src/features/renderers/cards/index.jsx` gains `["get_price_comparison", { category: "Comparison", Component: PriceComparisonCard }]` (new `cards/price-comparison.jsx`), an honest indexed dataviz per the design's UI/UX guidance: height-bounded chart, "% change, indexed to 100 at {baseDate}" subtitle, position-stable series colors from a shared palette module with legend and end-of-line labels, `WarningRow` for unavailable symbols, and an `aria-label` naming symbols and range. The existing `CompareCard` (`market.jsx:374`) for `compare_companies` fundamentals stays unchanged.
- **Compare workflow wiring**: `buildCompareAssetsPrompt` (`src/prompts/workflow-prompts.ts:367`) gains one step instructing use of `get_price_comparison` for an indexed price-comparison chart; `get_price_comparison` is added to the `core_market` tool bundle in `src/routing/route-manifest.ts` (TOOL_BUNDLE_TOOLS, :13-35) and registered in `src/tools/index.ts`.
- **Deferred**: the `technical.jsx` three-pane chart swap (needs MarketChart indicator-pane support, which the `market-chart` change defers).

## Capabilities

### New Capabilities

- `chat-answer-charts`: charts rendered inside chat answers from persisted tool details — the MarketChart-backed history card (live + reload parity, no card-initiated refetch), the `get_price_comparison` tool contract (params, per-symbol fallback, date alignment, indexed math, unavailable-symbol reporting, TUI text + freshness disclosure), the indexed comparison chart card, and compare-workflow wiring.

### Modified Capabilities

None. `compare_companies`/`CompareCard` behavior is explicitly unchanged; the compare workflow prompt gains an additive step (implementation-level prompt text, no requirement change to an existing spec — no delta spec exists for the compare workflow's tool-call list).

## Non-Goals

- **No chart annotation layer for analyst levels (entry/target/stop lines)** — not feasible in v1. Verified: `opencandle-analyst-step` entries carry only `{stage}` (`src/runtime/session-coordinator.ts:916/930/944`; the GUI projector only counts progress from them), and synthesis output is free prose ending in a string-templated VERDICT/CONFIDENCE/DEBATE WINNER/REVERSAL CONDITION block (`src/analysts/orchestrator.ts` ~:153). No structured numeric levels exist anywhere in the pipeline; annotations need a structured-levels emission first, which is its own future change.
- No in-card range switching or client-initiated refetch (see above — no seam, and it would break persisted/displayed parity).
- No `technical.jsx` chart swap (deferred with the market-chart indicator-pane work).
- No changes to `compare_companies` output or `CompareCard`.
- No TUI rendering changes — TUI keeps seeing tool content text only.

## Impact

- **New files**: `src/tools/market/price-comparison.ts`; `gui/web/src/features/renderers/cards/price-comparison.jsx`; unit tests under `tests/unit/tools/` and `tests/unit/gui-web/`; a new fixture `tests/fixtures/yahoo/MSFT-history.json` (`tests/fixtures/yahoo/AAPL-history.json` exists; only `MSFT-history-e3.json` exists for MSFT today). The shared `gui/web/src/lib/series-colors.js` palette module is created by the `market-chart` change (its task 5.2); this change only imports it.
- **Modified**: `gui/web/src/features/renderers/cards/market.jsx` (HistoryCard internals; SVG helpers deleted), `cards/index.jsx` (new RENDERERS entry), `src/tools/index.ts`, `src/routing/route-manifest.ts` (core_market bundle), `src/prompts/workflow-prompts.ts` (compare prompt step — requires prompt-output snapshot updates and a green `tests/unit/prompts/prompt-debt-guard.test.ts`).
- **Unchanged but relied on**: the event pipeline (`gui/server/chat-event-adapter.ts` `toolOutput` :277-289, `gui/server/live-chat-event-adapter.ts`, `gui/shared/event-reducer.ts`, `gui/web/src/features/chat/chat-rows.js` :107-125) — full tool `details` payloads already persist in session entries and replay identically live and on reload; adding a tool changes nothing here (one round-trip assertion added for large details arrays).
- **Session-entry size**: details grow ×N symbols per comparison call — same class as `get_stock_history`'s existing OHLCV[] details; noted, not mitigated.
- **Rate limits**: N-symbol provider fan-out reuses the existing per-symbol cache/rate-limiter/fallback infra.

## Dependencies / Sequencing

- **HARD**: the `market-chart` OpenSpec change (the shared `<MarketChart>` component). Its design and spec are authored, so the consumed prop contract is pinned: `series: [{symbol, bars: [{time, ...ohlcv}], indexed?}]` with `time` in UTC epoch seconds, `mode: 'area'|'candlestick'|'indexed'`, and no range selector when `onRangeChange` is absent; persisted tool bars carry `timestamp` (its additive `OHLCV` field), which card wrappers map to `time`. Implement this change **after** market-chart lands; remaining churn risk is implementation drift from that spec, absorbed in the card wrappers. One open coordination point: how per-series colors reach indexed-mode lines (see design).
- Independent of `symbol-page` and `home-market-dashboard`.
- **SOFT**: `lse-data-provider` deepens available history ranges through the provider layer automatically — non-blocking.
