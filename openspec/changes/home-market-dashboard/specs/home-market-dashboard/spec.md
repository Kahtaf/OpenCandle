# Home Market Dashboard

## ADDED Requirements

### Requirement: Dashboard renders as the `/` empty state and yields to the transcript

The GUI home dashboard SHALL render inside `ChatPanel`'s existing empty-thread branch — the branch currently guarded by `isEmptyThread` (`gui/web/src/features/chat/ChatPanel.jsx:247-248`: `!needsSetup && !sessionLoading && visibleRows.length === 0 && !activity && !hasAskUserPrompts`) — replacing/extending `EmptyThread` from `gui/web/src/components/chat/prompt-suggestions.jsx`. It SHALL NOT be a new route and SHALL NOT be an overlay. Layout: heading + composer on top, widget grid below; at the `lg` breakpoint and above the grid SHALL use two columns with the indices strip spanning the full grid width, and below `lg` the widgets SHALL stack in a single column below the composer. When the session gains content (any condition of `isEmptyThread` flips), the normal transcript rendering SHALL take over unchanged, with no dashboard remnants.

#### Scenario: Fresh home shows the dashboard

- **WHEN** the user opens `/` with model setup ready, no session rows, no activity, and no pending ask-user prompts
- **THEN** the dashboard renders: heading and composer first, widget grid below

#### Scenario: Transcript takeover on first run

- **WHEN** a prompt is submitted from home and the run produces visible rows or activity
- **THEN** the dashboard disappears and the existing transcript rendering takes over with no dashboard elements remaining

#### Scenario: No new route

- **WHEN** the dashboard is visible
- **THEN** the browser location is `/` — no `/home` route or overlay layer exists

### Requirement: Composer stays primary and the fresh-session run flow is unchanged

The composer SHALL remain the primary action: heading + composer render above the widget grid on all breakpoints, and no widget renders above the composer. All widget CTAs (row clicks, suggestion chips, affordance cards) SHALL reuse the existing lifted composer handlers (`draft`/`setDraft` and the ChatPanel submit handler) — no parallel run path. The home submit flow SHALL remain exactly: submit → `startChatRun` → `App.jsx` `startRoutedChatRun` (line 243) → `chatRunSessionTarget({pathname: "/", canStartFreshHomeSession: role === "writer"})` → mode `"fresh"` → `gui.newSession()` → `chatRun.startChatRun(prompt, {sessionId, baseEventCount: 0})`, retrying exactly once on `result.sessionChanged` (the 409 `session_changed` guard, `App.jsx:268-288`), adopting the session and navigating to `/sessions/$id` on `run.started`.

#### Scenario: Home submit with dashboard present uses the fresh-session flow

- **WHEN** the user submits a prompt from the dashboard's composer
- **THEN** the run starts through `startRoutedChatRun` with a fresh home session target, retries once on `session_changed`, and navigates to the adopted session on `run.started` — identical to pre-dashboard behavior

#### Scenario: Widget CTA does not start its own run

- **WHEN** any dashboard widget element is clicked
- **THEN** it either prefills the composer draft via `setDraft` or navigates to an existing route — it never calls a chat-run API directly

### Requirement: Model-setup gating keeps precedence over the dashboard

When `needsSetup` (`modelSetup.requirement !== "ready"`, `ChatPanel.jsx:183`), `ModelSetupCard` SHALL render first, exactly as today (the branch at `ChatPanel.jsx:305-316`), and submit SHALL remain blocked with the existing toast (`ChatPanel.jsx:195`) while the composer stays draftable. The dashboard SHALL NOT hide, replace, or push the setup card below widget content. Read-only widgets MAY render below the setup card, but sending stays blocked (`chatDisabled`) regardless of any widget interaction.

#### Scenario: needsSetup shows the setup card first

- **WHEN** model setup is not ready and the user opens `/`
- **THEN** `ModelSetupCard` renders in first position; the composer accepts a draft but send is blocked

