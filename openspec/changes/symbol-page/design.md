# Design: Symbol Page

## Context

The GUI's routing is hybrid: gui/web/src/router.jsx declares TanStack routes (each with `validateSearch: validateGuiSearch` so drawer/prompt search params survive navigation), but the actual page selection is manual pathname switching inside AppShell (gui/web/src/App.jsx:394-448): `pathname === "/diagnostics"` renders DiagnosticsPage, `domainFromPath(pathname)` (App.jsx:499-505, a pure string switch over `/watchlists`, `/portfolios`, `/alerts`, `/reports`) renders MarketStatePage, everything else falls through to ChatPanel. A new page therefore needs both halves.

The data pattern to copy end-to-end is WatchlistPage: MarketStatePage calls `useMarketState()` (gui/web/src/hooks/useMarketState.jsx), which polls two read-only endpoints — `/api/market-state` every 4s (`MARKET_STATE_POLL_MS`, structural state: instruments, watchlists, portfolios, lots, alerts, alertEvents, reports) and `/api/market-state/quotes` every 5 min (the `QuoteSnapshotStore` stale-while-revalidate snapshot). No websocket, no session. Mutations go through `invokeTool("manage_watchlist", …)` and are writer-only; followers get `readOnly`/disabled controls.

Server-side, gui/server/http-routes.ts already exposes `GET /api/instruments/quote?symbol=` (http-routes.ts:254 → `getInstrumentQuoteSnapshot`, gui/server/market-state-api.ts:482 — an ad-hoc single-symbol Yahoo quote, freshness-stamped) and `GET /api/instruments/search?q=` (http-routes.ts:248 → `searchInstrumentCandidates`), both guarded by `allowTrustedGuiRequest` and neither creating sessions. The chart endpoint `/api/instruments/history` is owned by the parallel `market-chart` change.

Agent dispatch has a single entry: `startRoutedChatRun` (App.jsx:243) — writers get a fresh session and the `run.started` handler auto-navigates to `/sessions/$sessionId`. AppShell currently does not pass it to MarketStatePage; it does pass it to ChatPanel (App.jsx:432) and CatalogOverlay (App.jsx:463).

## Goals / Non-Goals

**Goals:**

- One URL per ticker (`/symbol/$ticker`) rendering quote, chart, key stats, and the user's own context, follower-safe and with no model configured.
- Zero new polling machinery: reuse `useMarketState()` and add only two per-symbol fetches (quote, overview).
- Protect Yahoo from page-open fan-out with server-side per-symbol SWR memos.

**Non-Goals:**

- Financials/Earnings/Options/Filings tabs (sequenced after `lse-data-provider`), FX conversion, websockets, news, or any respec of `market-chart`-owned pieces (see proposal Non-Goals).

## Decisions

### D1: Route resolution = router.jsx entry + AppShell branch + `tickerFromPath`

Add a `/symbol/$ticker` route to router.jsx with `validateSearch: validateGuiSearch` (matching router.jsx:10-58), AND a branch in AppShell that renders `<SymbolPage>` **before** the `marketDomain` branch (App.jsx:394-448). Ticker parsing uses a new exported pure helper `tickerFromPath(pathname)` mirroring `domainFromPath` so it is unit-testable without rendering.

- **Why not TanStack route components alone?** AppShell ignores route components; every existing page is selected by pathname switching. Adding only the router entry would render ChatPanel at `/symbol/AAPL`.
- **Alternative considered — refactor AppShell to real route rendering:** rejected; cross-cutting, out of scope, and every existing page would need migration.
- **Edge cases owned by `tickerFromPath`:** URL-decoding (`%5EGSPC` → `^GSPC`), case normalization to uppercase (`/symbol/aapl` → `AAPL`), dash symbols (`BRK-B`, `BTC-USD`), rejecting empty/extra segments (`/symbol/`, `/symbol/A/B` → no match → ChatPanel fallthrough as today).

### D2: `useSymbolData(ticker)` composes existing state, never duplicates it

The hook composes: (1) `useMarketState()` for structural state + quote snapshot; (2) a fetch of `/api/instruments/quote?symbol=` for the ad-hoc header quote (symbols not in any watchlist/portfolio have no snapshot entry); (3) a fetch of the new `/api/instruments/overview?symbol=`; (4) `useInstrumentHistory(symbol, range)` from `market-chart` for the chart — the `market-chart` spec fixes that hook's home (`gui/web/src/hooks/`, sibling of `useMarketState.jsx`) and return shape (`{snapshot, loading, error}`), and fixes the `<MarketChart>` prop contract as a STABLE API (`series`, `mode`, `prevClose`, `range`, `onRangeChange`, `showVolume`, `height`, `className`). SymbolPage owns the current range as local state, passes `range` + `onRangeChange` so `<MarketChart>` renders its built-in selector, and re-fetches via the hook on range change; the range-button vocabulary and selector behavior belong to `<MarketChart>`, not this page. Position rows, alert rows, and watchlist membership are derived client-side by filtering state on the ticker — exactly the `SymbolInspector` pattern (WatchlistPage.jsx:421-437: `buildHoldingRows` over `state.portfolio` filtered by symbol, `buildAlertSentenceRows` over `state.alerts` filtered by instrument).

