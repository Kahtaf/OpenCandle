# Design: Home Market Dashboard

## Context

All facts below were verified by a completed spike; treat the file:line references as trusted.

**Where home renders today.** `gui/web/src/features/chat/ChatPanel.jsx` renders `EmptyThread` (from `gui/web/src/components/chat/prompt-suggestions.jsx`) when `isEmptyThread` is true — `ChatPanel.jsx:247-248`: `!needsSetup && !sessionLoading && visibleRows.length === 0 && !activity && !hasAskUserPrompts`. The dashboard replaces/extends this empty-thread branch: heading + composer on top, widget grid below. When the session gains content, the normal transcript branch takes over unchanged.

**Composer flow that must not regress.** `EmptyThread`'s `onPrompt` = ChatPanel submit → `startChatRun` → `App.jsx` `startRoutedChatRun` (line 243): `chatRunSessionTarget({pathname: "/", canStartFreshHomeSession: role === "writer"})` → mode `"fresh"` → `gui.newSession()` → `chatRun.startChatRun(prompt, {sessionId, baseEventCount: 0})`, retrying ONCE on `result.sessionChanged` (the 409 `session_changed` guard, `App.jsx:268-288`); on `run.started` the `onEvent` handler adopts the session and navigates to `/sessions/$id`. Composer draft state is lifted (`draft`/`setDraft`; the catalog prefills it).

**Model-setup gating that must not regress.** `needsSetup = modelSetup?.requirement && modelSetup.requirement !== "ready"` (`ChatPanel.jsx:183`). When `needsSetup`, ChatPanel renders `ModelSetupCard` INSTEAD of the empty thread (the `needsSetup ? … : sessionLoading ? … : isEmptyThread ? …` ternary at `ChatPanel.jsx:305-316`) and submit blocks with a toast (`ChatPanel.jsx:195`); the composer stays draftable, send is blocked (`chatDisabled`, `ChatPanel.jsx:187`).

**Data already available in ChatPanel.**
1. `useMarketState()` is already called in ChatPanel (`ChatPanel.jsx:77`) — `/api/market-state` (4s poll, `MARKET_STATE_POLL_MS` at `gui/web/src/hooks/useMarketState.jsx:3`; structural: watchlists, portfolios, alerts, alertEvents, notifications) + `/api/market-state/quotes` (5-minute poll, `QUOTE_REFRESH_INTERVAL_MS` at `useMarketState.jsx:4`; served server-side from the `QuoteSnapshotStore` SWR store in `gui/server/quote-snapshot-store.ts` with a 60s default freshness window). Snapshot shape (`MarketStateQuoteSnapshot`, `gui/server/market-state-api.ts:42-114`): `watchlistQuotes[]` with price/change/changePercent/marketState/extended/sparkline; `portfolioSummaries[]` with totalValue/totalCost/totalPnl/totalPnlPercent (type at `market-state-api.ts:106-114`, assembled at `market-state-api.ts:292`); `portfolioQuotes[]` with per-lot `marketValue`/`changePercent`.
2. `visibleDashboard` prop (`DashboardState` from the projector via ws-hub `state.snapshot` / `/api/bootstrap`).

**Projector trap (hard constraint).** `projectDashboard` runs over ONE session's entries, and `/` starts a FRESH session, so `dashboard.activeAnalyses` and `dashboard.recentResearch` are ALWAYS EMPTY on home. Verified population paths: `activeAnalyses` from `opencandle-workflow` entries (`src/pi/opencandle-extension.ts:90`), `analystsDone` from `opencandle-analyst-step` (`src/runtime/session-coordinator.ts:916/930/944`), `recentResearch` shifted on assistant stop (`gui/server/projector.ts:227-237`). Cross-session widgets need new server-side aggregation and are deferred to a follow-up change.

**Quote-poller limitation.** `buildMarketStateQuoteSnapshot` iterates saved watchlist/portfolio symbols only, so index symbols (^GSPC etc.) never enter the existing snapshot. This is why the indices strip is the one v1 server extension.

