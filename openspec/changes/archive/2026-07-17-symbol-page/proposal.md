# Symbol Page: A Read-Only Per-Ticker View in the Local GUI

## Why

Every symbol-shaped surface in the GUI today dead-ends in a cramped side panel or a chat prompt: the watchlist `SymbolInspector` (gui/web/src/features/market-state/WatchlistPage.jsx:421), the cashtag entity popover ("Ask about $X", gui/web/src/features/chat/entity-popover.jsx:164), and portfolio rows all show a slice of one symbol's picture with nowhere to go deeper. There is no Google-Finance-quote-page equivalent — one URL per ticker with the full quote, an interactive chart, key stats, and the user's own position/alert/watchlist context — even though every data source it needs already exists server-side. With the `market-chart` change delivering `/api/instruments/history` + `<MarketChart>`, the missing piece is the page itself.

## What Changes

- **New route `/symbol/$ticker`** in the local GUI: a TanStack route entry in gui/web/src/router.jsx (with `validateSearch: validateGuiSearch`, like every existing route at router.jsx:10-58) **plus** an AppShell branch in gui/web/src/App.jsx, because AppShell does manual pathname switching (App.jsx:394-448: `/diagnostics` → DiagnosticsPage; `domainFromPath(pathname)` (App.jsx:499-505) → MarketStatePage; else ChatPanel). A new tested `tickerFromPath(pathname)` helper mirrors `domainFromPath` and handles encoding/case edge cases (`BRK-B`, `BTC-USD`, `^GSPC`, `%5EGSPC`, lowercase input).
- **Read-only by construction**: viewing the page creates no chat session, takes no writer lock, and requires no model key. Data comes from the same polling pattern WatchlistPage uses — `useMarketState()` (gui/web/src/hooks/useMarketState.jsx: `/api/market-state` every 4s, `/api/market-state/quotes` every 5min) — plus per-symbol fetches of the existing `GET /api/instruments/quote` (gui/server/http-routes.ts:254) and a new overview endpoint. Followers see the full page with mutation affordances disabled.
- **New endpoint `GET /api/instruments/overview?symbol=`** wrapping `getYahooCompanyOverview` (src/providers/yahoo-finance.ts:125) via `wrapProvider("yahoo", …)`, guarded by `allowTrustedGuiRequest`, with a per-symbol stale-while-revalidate memo (~5 min TTL, single in-flight fetch per symbol) modeled on `QuoteSnapshotStore` (gui/server/quote-snapshot-store.ts:3) / `createSavedSymbolsMemo` (gui/server/market-state-api.ts:122) so repeated page opens don't hammer Yahoo.
- **Bug fix (in scope)**: `getInstrumentQuoteSnapshot` (gui/server/market-state-api.ts:482) drops `marketCap` even though `getQuote` returns it (src/types/market.ts:12); add `marketCap` to the returned shape (additive).
- **New page** gui/web/src/features/symbol/SymbolPage.jsx with a `useSymbolData(ticker)` hook: SymbolHeader (name, price, change, extended-hours, currency, market-state badge), `<MarketChart>` (consumed from the `market-chart` change), KeyStats grid, PositionCard, AlertsCard, WatchlistMembership + Add-to-watchlist, and AnalyzePanel. Position/alert/membership context is derived client-side by filtering `useMarketState()` state on the ticker, exactly like `SymbolInspector` (WatchlistPage.jsx:421-437, via `buildHoldingRows` + alert-view-model).
- **Agent affordances (writer-only)**: AnalyzePanel chips are symbol-templated `[label, prompt]` pairs following the home-prompts.js pattern, dispatched through `startRoutedChatRun` (App.jsx:243) — which AppShell currently does not pass to MarketStatePage and must pass to SymbolPage (plus `navigate`, `invokeTool`, `role`, `setToast`). Add-to-watchlist / Create-alert reuse `invokeTool("manage_watchlist"/"manage_alerts")`.
- **Entry points**: WatchlistPage QuoteBoard symbol cells and PortfolioPage rows link to `/symbol/$ticker` (inline inspector stays); entity-popover gains an "Open $X page" button beside "Ask about $X"; SymbolInspector gains an "Open full page" link; instrument search (`SymbolSearchInput` in gui/web/src/features/market-state/MarketStatePage.jsx, backed by gui/web/src/features/instruments/use-instrument-search.js) candidates can navigate to the page.
- **Design-system conformance**: the page follows DESIGN.md and the existing market-state conventions end to end — shared primitives only (`InspectorSection` is promoted from a WatchlistPage-private component to a shared.jsx export), price-hero hierarchy with non-color-only direction cues, `dl`-semantics stat grid, tabular numerals, skeleton first load, and the existing quote-flash and staleness-badge behavior. Details live in design.md "UI/UX guidance"; the user-visible rules are spec requirements.
- **Non-equity and unavailable symbols**: crypto (`-USD` suffix) and indices (`^` prefix) per src/market-state/resolve.ts:99-100 render quote header + chart only (company overview does not exist for them — never render "$0.00 P/E"); unknown symbols get a clean not-found state driven by the endpoints' existing `{status: "unavailable", reason}` responses.

