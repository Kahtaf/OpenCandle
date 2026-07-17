# Home Market Dashboard: Make `/` a Market Workbench, Not a Blank Prompt

## Why

The GUI home (`/`) empty state is a heading, a composer, and a row of suggestion chips — a blank prompt in a product whose whole pitch is live market context. Users with saved watchlists, portfolios, and alerts already have quote snapshots polling in the background (`useMarketState()` is already called in `ChatPanel`), but none of it is visible until they ask a question. Turning the empty state into a Google-Finance-style dashboard (minus news) gives every visit an immediate read on the market and their saved state, while keeping the composer as the primary action.

## What Changes

- The empty-thread branch of `ChatPanel` (`gui/web/src/features/chat/ChatPanel.jsx`; currently `EmptyThread` from `gui/web/src/components/chat/prompt-suggestions.jsx`, gated at `ChatPanel.jsx:247-248`) becomes a dashboard layout: heading + composer on top, a widget grid below. Same route, same session semantics — NOT a new route, NOT an overlay. When the session gains content, the normal transcript takes over unchanged.
- **v1 widgets** (all read-only; sources verified by spike):
  - Market indices + crypto strip (^GSPC, ^IXIC, ^DJI, BTC-USD) — the only server extension: a new `GET /api/market-state/indices` endpoint serving a fixed symbol set through the existing quote/sparkline snapshot helpers, because the current quote poller iterates saved watchlist/portfolio symbols only.
  - Watchlist movers with sparklines — pure frontend over `quoteSnapshot.watchlistQuotes`, sorted by `abs(changePercent)`.
  - Portfolio summary strip — pure frontend over `quoteSnapshot.portfolioSummaries`, plus a client-side day-move derivation from `portfolioQuotes` per-lot `changePercent` (mirroring the existing `ValueHeader` logic in `PortfolioPage.jsx`).
  - Alerts/notifications card — pure frontend over the `/api/market-state` snapshot's `alerts`/`alertEvents`/`notifications`, shaped via the existing `alert-view-model.js`.
  - Suggestion chips — reuse of the `home-prompts.js` output already computed in `ChatPanel`.
- Widget row clicks prefill the composer with `$SYMBOL ` via the existing `setDraft`/`askAboutSymbol` pattern (`ChatPanel.jsx:145-158`); if the `symbol-page` change has landed at implementation time (its `/symbol/$ticker` route exists in `gui/web/src/router.jsx`), they deep-link to `/symbol/$ticker` instead.
- Visual language: the dashboard follows the existing minimal-shadcn design system (DESIGN.md tokens, `Panel` cards, `MoneyTile`/`DeltaChip` stat patterns, tabular numerals, skeleton-first loading, existing freshness badges) — see design.md "UI/UX guidance" and the presentation/accessibility spec requirements.
- New-user empty state: heading + composer + `DEFAULT_PROMPTS` chips + the indices strip (universal, needs no saved state) + affordance cards linking to `/watchlists` and `/portfolios`.
- The composer flow (fresh-session start, `session_changed` 409 retry, `run.started` session adoption at `App.jsx:243-288`) and model-setup gating (`ModelSetupCard` precedence, draft-while-blocked at `ChatPanel.jsx:195,305-316`) are preserved exactly — widgets reuse the existing submit/setDraft handlers, no parallel run path.

## Capabilities

### New Capabilities

- `home-market-dashboard`: the `/` empty-state dashboard — widget inventory, data sources, composer/model-setup precedence, the indices endpoint contract, empty/stale/skeleton states, click behavior, follower correctness, and the projector-trap constraint (per-session `dashboard.activeAnalyses`/`recentResearch` MUST NOT be bound on home).

### Modified Capabilities

<!-- none — no existing spec's requirements change; the transcript, session routing, and model-setup behaviors are preserved as-is -->

## Non-Goals

- No news, anywhere on the dashboard.
- No new route (`/home` or similar) and no overlay; the dashboard is strictly the empty state of `/`.
- No changes to session routing: the fresh-session + 409 `session_changed` retry flow in `App.jsx` is untouched.
- No bypass or reordering of model-setup gating; `ModelSetupCard` keeps precedence and send stays blocked while `needsSetup`.
- No new WebSocket channels; the indices endpoint is plain HTTP polling like the existing quote snapshot.
- No market-state mutation from the dashboard beyond existing tool-invoke paths.
- No cross-session "recent research" or "active analyses" widgets (see Deferred below).
- No per-widget deep charts; sparklines only in v1.

## Deferred (named follow-ups)

- **Cross-session recent-research widget** and **cross-session active-analyses progress**: `projectDashboard` runs over ONE session's entries, and `/` starts a FRESH session, so `dashboard.activeAnalyses` and `dashboard.recentResearch` are always empty on home (population paths: `opencandle-workflow` entries at `src/pi/opencandle-extension.ts:90`, `opencandle-analyst-step` at `src/runtime/session-coordinator.ts:916/930/944`, recent-research shift at `gui/server/projector.ts:227-237`). Surfacing them on home requires new server-side cross-session aggregation — a distinct future change. v1 explicitly must not bind these fields.
- **Symbol-page deep links**: covered by the parallel `symbol-page` change; v1 degrades to composer prefill.
- **Chart-backed indices strip**: the parallel `market-chart` change could later replace sparklines; v1 uses existing sparklines only.

## Dependencies

- No hard dependencies — implementable in parallel with everything.
- Soft: `symbol-page` (row deep links; degrades gracefully to composer prefill), `market-chart` (richer indices visuals later; v1 unaffected).
- Sequencing: safe to implement any time; it is last in the suggested order only because it benefits from `symbol-page` links.

## Impact

- **Frontend**: `gui/web/src/features/chat/ChatPanel.jsx` (empty-thread branch), `gui/web/src/components/chat/prompt-suggestions.jsx` (extended/replaced by the dashboard layout), new dashboard widget components under a new `gui/web/src/features/home/` directory reusing `Panel` from `gui/web/src/features/market-state/shared.jsx`, `gui/web/src/components/ui/` primitives (`Button`, `Skeleton`), `gui/web/src/components/market-sparkline.jsx`, `gui/web/src/features/market-state/format.js`, `portfolio-view-model.js`, `alert-view-model.js`, plus a new indices client store polling the new endpoint.
- **Server**: one new `GET /api/market-state/indices` route — snapshot logic beside `gui/server/market-state-api.ts`, registered in `gui/server/http-routes.ts` alongside the existing market-state routes, with its own SWR store (per `gui/server/quote-snapshot-store.ts` semantics), guarded by `allowTrustedGuiRequest`, follower-safe. Known risk to validate first: Yahoo `getQuote` for `^`-prefixed symbols works via the chart endpoint and `src/market-state/resolve.ts:100` classifies `^…` as index, but runtime behavior (`currency: null`, differing `marketState`) is unvalidated — first implementation task is a live verification spike; fallback posture is to hide the strip gracefully when unavailable.
- **Providers/tools/routing/prompts**: none.
- **Docs/tests**: GUI render tests (static-markup pattern per `stock-quote-card-render.test.ts`), indices endpoint unit tests with mocked provider + guard tests, CHANGELOG `[Unreleased]` entry, screenshots at 1440x960 and 390x844.