- **Why not a new aggregate server endpoint?** The structural data is already polled by `useMarketState()`; an aggregate endpoint would duplicate the snapshot store and create a second freshness source of truth.

### D3: Overview endpoint with a load-bearing per-symbol SWR memo

`GET /api/instruments/overview?symbol=` wraps `getYahooCompanyOverview` (src/providers/yahoo-finance.ts:125 — already cached with `TTL.FUNDAMENTALS` + stale fallback in the shared provider cache) via `wrapProvider("yahoo", …)` in gui/server/market-state-api.ts, mirroring how `getInstrumentQuoteSnapshot` wraps `getQuote` (market-state-api.ts:559). Response shape: `{symbol, status: "ok", name, description, exchange, sector, industry, marketCap, pe, forwardPe, eps, dividendYield, beta, avgVolume, profitMargin, revenueGrowth, week52High, week52Low, stale}` or `{symbol, status: "unavailable", reason}`. On top, a GUI-server per-symbol memo (~5 min TTL, single in-flight promise per symbol, serving the previous value while revalidating) modeled on `QuoteSnapshotStore` (gui/server/quote-snapshot-store.ts:3) and `createSavedSymbolsMemo` (market-state-api.ts:122).

- **Why a memo when the provider already caches?** The provider cache still pays a `rateLimiter.acquire("yahoo")` per call and the GUI polls; the memos are load-bearing against Yahoo rate limits (the existing quote/saved-symbols memos exist for the same reason). Page opens must be O(1) upstream calls per symbol per TTL window.

### D4: marketCap fix is additive

`getInstrumentQuoteSnapshot` (market-state-api.ts:482) drops `marketCap` although `getQuote` returns it on `StockQuote` (src/types/market.ts:12). Add `marketCap` to the returned object and type. Additive only — verify no consumer asserts the exact shape (grep tests for `getInstrumentQuoteSnapshot` / `/api/instruments/quote` response keys).

### D5: Prop threading, not context

AppShell passes `startChatRun={startRoutedChatRun}`, `navigate`, `invokeTool={invokeToolForVisibleSession}`, `role`, and `setToast` to SymbolPage explicitly, matching how ChatPanel (App.jsx:432) and MarketStatePage receive their props. AnalyzePanel chips are `[label, prompt]` pairs templated on the ticker per the `DEFAULT_PROMPTS` pattern (gui/web/src/components/chat/home-prompts.js:3), e.g. `["What is ${T} trading at?", …]`, `["Options chain for ${T}", …]`, `["Deep research: ${T} (multi-analyst, takes a few minutes)", "/analyze ${T}"]`. Writer-only; disabled with the role-based read-only affordance for followers.

- **Why not a shared React context for chat dispatch?** No existing page uses one; introducing it here would be a new architectural pattern for a leaf feature.

### D6: Non-equity branch keys off asset classification, with overview status as fallback

src/market-state/resolve.ts classifies asset types (`-USD` suffix → crypto, `^` prefix → index; resolve.ts:99-100). For `assetType !== equity` — or whenever the overview endpoint returns unavailable/null fields — SymbolPage renders header + chart only and hides KeyStats/overview sections. Never render placeholder zeros ("$0.00 P/E"): `getYahooCompanyOverview` coerces some missing numbers to `0` (e.g. `marketCap`, `avgVolume`), so the KeyStats grid treats `0`/`null` as "omit the stat".

### D7: Section primitives are reused, not re-invented

SymbolHeader uses `ExtendedHoursQuote` (gui/web/src/features/market-state/shared.jsx:184) for pre/post-market lines and the existing market-state badge conventions; layout uses `Panel` (shared.jsx:47), `money` (shared.jsx:407) / `moneyOrDash` (shared.jsx:416), `SignedPercent` (shared.jsx:145), `Skeleton` (gui/web/src/components/ui/skeleton.jsx), and `Button` (gui/web/src/components/ui/button.jsx). `InspectorSection` is currently a private component inside WatchlistPage.jsx (WatchlistPage.jsx:543); this change moves it to shared.jsx as a named export (WatchlistPage keeps importing it) rather than duplicating it. Freshness and refresh-flash behavior reuse the format.js/shared.jsx pair: `degradedQuoteBadge` (gui/web/src/features/market-state/format.js:25) for the staleness badge, and `useQuoteChangeFlash` (shared.jsx:267) + `quoteFlashClass` (shared.jsx:286) — driven by `quoteChangeDirections` (format.js:62) — for the price-change tint.

## UI/UX guidance

