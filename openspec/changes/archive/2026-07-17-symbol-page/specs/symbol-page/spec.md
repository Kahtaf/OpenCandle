# symbol-page Specification

## ADDED Requirements

### Requirement: The GUI resolves `/symbol/$ticker` to the symbol page

The GUI SHALL resolve `/symbol/$ticker` to a symbol page via both halves of the hybrid routing: a TanStack route entry in gui/web/src/router.jsx with `validateSearch: validateGuiSearch` (preserving drawer/prompt search params like every existing route), and an AppShell pathname branch in gui/web/src/App.jsx that renders `<SymbolPage>` **before** the `domainFromPath` market-state branch (App.jsx:394-448). Ticker extraction SHALL live in an exported pure helper `tickerFromPath(pathname)` mirroring `domainFromPath` (App.jsx:499-505): it SHALL URL-decode the segment, normalize to uppercase, accept only a conservative symbol charset (alphanumerics plus `.`, `-`, `^`, `=`), and return no match for empty, multi-segment, or non-`/symbol/` paths so those fall through to existing branches unchanged.

#### Scenario: Plain equity ticker renders the page

- **WHEN** the browser navigates to `/symbol/AAPL`
- **THEN** AppShell renders `<SymbolPage>` for ticker `AAPL` instead of ChatPanel or MarketStatePage

#### Scenario: Encoded and lowercase tickers normalize

- **WHEN** the pathname is `/symbol/%5EGSPC` or `/symbol/brk-b`
- **THEN** `tickerFromPath` returns `^GSPC` and `BRK-B` respectively

#### Scenario: Non-matching paths fall through

- **WHEN** the pathname is `/symbol/`, `/symbol/A/B`, or `/watchlists`
- **THEN** `tickerFromPath` returns no match and AppShell renders the same page it renders today (diagnostics → symbol → market-state → chat precedence preserved)

#### Scenario: Garbage segment is rejected

- **WHEN** the pathname segment decodes to characters outside the allowed symbol charset (e.g. `/symbol/%3Cscript%3E`)
- **THEN** `tickerFromPath` returns no match and no symbol page renders for it

### Requirement: Viewing the symbol page creates no session and works for followers

Rendering the symbol page SHALL NOT create a chat session, acquire the writer lock, or require a configured model. All page data SHALL come from read-only surfaces: `useMarketState()` polling (`/api/market-state`, `/api/market-state/quotes`), `GET /api/instruments/quote?symbol=`, `GET /api/instruments/overview?symbol=`, and the `market-chart` history hook. When `role !== "writer"`, the page SHALL render fully (quote, chart, stats, position, alerts, membership) with every mutation and chat-dispatch affordance (analyze chips, add-to-watchlist, create-alert) disabled, following the existing WatchlistPage `readOnly` convention. Disabled affordances SHALL keep their visible labels and use neutral availability language (the existing neutral syncing/unavailable copy convention); the page SHALL NOT hide actions from followers.

#### Scenario: Follower window renders read-only

- **WHEN** a follower GUI window (another process holds the writer lock) opens `/symbol/NVDA`
- **THEN** the page renders all sections from polled/fetched read-only data
- **AND** analyze chips, add-to-watchlist, and create-alert controls are disabled but still visible with their labels and neutral availability copy
- **AND** no session is created and no writer lock is contested

#### Scenario: No model key configured

- **WHEN** model setup is incomplete and the user opens a symbol page
- **THEN** the page renders fully; only chat-dispatch affordances reflect the unavailable model per existing composer conventions

### Requirement: `GET /api/instruments/overview` serves memoized company overviews