## Goals / Non-Goals

**Goals:**
- Turn the `/` empty state into a market-workbench dashboard: composer primary, widget grid below (indices strip, watchlist movers with sparklines, portfolio summary strip, alerts card, suggestion chips, new-user affordance cards).
- Preserve the composer fresh-session/409-retry flow and model-setup gating byte-for-byte in behavior.
- One narrow server extension: `GET /api/market-state/indices` for a fixed symbol set.
- Sensible empty/stale/skeleton states for every widget; follower windows render read-only correctly.

**Non-Goals:**
- News anywhere; a new route or overlay; new WebSocket channels; changing session routing; bypassing model-setup gating; mutating market state from the dashboard beyond existing tool-invoke paths; cross-session recent-research/active-analyses widgets (deferred, need server aggregation); per-widget deep charts.

## Decisions

### D1: Dashboard is the empty-state branch of `/`, not a route or overlay

The dashboard renders inside ChatPanel's existing `isEmptyThread` branch, extending/replacing `EmptyThread`. Alternatives rejected: a `/home` route would fork session-target logic (`chatRunSessionTarget` keys off `pathname: "/"`) and break the "type anywhere and a session starts" flow; an overlay would fight the transcript's takeover when the session gains content. With the empty-state approach, the transition to a live transcript is the existing condition flipping — zero new state machines.

### D2: Widget CTAs reuse the lifted composer handlers — no parallel run path

Row clicks and suggestion chips call the existing `setDraft` (composer prefill, following the `askAboutSymbol` pattern at `ChatPanel.jsx:145`) or the existing submit handler. Alternative rejected: widgets calling `startChatRun` directly would duplicate the fresh-session/409-retry/adoption logic in `App.jsx:243-288` and inevitably drift. Reusing the handlers means the flow literally cannot regress from the dashboard side.

### D3: Model-setup precedence is unchanged; widgets are read-only under `needsSetup`

When `needsSetup`, `ModelSetupCard` renders first exactly as today (`ChatPanel.jsx:305-316`). Read-only widgets MAY render below it (they need no model), but send stays blocked and the setup card is never hidden or pushed below the fold by widgets. Simplest compliant v1: keep the current behavior (setup card instead of the empty thread) and only add widgets to the non-`needsSetup` branch; rendering read-only widgets under the card is an allowed enhancement, not a requirement.

### D4: Indices via a new `GET /api/market-state/indices` endpoint with its own SWR store

Fixed symbol set: `^GSPC`, `^IXIC`, `^DJI`, `BTC-USD`. Served through the same `fetchQuoteSnapshot`/`fetchSparklineSnapshot` helpers the watchlist snapshot uses (`gui/server/market-state-api.ts:535` / `:425`), with its own stale-while-revalidate store reusing the `QuoteSnapshotStore` semantics (`gui/server/quote-snapshot-store.ts`, 60s default freshness window). The route registers in `gui/server/http-routes.ts` alongside the existing `/api/market-state` and `/api/market-state/quotes` routes (`http-routes.ts:214`, `:220`), guarded by `allowTrustedGuiRequest` with the same "Market-state API" label, follower-safe (read path only — followers poll it exactly like writers). The response shape is specified once, in the spec's "Market indices endpoint" requirement; the client polls at the existing `QUOTE_REFRESH_INTERVAL_MS` (5-minute) cadence. Alternatives rejected: (a) injecting index symbols into `buildMarketStateQuoteSnapshot` would entangle a universal, saved-state-independent concern with per-user saved symbols and pollute `watchlistQuotes` consumers; (b) a client-side direct Yahoo fetch violates the provider/infra boundary (all external calls go through `cache`/`rateLimiter` server-side); (c) a WebSocket push channel is an explicit non-goal.

Known risk on `^`-prefixed symbols (currency `null`, differing `marketState`) is handled by an implementation-first live verification spike; the strip hides gracefully when the endpoint reports unavailable (see R1).