## Capabilities

### New Capabilities

- `symbol-page`: the `/symbol/$ticker` GUI route and page — route/AppShell resolution, no-session read-only rendering, the instruments overview endpoint + memo, the marketCap fix, section data sourcing, analyze/mutation affordances by role, non-equity and unavailable-symbol handling, and entry-point navigation.

### Modified Capabilities

_None. Existing capability specs (e.g. `stateful-market-surfaces`, `cashtag-entity-ux`) keep their requirements; this change only adds navigation affordances that link into the new capability._

## Non-Goals

- **No Financials | Earnings | Options | Filings tabs in v1** — named follow-ups explicitly sequenced after the `lse-data-provider` change lands (the financials tab should use the LSE-backed chain; earnings estimates need a provider extension that does not exist yet).
- **No respec of `/api/instruments/history`** — that endpoint, the `useInstrumentHistory` hook, and the `<MarketChart>` component are owned by the parallel `market-chart` change; this page only consumes them.
- No FX conversion beyond `getQuote.currency` (reuse the existing mismatched-currency exclusion logic).
- No websocket or streaming quotes on this page; polling only.
- No news section.

## Dependencies / Sequencing

- **HARD**: `market-chart` — provides `<MarketChart>`, `/api/instruments/history`, and `useInstrumentHistory`. Implement `symbol-page` after `market-chart`.
- **SOFT**: v2 tabs (Financials/Earnings/Options/Filings) after `lse-data-provider`.
- The parallel `home-market-dashboard` change will deep-link movers rows to this page once it exists (it degrades to composer prefill without it) — no action needed here.

## Impact

- **New**: gui/web/src/features/symbol/ (SymbolPage.jsx, useSymbolData, section components), `tickerFromPath` helper, `GET /api/instruments/overview` route + per-symbol overview memo in gui/server/.
- **Modified**: gui/web/src/router.jsx (route entry); gui/web/src/App.jsx (AppShell branch + prop threading); gui/server/http-routes.ts (overview route); gui/server/market-state-api.ts (overview handler + memo; `marketCap` added to `getInstrumentQuoteSnapshot`); gui/web/src/features/market-state/shared.jsx (`InspectorSection` export moved from WatchlistPage.jsx); WatchlistPage.jsx / PortfolioPage.jsx / entity-popover.jsx / SymbolInspector / instrument search (links only).
- **Untouched**: providers (reuses `getYahooCompanyOverview` as-is), routing/workflows, memory schema, Pi shell integration, TUI.
- **Risk surface**: Yahoo rate limits on page opens — mitigated by the load-bearing SWR memos; follower/writer correctness — covered by explicit spec scenarios.