The GUI server SHALL expose `GET /api/instruments/overview?symbol=` in gui/server/http-routes.ts, guarded by `allowTrustedGuiRequest` like the adjacent `/api/instruments/quote` and `/api/instruments/search` routes, creating no session. It SHALL wrap `getYahooCompanyOverview` (src/providers/yahoo-finance.ts:125) via `wrapProvider("yahoo", …)` and respond with `{symbol, status: "ok", name, description, exchange, sector, industry, marketCap, pe, forwardPe, eps, dividendYield, beta, avgVolume, profitMargin, revenueGrowth, week52High, week52Low, stale}` on success or `{symbol, status: "unavailable", reason}` on failure/missing symbol. The server SHALL front the provider with a per-symbol stale-while-revalidate memo (~5 minute TTL, at most one in-flight upstream fetch per symbol) modeled on `QuoteSnapshotStore` / `createSavedSymbolsMemo`, so repeated page opens within the TTL window cause at most one upstream Yahoo call per symbol.

#### Scenario: Successful overview fetch

- **WHEN** a trusted GUI request calls `/api/instruments/overview?symbol=aapl`
- **THEN** the response is `status: "ok"` with the fields above for `AAPL`, sourced through `wrapProvider("yahoo", …)`

#### Scenario: Memo coalesces concurrent and repeated requests

- **WHEN** several requests for the same symbol arrive concurrently and again within the TTL window
- **THEN** at most one upstream provider call is made; later requests within the TTL are served from the memo

#### Scenario: Untrusted request is rejected

- **WHEN** a request fails the trusted-GUI check
- **THEN** the route responds with the same rejection behavior as the other instrument routes and never calls the provider

#### Scenario: Unknown symbol

- **WHEN** the provider has no overview for the requested symbol
- **THEN** the response is `{symbol, status: "unavailable", reason}` with a non-empty reason

### Requirement: Instrument quote snapshot includes marketCap

`getInstrumentQuoteSnapshot` (gui/server/market-state-api.ts:482) SHALL include `marketCap` in its `status: "ok"` shape, sourced from the underlying `getQuote` result (`StockQuote.marketCap`, src/types/market.ts:12), which it currently drops. The addition SHALL be additive: all existing fields keep their names and semantics, and existing consumers of `/api/instruments/quote` remain unbroken.

#### Scenario: marketCap flows through

- **WHEN** `getQuote` returns a quote with a non-zero `marketCap`
- **THEN** the `/api/instruments/quote` response includes that `marketCap`

#### Scenario: Existing consumers unaffected

- **WHEN** existing quote-snapshot consumers (GUI header quote, tests) read the response
- **THEN** all previously present fields are unchanged in name and value

### Requirement: Symbol page sections derive user context from existing market state

The symbol page SHALL be composed by a `useSymbolData(ticker)` hook and render: a SymbolHeader (name, price, change, currency, market-state badge, and extended-hours line via `ExtendedHoursQuote` from gui/web/src/features/market-state/shared.jsx when the market is in an extended session); the `<MarketChart>` from the `market-chart` change; a KeyStats grid from the overview endpoint; a PositionCard; an AlertsCard; watchlist membership with an add-to-watchlist affordance; and an AnalyzePanel. Position, alert, and membership data SHALL be derived client-side by filtering `useMarketState()` state on the ticker using the existing view-model helpers (`buildHoldingRows`, alert-view-model) — the same pattern as `SymbolInspector` (WatchlistPage.jsx:421-437) — with no new server aggregation. KeyStats SHALL omit stats whose value is missing (`null` or provider-coerced `0` placeholders) rather than render zero placeholders.

#### Scenario: Symbol with saved position and alerts

- **WHEN** the user opens `/symbol/MSFT` while holding MSFT lots in a portfolio and having one MSFT alert rule
- **THEN** the PositionCard shows the holding row built by `buildHoldingRows` from polled state, and the AlertsCard shows the alert sentence rows for MSFT's instrument
- **AND** no additional server endpoint is called for position or alert data

#### Scenario: Symbol with no saved context

- **WHEN** the opened symbol appears in no watchlist, portfolio, or alert
- **THEN** position/alerts/membership sections render empty states and the quote header still renders from `/api/instruments/quote`

#### Scenario: Missing stat is omitted

- **WHEN** the overview reports `pe: null` or `marketCap: 0`
- **THEN** the KeyStats grid omits those stats instead of rendering "$0.00" or "0"