### D5: Portfolio day-move is derived client-side, mirroring `ValueHeader`

`portfolioSummaries` has no intraday "today P&L". Derive the day move client-side from `portfolioQuotes` per-lot data, mirroring the existing `ValueHeader` math in `gui/web/src/features/market-state/PortfolioPage.jsx:547-559`: for each lot with numeric `marketValue` and `changePercent`, add `marketValue - marketValue / (1 + changePercent / 100)`; if no lot qualifies, return `null` (unavailable), never 0. Extract/reuse as a small pure function in a view-model module (`gui/web/src/features/market-state/portfolio-view-model.js` or a sibling) so both pages share one implementation and it is unit-testable. Alternative rejected: adding a server-side field to the quote snapshot is unnecessary surface for a value the client can already compute from shipped data.

### D6: v1 does NOT bind `dashboard.activeAnalyses` / `dashboard.recentResearch`

Per the projector trap in Context, these fields are structurally always empty on home. Binding them would render permanently empty widgets that mislead users into thinking they have no research history. This is encoded as a spec requirement, not just guidance, so a later implementer cannot "helpfully" wire them up.

### D7: Movers/indices click behavior is conditional on `symbol-page`

v1 default: row click prefills the composer with `$SYMBOL ` via `setDraft` (the `askAboutSymbol` pattern, `ChatPanel.jsx:145-158`, which also focuses `#chat-composer`). If the parallel `symbol-page` change has landed at implementation time (its `/symbol/$ticker` route exists in `gui/web/src/router.jsx`), rows link there instead. Written as an explicit conditional task so a weaker implementing agent checks the route's existence rather than guessing.

### D8: Reuse the existing design system wholesale

`Panel` from `gui/web/src/features/market-state/shared.jsx:47` (rounded-xl card), `gui/web/src/components/ui/` primitives (`button.jsx`, `skeleton.jsx`), `gui/web/src/components/market-sparkline.jsx` for sparklines, `quoteChangeDirections` from `gui/web/src/features/market-state/format.js:62`, `portfolio-view-model.js`/`alert-view-model.js` for shaping, `MoneyTile`/`DeltaChip` from `gui/web/src/features/renderers/cards/_shared.jsx:46`/`:82` for stat tiles and delta chips. Mobile: single column stacked below the composer, reusing `MobileHeader` (`gui/web/src/features/layout/AppShellChrome.jsx:15`). Reduced motion respected via the existing `useQuoteFlashDirections`/`quoteFlashClass` flash pattern (`shared.jsx:286-292`, `motion-reduce:` suppression). New widget components live under a new `gui/web/src/features/home/` directory. No new CSS system, no new primitives.

## UI/UX guidance

Anchor: OpenCandle's design language is minimal shadcn per `DESIGN.md` — Inter everywhere, zinc neutrals, ink `#18181B`, success `#1A9948`, danger `#EF4343`, radii sm 6px / md 8px / lg 12px (`DESIGN.md` `rounded:` tokens). The existing home empty state (CHANGELOG 0.12.0) centers hero + suggestions + composer as one block — the dashboard extends this; it does not replace the composer-first identity.

### Layout and hierarchy (dataviz "is it even a chart?" discipline)

- **Portfolio summary strip is a stat-tile row, not a chart**: total value large in tabular-nums (hero number), today's move and all-time P&L as delta chips (arrow icon + signed value — direction is never conveyed by color alone). Reuse the `MoneyTile`/`DeltaChip` patterns (`gui/web/src/features/renderers/cards/_shared.jsx:46`/`:82`) or the `PortfolioPage.jsx` `ValueHeader` idiom (`:547`) — do not build a new tile system.
- **Indices strip**: compact tiles (symbol, last price, signed %, sparkline) mirroring the watchlist-row sparkline treatment (`gui/web/src/components/market-sparkline.jsx`); sparklines stay minimal — no axes, no legend, direction color only.
- **Movers list**: rows of symbol → sparkline → price → delta chip, sorted by `abs(changePercent)` descending; visible rows capped at 5 with a "View all" link to `/watchlists` so home stays one scannable screen.
- **Grid**: composer + heading remain the visual primary (top, centered as today); widgets render below in a responsive grid — two columns at `lg` and above with the indices strip spanning full width, single column below `lg`, stacked above the fold where possible. Widget cards use `Panel` (rounded-xl) with concentric inner radii; gaps come from the existing spacing scale.
- **Freshness**: every widget states data recency via the existing conventions only (amber "Quotes Nm old" badge only when degraded — silent while fresh); no new indicator styles.