#### Scenario: Widget prefill under needsSetup does not enable send

- **WHEN** model setup is not ready and a rendered widget row prefills the composer
- **THEN** the draft updates but submit remains blocked with the existing setup toast

### Requirement: Market indices endpoint serves a fixed symbol set

The GUI server SHALL expose `GET /api/market-state/indices` returning quote + sparkline data for exactly the fixed symbol set `^GSPC`, `^IXIC`, `^DJI`, `BTC-USD` (no query parameter SHALL alter the set). The response SHALL be a JSON object of the shape:

```
{
  generatedAt: string,           // ISO timestamp of snapshot assembly
  indices: Array<{
    symbol: string,              // one of the four fixed symbols
    name?: string,
    status: "ok" | "unavailable",
    reason?: string,             // present when status is "unavailable"
    price?: number,
    change?: number,
    changePercent?: number,
    currency?: string | null,    // null is expected for ^-prefixed symbols
    marketState?: "PRE" | "REGULAR" | "POST" | "CLOSED",
    dataAsOf?: string,
    stale?: boolean,
    sparkline?: MarketSparklineSnapshot  // same shape as watchlistQuotes[].sparkline
  }>
}
```

The `indices` array SHALL always contain exactly four entries (one per fixed symbol, in the order above). The endpoint SHALL fetch through the same `fetchQuoteSnapshot`/`fetchSparklineSnapshot` helpers used by the existing market-state quote snapshot (`gui/server/market-state-api.ts:535`/`:425`), backed by its own stale-while-revalidate store with the same semantics as `QuoteSnapshotStore` (`gui/server/quote-snapshot-store.ts`): fresh data served from cache within the freshness window; a stale snapshot served immediately while a background refresh runs. The route SHALL register in `gui/server/http-routes.ts` alongside `/api/market-state` and `/api/market-state/quotes` (`http-routes.ts:214`, `:220`), SHALL be guarded by `allowTrustedGuiRequest` with the same "Market-state API" label, and SHALL be follower-safe: it is a pure read that follower processes can poll identically to writers. Per-symbol failures SHALL be reported as `status: "unavailable"` on that entry (with the other symbols still returned as `status: "ok"`), not as a whole-response error.

#### Scenario: Trusted request returns the fixed set

- **WHEN** a trusted GUI browser session requests `GET /api/market-state/indices`
- **THEN** the response contains entries for ^GSPC, ^IXIC, ^DJI, and BTC-USD with price, change, changePercent, and sparkline data where available

#### Scenario: Untrusted request is rejected

- **WHEN** a request without a trusted GUI browser session calls the endpoint
- **THEN** it is rejected by the same `allowTrustedGuiRequest` guard behavior as the existing private market-state APIs

#### Scenario: Partial provider failure degrades per symbol

- **WHEN** the provider returns data for three symbols and fails for one
- **THEN** the response includes the three available quotes and marks the fourth unavailable, without failing the request

#### Scenario: SWR store absorbs polling load

- **WHEN** multiple GUI windows poll the endpoint within the freshness window
- **THEN** they are served from the shared snapshot without additional provider fetches

### Requirement: Indices strip renders universally and hides gracefully when unavailable

The dashboard SHALL render a market indices + crypto strip from `GET /api/market-state/indices` for all users, including users with no saved state. Each available symbol SHALL render as a compact tile showing the symbol, last price, signed percent change, and a sparkline rendered via the existing `gui/web/src/components/market-sparkline.jsx` component; sparklines SHALL have no axes and no legend. Because runtime behavior of Yahoo quotes for `^`-prefixed symbols is unvalidated (`currency: null` and differing `marketState` are possible even though `getQuote` works via the chart endpoint and `src/market-state/resolve.ts:100` classifies `^…` as index), the strip SHALL hide gracefully — no error banner, no layout gap requiring user action — when the endpoint or all of its symbols are unavailable. Tiles with `currency: null` SHALL render without a broken currency label.