### Requirement: The symbol page follows the GUI design system's hierarchy, semantics, and interaction rules

The symbol page SHALL render inside a `main` landmark whose single `h1` is the company name plus symbol, with each section (chart, key stats, position, alerts, analyze) a labeled group, in the fixed top-to-bottom order: header → chart → key stats → position → alerts → analyze panel; on mobile the page SHALL be a single column in that same order. The document body SHALL never scroll horizontally: wide content SHALL scroll inside its own container. The header SHALL present the price as the dominant element with a direction-colored change chip that carries an arrow icon plus the signed change value, so direction is never conveyed by color alone; the extended-hours line SHALL be rendered by the unmodified `ExtendedHoursQuote` component. The KeyStats grid SHALL use definition-list semantics (`dl`/`dt`/`dd`, matching the existing mobile portfolio summary) with values right-aligned. Every dynamic numeral (price, change, stats, position P&L) SHALL be set in tabular numerals (`tabular-nums`), and money/percent values SHALL be formatted with the shared `money`/`moneyOrDash`/`SignedPercent` helpers, never ad-hoc `toFixed`. Analyze chips and action buttons SHALL have a hit area of at least 40x40px, and every navigation entry point on the page SHALL be a real link or button reachable by keyboard with the ui primitives' focus-visible ring.

#### Scenario: Direction is not color-only

- **WHEN** the header renders a negative daily change
- **THEN** the change chip shows a downward arrow icon and the signed value (e.g. "-1.23 (-0.84%)") in addition to the danger color

#### Scenario: Stat grid uses definition-list semantics

- **WHEN** the KeyStats grid renders
- **THEN** its markup is a `dl` whose labels are `dt` elements and values are `dd` elements in tabular numerals

#### Scenario: Mobile layout has no horizontal overflow

- **WHEN** the page renders at a 390px-wide viewport
- **THEN** all sections stack in a single column in header → chart → stats → position → alerts → analyze order and the document body has no horizontal scrollbar

### Requirement: Loading, refresh, and staleness states reuse existing market-state conventions

On first load, the symbol page SHALL render `Skeleton` placeholder blocks sized to the final header, chart, and stats section heights, with no enter animations on initial paint and no layout jump when data replaces them. When a background quote refresh changes the displayed price, the page SHALL reuse the existing `useQuoteChangeFlash` + `quoteFlashClass` green/red tint flash, which is suppressed under `prefers-reduced-motion`. Quote staleness SHALL be announced only via the existing `degradedQuoteBadge` convention ("Quotes Nm old" amber badge or "As of <date>"); the page SHALL NOT introduce a new staleness indicator and SHALL show no badge while quotes are fresh.

#### Scenario: First load shows skeletons

- **WHEN** the page mounts before quote/overview/history responses arrive
- **THEN** skeleton blocks render for the header, chart, and stats sections and are replaced in place when data lands

#### Scenario: Background refresh flashes via the existing helper

- **WHEN** a polled quote refresh changes the price
- **THEN** the price row applies `quoteFlashClass` for the change direction and applies no tint when the user prefers reduced motion

#### Scenario: Stale quotes reuse the existing badge

- **WHEN** the quote snapshot is degraded per `degradedQuoteBadge`
- **THEN** the page shows that badge's text ("Quotes Nm old" or "As of <date>") and no other staleness indicator

### Requirement: Analyze chips dispatch through the routed chat-run entry for writers

The AnalyzePanel SHALL present symbol-templated `[label, prompt]` chips following the home-prompts.js `DEFAULT_PROMPTS` pattern, including at minimum a quote chip, an options-chain chip, and a `/analyze ${ticker}` deep-research chip whose label identifies it as the longer multi-analyst run. Chips SHALL dispatch through `startRoutedChatRun` (App.jsx:243), which AppShell SHALL pass to SymbolPage along with `navigate`, `invokeTool`, `role`, and `setToast` (it is not currently passed to MarketStatePage). For writers, a dispatched chip results in a fresh session run whose `run.started` handler navigates to `/sessions/$sessionId`; for followers, chips SHALL be disabled. Add-to-watchlist and create-alert affordances SHALL reuse `invokeTool("manage_watchlist", …)` / `invokeTool("manage_alerts", …)` and SHALL be writer-only.