### Numbers, typography, motion

- `tabular-nums` on every dynamic numeral (prices, percentages, totals) so a quote refresh never shifts layout.
- `text-balance` on the hero heading.
- First paint: `Skeleton` blocks sized to the final widget heights; no enter/stagger animations on initial widget load. Background refresh may reuse the existing green/red price-flash (`quoteFlashClass`, `shared.jsx:286-292`) with its `motion-reduce` suppression.
- Widget CTAs/rows: minimum 40x40px hit areas, `active:scale-[0.96]`, scoped transition properties (never `transition: all`).
- Empty affordance cards ("Add a watchlist" → `/watchlists`, "Track a portfolio" → `/portfolios`): same `Panel` style, muted illustration-free copy, a single clear action each.

### Accessibility

- Each widget is a labeled region (`aria-labelledby` pointing at the widget heading).
- Movers/indices rows are real links or buttons with `focus-visible` rings.
- Sparklines keep their existing `aria-label`s (`market-sparkline.jsx:35`).
- The alerts card conveys state with icon + text, never color alone.

## Risks / Trade-offs

- [R1: Yahoo `^`-symbol quotes may behave differently at runtime (`currency: null`, odd `marketState`) even though `getQuote` works via the chart endpoint and `src/market-state/resolve.ts:100` classifies `^…` as index] → First implementation task is a live verification spike against the real provider; the endpoint reports per-symbol unavailability and the client hides the strip gracefully (no error banner, no layout jump) when data is unavailable.
- [R2: First `/api/market-state/quotes` response after load may be empty/stale, flashing empty widgets] → Skeleton-first rendering (existing `components/ui` `Skeleton`), and reuse the established stale-quote handling ("Quotes Nm old" / "As of <date>" semantics) rather than inventing new freshness copy.
- [R3: Widget grid could visually demote the composer, changing the product's "ask first" posture] → Layout order is a spec requirement: heading + composer above the grid on all breakpoints; widgets never render above the composer.
- [R4: A regression sneaks into the fresh-session/409 flow because the empty-thread branch is being rewritten] → Widgets only call the existing lifted handlers (D2); tasks include a regression test asserting home submit still goes through `startRoutedChatRun` with the fresh-session target and single retry.
- [R5: Indices endpoint adds Yahoo load for every open GUI window] → Server-side SWR store with the same freshness semantics as the existing `QuoteSnapshotStore` (60s window) while clients poll at the existing 5-minute `QUOTE_REFRESH_INTERVAL_MS` cadence; the fixed 4-symbol set is one fetch per refresh window regardless of client count.
- [R6: Follower windows could show mutation affordances the follower cannot execute] → v1 widgets are read-only (prefill/navigate only); prefill and navigation work identically for followers, so no writer-role branching is needed in widget code.

## Migration Plan

Pure addition — no schema changes, no config, no data migration. Ships dark-by-default in the sense that users with no saved state simply see the new-user empty state (indices strip + default chips + affordance cards). Rollback = revert the PR; no persisted state depends on it.

## Open Questions

- Exact runtime shape of Yahoo quotes for `^GSPC`/`^IXIC`/`^DJI` (resolved by the mandatory verification spike task before endpoint implementation is finalized).
- Whether `symbol-page` lands first (resolved at implementation time by the conditional task in D7; both outcomes are fully specified).