#### Scenario: Indices render for a brand-new user

- **WHEN** a user with no watchlists or portfolios opens `/`
- **THEN** the indices strip renders with live values for the available fixed symbols

#### Scenario: Endpoint unavailable hides the strip

- **WHEN** the indices endpoint errors or returns no available symbols
- **THEN** the strip is not rendered and the rest of the dashboard lays out without a hole or error banner

### Requirement: Watchlist movers widget sorts by absolute change with sparklines

The dashboard SHALL render watchlist movers from `quoteSnapshot.watchlistQuotes` (the existing `/api/market-state/quotes` SWR snapshot already polled by `useMarketState()` in ChatPanel), sorted descending by `abs(changePercent)` with rows missing `changePercent` sorted last. Each row SHALL present, in order: symbol, sparkline (each row's `sparkline` via the existing `gui/web/src/components/market-sparkline.jsx` component), price, and a delta chip; change coloring SHALL come from `gui/web/src/features/market-state/format.js` `quoteChangeDirections`. The widget SHALL show at most 5 rows and, when more symbols exist, a "View all" link to `/watchlists`. This widget SHALL be pure frontend — no new server surface. When the user has watchlist symbols but the quote snapshot has not arrived yet, the widget SHALL render skeleton rows (`gui/web/src/components/ui/skeleton.jsx`); when the snapshot is stale, the existing stale-quote disclosure semantics apply; when the user has no watchlist symbols, the widget renders its empty state (or is replaced by the new-user affordance cards).

#### Scenario: Movers sorted by absolute change

- **WHEN** watchlistQuotes contains symbols with changePercent values +0.5, -3.2, and +1.4
- **THEN** the movers list orders them -3.2, +1.4, +0.5

#### Scenario: Skeleton before first snapshot

- **WHEN** the user has watchlist symbols and the first quotes snapshot has not loaded
- **THEN** the movers widget renders skeleton rows, not an empty or error state

#### Scenario: Row cap with View all

- **WHEN** watchlistQuotes contains 8 symbols
- **THEN** the movers widget shows the top 5 by absolute change and a "View all" link to `/watchlists`

### Requirement: Portfolio summary strip derives day move client-side

The dashboard SHALL render a portfolio summary strip from `quoteSnapshot.portfolioSummaries` (type at `gui/server/market-state-api.ts:106-114`, assembled at `:292`: totalValue, totalCost, totalPnl, totalPnlPercent). The strip SHALL be a stat-tile row, not a chart: the total value renders as the hero number in tabular numerals, with today's move and all-time P&L as delta chips (arrow or sign plus signed value — direction never conveyed by color alone). Because the summary carries no intraday "today P&L", the day move SHALL be derived client-side from `portfolioQuotes` per-lot data — for each lot with numeric `marketValue` and `changePercent`, `marketValue - marketValue / (1 + changePercent / 100)`, summed — mirroring the existing `ValueHeader` math in `gui/web/src/features/market-state/PortfolioPage.jsx:547-559`, implemented as a shared pure function used by both surfaces (not a second copy). Lots whose quote lacks a numeric `changePercent` or `marketValue` SHALL be excluded from the day-move sum rather than treated as zero-change certainty; if no lot has usable data, the day move renders as unavailable, not $0.00.

#### Scenario: Day move matches the portfolio page

- **WHEN** the same portfolio quotes are shown on the home strip and the portfolio page ValueHeader
- **THEN** both display the same derived day-move value from the shared function

#### Scenario: Missing per-lot data degrades honestly

- **WHEN** no portfolio lot has a usable changePercent
- **THEN** the day move renders as unavailable rather than a fabricated $0.00

#### Scenario: No portfolios

- **WHEN** the user has no saved portfolios
- **THEN** the strip renders its empty state (or the new-user affordance card) instead of zeros

### Requirement: Alerts card renders from existing market-state snapshot data

The dashboard SHALL render an alerts/notifications card from the `/api/market-state` snapshot fields `alerts`, `alertEvents`, and `notifications`, shaped through the existing `alert-view-model.js` — pure frontend, no new server surface, no new mutation affordances beyond navigation to the existing alerts page.

#### Scenario: Recent alert events surface

- **WHEN** the market-state snapshot contains alert rules and recent alert events
- **THEN** the card shows them shaped by the existing alert view model, with a link to the alerts page

#### Scenario: No alerts configured

- **WHEN** the snapshot has no alerts
- **THEN** the card renders an empty state pointing at alert creation, without fabricating status

### Requirement: Suggestion chips reuse the existing home-prompts source

The dashboard SHALL render suggestion chips from the existing `home-prompts.js` output (`homePromptsForMarketState()` / `DEFAULT_PROMPTS`) already computed in ChatPanel (`ChatPanel.jsx:249`). Chip click SHALL use the existing prompt-submission/prefill behavior; no new prompt source is introduced.

#### Scenario: Personalized chips with saved state

- **WHEN** the user has saved watchlists/portfolios
- **THEN** chips come from `homePromptsForMarketState()` exactly as today

#### Scenario: Default chips without saved state

- **WHEN** the user has no saved state
- **THEN** `DEFAULT_PROMPTS` chips render

### Requirement: New-user empty state offers universal content plus affordance cards

For a user with no saved market state, the dashboard SHALL render: the heading ("What are we watching?"), the composer, `DEFAULT_PROMPTS` chips, the indices strip (universal — no saved state required), and affordance cards "Add a watchlist" linking to `/watchlists` and "Track a portfolio" linking to `/portfolios`. Saved-state widgets render their empty states or are replaced by these affordance cards; the first `/api/market-state/quotes` response being empty or stale SHALL surface as skeleton/stale handling, never as an error.

#### Scenario: Brand-new user sees a useful home

- **WHEN** a new user with zero saved state opens `/`
- **THEN** they see the heading, composer, default chips, the indices strip, and the two affordance cards linking to /watchlists and /portfolios

### Requirement: Widget row click prefills the composer, upgrading to symbol-page links when available

Clicking a movers or indices row SHALL prefill the composer draft with `$SYMBOL ` (trailing space) via the existing `setDraft`/`askAboutSymbol` pattern (`ChatPanel.jsx:145-158`) and focus the composer. CONDITIONAL UPGRADE: if the `symbol-page` change's `/symbol/$ticker` route exists in `gui/web/src/router.jsx` at implementation time, row clicks SHALL navigate there instead of prefilling; otherwise prefill is the shipped behavior. Implementers SHALL check `gui/web/src/router.jsx` for the route's existence rather than assuming either state.

#### Scenario: Prefill when no symbol page exists

- **WHEN** the `/symbol/$ticker` route does not exist and the user clicks the NVDA movers row
- **THEN** the composer draft becomes `$NVDA ` and the composer is focused; no run starts

#### Scenario: Deep link when the symbol page exists

- **WHEN** the `/symbol/$ticker` route exists and the user clicks the NVDA movers row
- **THEN** the app navigates to `/symbol/NVDA`

### Requirement: Dashboard presentation follows the existing design system

Dashboard widgets SHALL reuse the existing design system with no new CSS system or primitive set: widget cards use `Panel` from `gui/web/src/features/market-state/shared.jsx:47`, controls use `gui/web/src/components/ui/` primitives, and stat tiles/delta chips reuse the `MoneyTile`/`DeltaChip` patterns (`gui/web/src/features/renderers/cards/_shared.jsx:46`/`:82`) or the `ValueHeader` idiom rather than a new tile system. Every dynamic numeral (prices, percentages, totals) SHALL use tabular numerals (`tabular-nums`) so a quote refresh does not shift layout, and the hero heading SHALL use `text-balance`. On first paint, loading widgets SHALL render `Skeleton` blocks sized to the final widget heights and SHALL NOT play enter or stagger animations; background quote refreshes MAY reuse the existing green/red price-flash (`quoteFlashClass`/`useQuoteFlashDirections`, `shared.jsx:286-292`), which SHALL keep its reduced-motion suppression. Interactive widget rows and CTAs SHALL have hit areas of at least 40x40px and SHALL use scoped transition properties (never `transition: all`). Widget data recency SHALL surface only through the existing freshness conventions (amber "Quotes Nm old" badge only when degraded; silent while fresh; "As of <date>" for prior-day data) — no new freshness indicator styles.

#### Scenario: Quote refresh does not shift layout

- **WHEN** a background quote refresh changes prices in the movers or indices widgets
- **THEN** the numerals re-render in tabular figures with no change to row or column dimensions

#### Scenario: Initial load shows sized skeletons without animation

- **WHEN** the dashboard first paints before widget data arrives
- **THEN** skeleton blocks occupy the final widget heights and no enter/stagger animation plays on the widgets

#### Scenario: Freshness uses existing conventions

- **WHEN** widget quote data is fresh
- **THEN** no freshness badge renders; a badge appears only when the data is degraded, using the existing "Quotes Nm old" / "As of <date>" semantics

### Requirement: Dashboard widgets are accessible labeled regions

Each dashboard widget SHALL be a labeled region whose container is associated with its visible heading via `aria-labelledby`. Movers and indices rows SHALL be real links or buttons (keyboard focusable, activatable with Enter/Space) with visible `focus-visible` rings. Sparklines SHALL keep the existing `aria-label` from `gui/web/src/components/market-sparkline.jsx:35`. Direction and state SHALL never be conveyed by color alone: delta chips pair color with an arrow or sign, and the alerts card pairs color with icon + text.

#### Scenario: Widget regions are labeled

- **WHEN** the dashboard renders with assistive technology
- **THEN** each widget exposes a region labeled by its heading, and every movers/indices row is reachable and activatable by keyboard with a visible focus ring

#### Scenario: State is not color-only

- **WHEN** a delta chip or alert status renders
- **THEN** its direction/state is readable without color (arrow or sign on chips; icon + text on the alerts card)

### Requirement: Follower windows render the dashboard read-only correctly

Follower GUI processes (non-writer per the writer-lock model) SHALL render the same dashboard from the same read APIs (`/api/market-state`, `/api/market-state/quotes`, `/api/market-state/indices`). All v1 widget interactions (prefill, navigation) work identically for followers; the dashboard SHALL NOT add any writer-only mutation affordance, and follower submit behavior remains whatever the existing composer/session-target logic dictates (`canStartFreshHomeSession: role === "writer"`).

#### Scenario: Follower sees live widgets

- **WHEN** a follower window opens `/`
- **THEN** all widgets render with the same data as the writer window and row clicks prefill/navigate normally

### Requirement: Per-session projector dashboard fields are not bound on home

The home dashboard SHALL NOT render widgets bound to `visibleDashboard.activeAnalyses` or `visibleDashboard.recentResearch`. `projectDashboard` runs over one session's entries and `/` starts a fresh session, so these fields are always empty on home (population paths: `opencandle-workflow` entries at `src/pi/opencandle-extension.ts:90`, `opencandle-analyst-step` counting at `src/runtime/session-coordinator.ts:916/930/944`, recent-research shift at `gui/server/projector.ts:227-237`). Cross-session aggregation is explicitly deferred to a follow-up change; binding these fields in v1 would ship permanently empty, misleading widgets.

#### Scenario: No research widgets on home

- **WHEN** the dashboard renders, even for a user who ran `/analyze` in other sessions
- **THEN** no "recent research" or "active analyses" widget appears, and no component reads `activeAnalyses`/`recentResearch` from the home session's dashboard state