#### Scenario: Writer clicks an analyze chip

- **WHEN** a writer clicks the "Deep research" chip on `/symbol/NVDA`
- **THEN** `startRoutedChatRun` is called with `/analyze NVDA` and the GUI navigates to the new session when the run starts

#### Scenario: Follower sees disabled affordances

- **WHEN** a follower views the AnalyzePanel
- **THEN** every chip and mutation control is disabled and no chat run or tool invocation can be dispatched

#### Scenario: Add to watchlist uses the existing tool path

- **WHEN** a writer uses the add-to-watchlist affordance
- **THEN** the mutation goes through `invokeTool("manage_watchlist", …)` and the page reflects membership after the acknowledged result, per existing market-state mutation conventions

### Requirement: Non-equity symbols render without company-overview sections

For symbols classified as non-equity by src/market-state/resolve.ts asset-type rules (`-USD` suffix → crypto, `^` prefix → index; resolve.ts:99-100) — or whenever the overview endpoint returns `status: "unavailable"` — the symbol page SHALL render the quote header and chart only, hiding the KeyStats/overview-derived sections entirely. The page SHALL never render placeholder-zero fundamentals (e.g. "$0.00 P/E") for any asset type.

#### Scenario: Crypto symbol

- **WHEN** the user opens `/symbol/BTC-USD`
- **THEN** the header quote and chart render, and no KeyStats/company-overview section renders

#### Scenario: Index symbol

- **WHEN** the user opens `/symbol/^GSPC`
- **THEN** the header quote and chart render without company-overview sections

### Requirement: Unavailable symbols get a clean not-found state

When both `GET /api/instruments/quote` and `GET /api/instruments/overview` return `{status: "unavailable", reason}` for the requested ticker, the symbol page SHALL render a clean not-found state naming the symbol, instead of empty or zero-filled sections, while keeping the app shell (sidebar, navigation) usable.

#### Scenario: Nonexistent ticker

- **WHEN** the user opens `/symbol/ZZZZZZ` and both endpoints report unavailable
- **THEN** the page shows a not-found state for `ZZZZZZ` with no quote, chart, or stats sections rendered as if data existed

### Requirement: Existing symbol surfaces link to the symbol page

The GUI SHALL add navigation entry points to `/symbol/$ticker` without removing existing affordances: (1) WatchlistPage QuoteBoard symbol cells become links (the inline inspector stays); (2) PortfolioPage symbol cells become links; (3) the cashtag entity popover (gui/web/src/features/chat/entity-popover.jsx) gains an "Open $X page" action beside the existing "Ask about $X"; (4) `SymbolInspector` gains an "Open full page" link; (5) selecting an instrument-search candidate (`SymbolSearchInput` in gui/web/src/features/market-state/MarketStatePage.jsx, backed by gui/web/src/features/instruments/use-instrument-search.js) SHALL be able to navigate to the symbol's page. Links SHALL URL-encode the ticker segment so that `^GSPC` produces the href `/symbol/%5EGSPC`.

#### Scenario: Watchlist symbol cell navigates

- **WHEN** the user clicks a ticker in the watchlist quote board
- **THEN** the GUI navigates to that symbol's page, and the inline inspector affordance still exists

#### Scenario: Entity popover offers the page

- **WHEN** the user opens a cashtag popover for `$TSLA` in chat
- **THEN** an "Open $TSLA page" action navigates to `/symbol/TSLA` alongside the existing "Ask about $TSLA" action

#### Scenario: Index ticker link is encoded

- **WHEN** a linked surface points at `^GSPC`
- **THEN** the generated href is `/symbol/%5EGSPC` and resolves back to `^GSPC` on the page