Anchor: DESIGN.md at the repo root is normative — minimal shadcn language, Inter everywhere, zinc neutrals, Research Ink `#18181B` as the only action color, semantic signals success `#1A9948` / danger `#EF4343` / warning `#DC8409` / info `#3C83F6`, radii sm 6px / md 8px / lg 12px. Every rule below reuses an existing primitive or convention (D7); no new one-off styles.

**Visual hierarchy**

- The price is the hero. Page title (the `h1`) is company name + symbol with `text-wrap: balance`; below it, a large price in tabular numerals with a direction-colored change chip that carries an arrow icon plus the signed value — direction is never conveyed by color alone.
- The extended-hours line follows the existing convention verbatim: session-labeled line, "Pre-market" on the warn (amber) badge tone, "After hours" on the info (blue) tone, rendered by `ExtendedHoursQuote` (shared.jsx:184) unmodified — do not restyle it (CHANGELOG 0.12.0).
- KeyStats render as a flat divided stat grid — the ticker-popover pattern (entity-popover.jsx `divide-y divide-border` stat rows; CHANGELOG 0.12.0 "flat divided stat grid") — with definition-list semantics (`dl`/`dt`/`dd`) like the mobile portfolio summary (PortfolioPage.jsx:424-449): label in muted label type, value right-aligned in tabular numerals. Blank/unavailable facts are hidden, never rendered as "—$0.00" or "0.00 P/E" (D6).
- Section order top-to-bottom: header → chart → key stats → position → alerts → analyze panel. Mobile is a single column in the same order; the page body never scrolls horizontally — wide content scrolls inside its own `overflow-x` container (existing market-state convention).

**Numbers and typography**

- `font-variant-numeric: tabular-nums` (the `tabular-nums` utility) on every dynamic numeral — price, change, stats, position P&L — so background quote refreshes never shift layout.
- Money and percent formatting go through `money`/`moneyOrDash`/`SignedPercent` from shared.jsx; never ad-hoc `toFixed`.

**Interaction and motion**

- Analyze chips and action buttons: minimum 40x40px hit area, `active:scale-[0.96]` press feedback, transitions scoped to specific properties (never `transition: all`).
- First load renders `Skeleton` blocks sized to the final section heights (header, chart, stats) — no enter animations on initial paint and no layout jump when data lands.
- Price-change flash on background refresh reuses `useQuoteChangeFlash` + `quoteFlashClass` (which already suppress under `prefers-reduced-motion` via `motion-reduce:`); reference that implementation, do not re-specify it.
- Quote staleness reuses `degradedQuoteBadge` ("Quotes Nm old" / "As of <date>") — no new indicator.
- Nested surfaces inside `Panel`s use concentric radii: outer lg 12px, inner radius = outer minus padding.
- Follower/read-only mode: disabled controls keep their visible labels with neutral availability language (the neutral syncing/unavailable copy convention, CHANGELOG 0.11.0) — actions are never silently hidden.

**Accessibility**

- Landmarks: the page is a `main` region whose `h1` is the symbol/company title; each section is a labeled group. The stat grid uses `dl`/`dt`/`dd`. The chart's internal accessibility is owned by the `market-chart` component contract — this page only wraps it in a labeled section and does not respec chart internals.
- Keyboard: every entry point (row links, popover "Open $X page", chips) is a real link or button with the focus-visible ring from the existing ui primitives.

## Risks / Trade-offs

- [Yahoo rate limiting from page-open fan-out] → per-symbol SWR memo (D3) plus the provider-level cache; the quote fetch reuses the existing memoized `getInstrumentQuoteSnapshot` path.
- [AppShell branch ordering regressions (symbol page shadowing market-state pages or vice versa)] → `tickerFromPath` only matches the `/symbol/` prefix; unit tests pin the precedence (diagnostics → symbol → marketDomain → chat).
- [Follower windows triggering mutations] → all mutation affordances gate on `role !== "writer"` exactly like WatchlistPage's `readOnly` plumbing; spec scenarios cover the follower rendering.
- [marketCap shape change breaking a consumer] → additive field + explicit consumer grep in tasks; the endpoint response was already an open object.
- [market-chart slips or changes its hook API] → hard dependency declared; SymbolPage isolates chart consumption behind one section component so a signature change touches one file.
- [Ticker-shaped garbage URLs (`/symbol/<script>`)] → `tickerFromPath` validates against a conservative symbol charset (alphanumerics plus `.-^=`) and everything renders through React (no injection surface); unknown-but-valid symbols get the unavailable state from the endpoints.

## Migration Plan

Pure addition — no schema changes, no config, no breaking API. Rollback is deleting the route/branch/endpoint. Entry-point links degrade gracefully if the page is removed (they are plain navigations).

## Open Questions

- Whether instrument-search selection navigates immediately or shows a "view page" affordance per candidate — implementer's choice within the entry-point requirement; the spec only requires that selection can reach `/symbol/$ticker`.

(Previously open: the `useInstrumentHistory` / `<MarketChart>` signature. Resolved — the `market-chart` spec fixes both as a stable API; see D2. The remaining dependency is only that `market-chart` lands first.)
