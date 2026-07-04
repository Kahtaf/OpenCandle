# Design — `refine-gui-market-state-ux`

## 1. Direction

The UI system should be:

```text
llmchat = product shape
Efferd  = layout and polish reference
OC      = implementation source of truth
```

OpenCandle should remain a local financial research workspace, not a broker clone. The user lands in a chat/research surface, while durable market-state pages provide focused management surfaces for saved state.

The core shell should support three regions:

```text
┌────────────────┬─────────────────────────────────────┬───────────────────────┐
│ Navigation     │ Primary work surface                 │ Context / details     │
│                │                                     │                       │
│ New session    │ Today chat, report, or page content  │ Evidence trace        │
│ Search         │ Saved-state table/list               │ Selected row detail   │
│ Sessions       │ Composer or page toolbar             │ Alert/report status   │
│ Market State   │                                     │ Tool/source context   │
└────────────────┴─────────────────────────────────────┴───────────────────────┘
```

The right panel is single-purpose per page state: evidence/trace on Today, selected-row details on management pages, and optional when the page does not need a secondary surface. If a page supports both row detail and evidence trace, the active user task decides which mode is visible; the panel should not stack both at once.

On mobile, the shell collapses into a top bar plus drawers. Today keeps the composer; management pages use a toolbar or primary action instead:

```text
┌──────────────────────────────┐
│ Top bar: menu, title, action │
├──────────────────────────────┤
│ Primary content              │
│ table/list/card rows         │
│ contextual action button     │
├──────────────────────────────┤
│ Composer on Today            │
│ Toolbar/action on pages       │
└──────────────────────────────┘

Navigation, context, and create/edit flows open as drawers or sheets.
```

## 2. Component Ownership

OpenCandle's existing primitives remain authoritative:

- `Button`
- `Input`
- `Card` / panel equivalents
- `Dialog`
- `Sheet`
- `Popover`
- `Tooltip`
- `Badge`
- `Kbd`
- source/result cards
- app-shell and session components

Efferd app-shell and dashboard blocks should be mined for patterns only:

- grouped sidebar structure;
- command-style search placement;
- compact app header rhythm;
- action/status footer rows;
- dense management-page spacing;
- breadcrumb or current-page title treatment;
- table and KPI region hierarchy.

The implementation should translate those ideas into OC components and tokens. It should not install Efferd blocks into the codebase.

## 3. Today Page

Today is not a dashboard. It is the primary chat/research surface. Its first viewport should prioritize the chat/report canvas and composer; saved market state can appear as answer context, source cards, or evidence trace, not as standalone KPI tiles above the conversation.

```text
┌──────────────┬────────────────────────────────────┬──────────────────────────┐
│ Threads      │ Today answer / report canvas        │ Market context trace      │
│              │                                    │                          │
│ New/Search   │ User prompt                         │ Read portfolio state      │
│ Recent asks  │ Morning brief / alert result        │ Fetch quotes/screener     │
│ Watchlists   │ Source cards: ASTS, AAPL, alerts    │ Calculate position impact │
│ Portfolios   │ Human-readable report body          │ Alert state/provenance    │
│ Alerts       │ Bottom composer + mode selector     │ Evidence used             │
└──────────────┴────────────────────────────────────┴──────────────────────────┘
```

Durable market state should appear as context cards, source cards, or right-panel evidence inside Today. Management CRUD belongs on the dedicated market-state pages.

## 4. Management Page Template

Each new market-state page should share a consistent template:

```text
┌────────────────────────────────────────────────────────────┐
│ Header                                                     │
│ Title, concise subtitle, last refreshed, primary action     │
│ [Search/filter] [Secondary actions] [Refresh prices]        │
├────────────────────────────────────────────────────────────┤
│ Summary strip                                               │
│ Counts, stale data, runner status, important warnings        │
├────────────────────────────────────────────────────────────┤
│ Main state surface                                          │
│ table/list first, row actions, empty state when applicable   │
└────────────────────────────────────────────────────────────┘
```

Rules:

- Saved state comes before creation forms.
- The primary action is one explicit verb: `Add ticker`, `Add holding`, `Create alert`, `Generate report`, or `Record thesis`.
- `Refresh prices` is explicit copy. Avoid ambiguous labels like `Quotes`.
- `Refresh` and quote refresh controls are not pinned or oversized.
- Missing, stale, unavailable, follower/read-only, and provider-limited states use text plus badges, not color alone.
- Search/filter belongs near the state it affects.

## 5. Create And Edit Flows

Permanent stacked forms should be removed from the first viewport.

Preferred patterns:

- desktop: right-side detail panel or sheet;
- mobile: bottom sheet or full-height drawer;
- simple row edits: inline row action opening a focused editor;
- ticker selection: autocomplete/search as the first field;
- alert creation: structured rule builder with a live summary.

The user should be able to read current saved state without scrolling past form scaffolding.

## 6. Page-Specific Shape

### Watchlists

The watchlist page should feel like a working list:

```text
Header: Watchlists
Toolbar: Search symbols, Add ticker, Refresh prices
Summary: 12 symbols, 3 with alerts, 2 stale quotes
Table: Symbol, quote/change, freshness, target/stop, thesis, tags, alert status
Detail panel: selected ticker notes, thesis, tags, linked alerts, actions
```

`Add ticker` opens a create flow with provider-backed autocomplete. Row actions handle edit, remove, refresh, and create alert.

### Portfolios

The portfolio page should lead with portfolio meaning, not lot entry:

```text
Header: Portfolio
Summary: total value, P&L, allocation coverage, stale quote count
Toolbar: Add holding, Refresh prices, Search/filter
Table: Holding, quantity, average cost, current, value, allocation, P&L, currency
Detail panel: lot details, notes, quote freshness, edit/remove actions
```

Add/update holding should happen through a focused sheet or selected-row panel. Mixed-currency and unavailable quote states remain explicit.

### Alerts

The alerts page should separate rule authoring from monitoring history:

```text
Header: Alerts
Summary: monitoring mode, runner owner, last check, unread notifications
Primary: Create alert
Sections:
  Rules table
  Recent events
  Check runs
  Notifications
```

`Create alert` opens a rule builder:

```text
Instrument / scope
Condition family: price, SMA, RSI, volume
Condition fields
Existing cooldown field where supported
Read-only evaluation-mode summary
Save
```

The rule builder should expose only existing `manage_alerts` inputs and should preview the current semantics before saving, for example: `Notify once when ASTS crosses above $40 during a manual or local-runner check`. It must not introduce new repeat modes, re-arm behavior, runner behavior, or lifecycle semantics.

### Reports

The reports page should read like existing report-template and report-run management:

```text
Header: Reports
Summary: next report, last report, schedule status
Primary: Generate today
Secondary: Configure schedule
Sections:
  Current morning report template
  Report run history
  Report notifications
```

Generated report content remains human-readable and should be reachable from existing report-run history where the current report data supports it. This UI pass should re-present existing `reportTemplates`, `reportRuns`, notifications, and `daily_watchlist_report` actions; it must not add new cadences, hosted scheduling, report artifact persistence, import behavior, or notification semantics.

### Predictions / Thesis Tracker

The current `Predictions` page needs clearer user framing. The UI label should become `Thesis Tracker` unless product naming settles elsewhere.

```text
Header: Thesis Tracker
Summary: open theses, due soon, resolved outcomes
Primary: Record thesis
Table: Symbol, direction, conviction, entry, target, expiry, status
Detail panel: thesis text, linked holdings/watchlist item, outcome history
```

This is a UI naming/layout change only. The visible page title, empty state, and primary action use Thesis Tracker language. The `/predictions` route, tool names, stored record names, prompt terminology, and report terminology remain unchanged until a separate product/API rename is approved.

## 7. Responsive Behavior

Desktop:

- persistent left rail;
- central content max-width tuned per surface;
- optional right context/detail panel when useful;
- tables retain horizontal scroll only when needed.

Mobile:

- top app bar always exposes navigation;
- management pages show compact summary first, then list/table cards;
- row details and create/edit flows open in sheets/drawers;
- no horizontal overflow for page chrome;
- data tables may transform into stacked row cards where column density is too high.

## 8. Motion

Motion should clarify state changes and stay restrained. Use transitions.dev as a reference catalog, not a dependency.

Appropriate transitions:

- `panel reveal` for right detail panels and mobile sheets;
- `menu dropdown` for compact secondary-action menus;
- `modal open / close` for rare blocking dialogs;
- `page side-by-side` only for clear forward/back page transitions on mobile;
- `icon swap` for sidebar collapse, enabled/disabled alert toggles, and refresh state;
- `text states swap` for short status labels such as runner state or quote freshness;
- `error state shake` only for validation errors after a user submits an invalid form.

Rules:

- Prefer 150-250 ms durations.
- Do not animate layout-heavy table reflows.
- Do not add page-load choreography.
- Respect `prefers-reduced-motion`.
- Motion must never be the only signal for financial or alert state.

## 9. Browser Verification

Implementation should be verified in the real local GUI, not only with unit tests.

Required browser passes:

- `/`
- `/watchlists`
- `/portfolios`
- `/alerts`
- `/reports`
- `/predictions`

For each page:

- desktop screenshot;
- mobile screenshot;
- navigation from the shared shell works;
- primary action is visible and keyboard-focusable;
- empty state or existing-data state is coherent;
- no page-level horizontal overflow in mobile;
- create/edit surfaces open and close with accessible focus behavior once implemented.

This proposal records the verification expectation. Implementation PRs should keep screenshots in temporary folders unless the user asks to commit them.

## 10. React Quality Gate

React Doctor should be part of the normal UI review loop. It scans React code for state/effects, performance, architecture, security, and accessibility issues, which matches the risk profile of this overhaul.

For this change:

- autoreview should run React Doctor automatically when changed files include `gui/web/src` React source;
- React Doctor `error` diagnostics in changed files are blockers by default;
- React Doctor warnings should be fixed when practical, or explicitly classified as pre-existing/deferred in the review closeout;
- implementation PRs must finish with a full-GUI React Doctor score greater than or equal to the baseline captured before the UI overhaul branch starts, preferably from `main`;
- broad rewrites just to satisfy low-value style warnings are not required, but state/effect, accessibility, security, and performance findings should be taken seriously.

Use changed-file scans for autoreview so old baseline findings do not block unrelated UI diffs. Use a full GUI scan periodically, especially before larger UI merges, to keep the app score high.
