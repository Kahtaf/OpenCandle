# GUI UX audit — July 2026

Live audit of the local GUI (`npm run gui`) at desktop (1440px) and mobile (390px) widths, clicking through every page, form, panel, and the catalog/composer surfaces. Benchmark: professional financial products (Stripe, TradingView, Coinbase).

**Verdict:** the visual foundation is strong — the zinc/Inter/shadcn language is clean, restrained, and consistent. The gap to the professional bar is not visual style; it is data provenance, information density, error recovery, copy discipline, and layout stability.

State at audit time: one commit after `ade0147` ("Polish market state UI refresh behavior"), which removed the `quoteFreshness` "Updated Xm ago" / "Quote Xm old" labels in favor of TradingView-style silent auto-updating prices. DESIGN.md still mandates the freshness line; the required edits are listed below.

## Design health snapshot

| Heuristic | Score /4 | Key issue |
|---|---|---|
| Visibility of system status | 1 | No staleness signal; quotes silently changed between page views |
| Match system / real world | 2 | Internal jargon leaks throughout |
| User control & freedom | 2 | Failed runs dead-end without retry; no watchlist/portfolio delete |
| Consistency & standards | 2 | Status vocab differs between Diagnostics and Catalog; duplicated buttons |
| Error prevention | 3 | Confirm steps exist; side-panel reflow invites misclicks |
| Recognition vs recall | 3 | Catalog makes tools visible — genuinely strong |
| Flexibility & efficiency | 2 | ⌘K exists; tables lack row click-through and keyboard nav |
| Aesthetic & minimalist | 3 | Clean, but dead space and repeated headers |
| Error recovery | 1 | "Quote unavailable." with no reason, no retry |
| Help & documentation | 2 | Empty states teach; Diagnostics points at CLI commands |

**~21/40** — solid foundation; the big gaps are status and recovery.

## Decisions (2026-07-09, no code changes yet)

### 1. Quote freshness: silent when healthy, loud when degraded

`ade0147` removed "Updated Xm ago" on the TradingView precedent. The distinction that matters: TradingView earns silence because its prices visibly stream — freshness is self-evident from movement, and market-session state is displayed. OpenCandle polls a stale-while-revalidate snapshot built on keyless, sometimes-delayed sources (TradingView scanner data is delayed; Yahoo fallback; providers rate-limit; the market closes; the laptop sleeps). A silently non-moving number is indistinguishable from a silently stale one.

**Decided:** keep silent auto-update as the healthy-path behavior — no persistent "Updated 2m ago" chrome (the `ade0147` removal was right; it is noise). Reintroduce only the *degraded* branch: an amber "Quote 26m old" / "As of Fri close" badge when the snapshot crosses a staleness threshold, quotes are from a prior market session, or a provider check failed. This mirrors the freshness-ledger rule the agent side already follows in answers (as-of disclosure lines appear only as caveats) rather than inventing a new GUI rule.

### 2. "What the agent sees" context drawer: remove, keep the idea per-turn

Current state: behind an unlabeled eye icon in the composer; sections for last turn routing, receipts, saved-state chips, recent quotes, active analyses, recent research, data quality — mostly empty-state text in normal use ("No routed turn yet", "No validation ran").

**Decided:** remove the global drawer. Half-transparent is worse than absent — empty sections read as "the agent saw nothing." The transparency goal is core to the product, but each piece has a better per-turn home to be reintroduced when that work happens: routing/assumptions render with each answer, receipts belong on the workflow/tool drawer, saved-state context becomes small "Using: Portfolio · Growth watchlist" chips on the answer that actually used it, and the data-quality line moves to Diagnostics. Removing the drawer also removes the undiscoverable eye icon.

## Required DESIGN.md changes

DESIGN.md still codifies the pre-`ade0147` behavior and must be updated before any freshness work lands, so the doc and the code do not disagree:

1. **Section 6 "Do" bullet** — currently: *"Do show data freshness in plain language (\"Updated 2m ago\", \"Quote 26m old\") with Amber Caveat when stale."* Rewrite to the decided rule: healthy quotes update silently in the background with no age chrome; age appears only as a caveat — an Amber Caveat badge in plain language ("Quote 26m old", "As of Fri close") when data is stale, from a prior session, or a provider check failed.
2. **Section 6 "Don't" bullet** — currently: *"Don't ship manual refresh buttons; data updates in the background and announces its own age."* Keep the manual-refresh ban; replace "announces its own age" with "announces its age only when degraded."
3. While in there: the components/tables prose still assumes watchlist target/stop/thesis fields that were removed from watchlist state (per CHANGELOG Unreleased); scrub any remaining references so the normative doc matches shipped state.

## Cross-cutting issues

1. **[P0] Dead-end errors.** A failed "analyze NVDA" session shows "Tool error → Market lookup 0 of 1 step → Quote unavailable." No reason (rate limit? network? missing key?), no retry, no assistant fallback text. Every failure needs a cause and a next action.
2. **[P0→decided] Staleness signaling.** See decision 1 — silent auto-update stays, with a degraded-state escape hatch to implement.
3. **[P1] Internal vocabulary leaks.** Found live: "Search provider-backed candidates and select a resolved ticker" (Add Holding); "GUI server is writer" (Diagnostics); "Run `opencandle doctor --sessions`" backtick copy in the GUI (which has a Check button on the same row); "Cooldown between triggers (seconds): 3600" (Alerts); "No routed turn yet" / "RECEIPTS" (context drawer); raw exchange codes "NMS · EQUITY / NYQ / NGM" in every ticker autocomplete.
4. **[P1] Bare tickers in tables.** Watchlist shows "RKLB", Portfolios "AAPL" with no company name — DESIGN.md's own symbol-cell grammar (bold ticker over graphite name) is unimplemented.
5. **[P1] Side-panel forms reflow the page.** Opening Add Ticker/Rename/Create Alert squeezes the content column so every control shifts mid-interaction (an automated click landed on the wrong control and typed a ticker into the watchlist Name field). The single panel slot also swaps content in place (Add Ticker ↔ New Watchlist ↔ Rename). Use a non-reflowing overlay sheet (as mobile already does) or a fixed inspector column.
6. **[P1] No charts anywhere.** No sparklines in tables, no mini price history in the symbol inspector or cashtag popover. Even a small SVG line from cached daily history would transform the watchlist and popover.
7. **[P2] "(no messages)" sessions pollute the sidebar.** New chat eagerly creates a persistent session; create lazily on first send or filter empties.
8. **[P2] Redundant chrome.** Page title "Watchlists" + card label "Watchlists 1" (count is actually the selected list's ticker count — mislabeled); two "Add ticker" buttons on empty lists; two "Generate today" buttons on Reports.

## Per page

### Home / empty state
- [P1] Hero + suggestion chips top-anchored, composer bottom-pinned, dead middle band. Center as one block or pull the composer up under the chips.
- [P2] Suggestion chips are hardcoded NVDA. Personalize from saved state ("What's moving in Growth?", "How is my Interactive Brokers portfolio doing?").
- [P2] Sidebar Market State items could carry live count pills (armed alerts, portfolio day change).

### Chat transcript
- [P0] Retry affordance + reason on failed tool/workflow cards (cross-cutting 1).
- [P1] Rendered markdown tables ignore the data-table spec: numbers left-aligned, no tabular-nums, no signed color on values like "+3.37%".
- [P2] No message-level metadata (timestamp, model, visible copy control).
- [P2] Entity popover (a great feature): add sparkline; flatten the OPEN/HIGH/LOW/VOLUME nested mini-boxes to a plain stat grid; show quote age when stale per decision 1.
- [P2] Floating "Latest" pill overlaps table text mid-scroll.

### Watchlists — overhaul candidate
Today: 3 columns (Symbol/Last/Today), one signal badge, sparse inspector (price + alert + Remove). A professional quote board wants: company name, last, change $, change %, volume, sparkline, alert count; inspector with chart, day/52-week range, and actions ("Analyze in chat", "Create alert", "Add to portfolio").
- [P1] No way to delete a watchlist (pencil → rename only).
- [P2] Add-ticker suggestion dropdown clips at the panel boundary.
- [P2] Search input disappears when the list is empty (layout jumps between states).
- [P2] Rows should click through to research; the popover's "Ask about $X" belongs here too.

### Portfolios
- [P1] Allocation bar is solid ink for every holding — undifferentiated with 2+ holdings. Needs a categorical palette with proportional segments and hover tooltips.
- [P1] Add Holding jargon → "Search for a stock or fund, then enter your shares and cost."
- [P2] Currency is free-text; make it a select.
- [P2] Lot ledger: empty "Today" cell on lot rows; no acquisition-date field in the form.
- [P2] Header could add total cost basis alongside today/all-time deltas.
- Same as Watchlists: no company names, no delete-portfolio.

### Alerts
- [P0-ish bug] "Armed · last checked just now at −13.53" — bare negative number as the observed value of an SMA-cross rule. Say what was observed: "price $82.62 is 13.5% below the 20-day SMA".
- [P1] "Cooldown between triggers (seconds): 3600" → "Re-alert at most every: 1 hour" select.
- [P2] Threshold field doesn't adapt label/unit to the condition (price $ vs RSI level vs % move) — 11 conditions share one generic "Threshold".
- [P2] Disabled "Create alert" state is ambiguous.
- Keep: plain-English rule sentences, "Monitoring locally · last check just now" honesty. Add "next check in ~Xm".

### Reports
- [P2] Duplicate "Generate today" buttons.
- [P2] Schedule panel only offers "Save schedule" — no visible way to turn a schedule off.
- [P2] Populated history entries should show run status (ok/partial/failed).

### Diagnostics — overhaul candidate
Every check is a bordered card inside a section card — nested cards (banned by DESIGN.md) and a ~26-card wall. Convert to grouped table rows: name, one-line detail, status badge, action (Stripe status-page pattern).
- [P1] Summary contradiction: header badge "Degraded" while Warnings=0/Failures=0 — the 2 flagged items are info-level "unchecked" session checks. Reserve "Degraded" for real warnings/failures.
- [P2] Red "0" failures / amber "0" warnings — zeros should render neutral.
- [P2] Drop the CLI instruction copy next to the equivalent Check button.
- [P2] Status vocab inconsistent with Catalog: Diagnostics "Pass · Reachable" vs Catalog "Not checked" (amber) for the same providers.

### Catalog (⌘K) + composer
Strongest surface: tabs with counts, searchable tools with snake_case chips and plain descriptions, tool form with CHAT PREVIEW + "Edit in chat"/"Run now" — a differentiated, trust-building pattern. Keep it.
- [P2] Overlay height jumps ~130px when switching tabs; fix a min-height.
- [P2] Provider status labels ("From environment", "Not checked") need the plain-language pass.
- [P2] Cashtag autocomplete works well; exchange codes raw (cross-cutting 3).
- Context drawer eye icon: removal decided, see decision 2.

### Mobile (390px spot-check)
Good: hamburger nav, column folding (Signals drops), stacked detail card, signed red/green preserved. No horizontal overflow observed.

## Top five

1. Failed tool/workflow runs get a reason + retry (P0).
2. Degraded-state staleness badges per decision 1 (DESIGN.md edit + small implementation).
3. Watchlist overhaul into a real quote board with sparklines and a useful inspector.
4. Diagnostics overhaul from card-wall to grouped status table, fixing the Degraded/unchecked logic.
5. One copy pass purging internal vocabulary (list in cross-cutting 3).

Structural decisions worth making once: collapse the repeated "card header inside page header" pattern (Watchlists/Portfolios) into the page header itself; replace the reflowing side-panel form pattern with sheets everywhere, matching mobile. Update DESIGN.md for the freshness decision and the removed watchlist fields.

## Layout system, shadcn ecosystem, micro-interactions, loading states

Follow-up analysis (2026-07-09). Grounded in the current inventory: `gui/web/src/components/ui/` has ~20 primitives (badge, button, card, dialog, input, kbd, popover, select, sheet, skeleton, source-*, status-dot, text-shimmer, textarea, toast, tooltip); `packages/ui` has the shared subset. There is **no** Table, Tabs, DropdownMenu, Command, AlertDialog, ScrollArea, Separator, chart library, or motion library, and no `components.json` — components were hand-copied, not CLI-managed. Pages hand-roll their own tables (watchlist/portfolio markup), tab strip (`StateTabs`), and catalog palette.

### Missing primitives (biggest structural lever)

The audit's layout problems trace to hand-rolled versions of things shadcn already solves. Adopt via the CLI (add a `components.json` mapped to the existing token names so `npx shadcn add` lands on our vocabulary):

| Gap | shadcn primitive | Audit finding it fixes |
|---|---|---|
| Hand-rolled data tables | `table` (+ TanStack Table for sorting) | Bare-ticker rows, no sorting, no row hover actions, no row click-through |
| Row/list actions | `dropdown-menu` | Always-visible Edit/Remove text links; no per-row overflow menu |
| Destructive confirms | `alert-dialog` | Two-step inline confirms are fine, but delete-watchlist/portfolio doesn't exist at all; when it lands it needs a standard confirm |
| Catalog palette | `command` (cmdk) | ⌘K overlay has no arrow-key navigation affordance; cmdk gives keyboard nav, groups, and empty states for free |
| Clipped dropdowns / rails | `scroll-area` + Popover portal | Add-ticker suggestions clipping at the panel boundary; Reports history rail |
| Tab chrome | `tabs` (or keep `StateTabs`, it's close) | `StateTabs` just shipped and matches the segmented look; fold shadcn's focus/keyboard semantics into it rather than replacing |
| Section rhythm | `separator` | Hairline divs are hand-written per page |

### Financial-dashboard registries worth borrowing from

Keep DESIGN.md's restraint (light paper, ink accent, zinc neutrals) — everything borrowed gets re-tokenized. Structure, not skins:

- **shadcn charts** (`chart` component, Recharts-based): the default answer for the audit's "no charts anywhere." `ChartContainer` + a bare `LineChart` gives table sparklines and the inspector price chart inside our tokens; the pie/donut variant replaces the solid-ink allocation bar with categorical segments. One dependency, official, themeable via CSS vars.
- **Tremor** (now shadcn-compatible, copy-paste): the most finance-native block source — spark charts, bar lists, donut, and especially **Tracker** (segmented tick strip), which is a perfect fit for alert-check history and diagnostics check runs. Borrow structure per-component; do not adopt its color defaults.
- **number-flow**: animated numeric transitions (digit roll) for live-updating quotes. Directly supports decision 1 — silent auto-update becomes *legible* because the number visibly rolls when it changes. Respects `prefers-reduced-motion`.
- **Origin UI**: large free registry of polished form controls — currency select, unit-suffixed inputs (fixes the Alerts threshold field), combobox patterns for ticker search.
- **efferd blocks**: already DESIGN.md's approved structural reference; use for page-shell and master-detail scaffolding when overhauling Watchlists.
- Official `dashboard-01` block: reference for summary-strip + table page anatomy (Diagnostics overhaul), not for its hero-metric cards (banned by impeccable/DESIGN anyway).

### Micro-interactions

Existing good habits to standardize: `StateTabs` already uses `active:scale-[0.96]` and property-scoped transitions (`transition-[background-color,color,box-shadow,scale]`); renderer cards already use `tabular-nums`.

1. **Quote-change flash (the TradingView tell).** On snapshot update, if a value changed, pulse the cell background (green/red at ~8% alpha, 150–250ms ease-out fade) or use number-flow's digit roll. This is the single highest-value micro-interaction for a market app and pairs with decision 1.
2. **Press feedback everywhere.** ~~Move `active:scale-[0.96]` into `button-variants.js`~~ **Already done** — `packages/ui/src/button-variants.js` ships `active:enabled:scale-[0.96]` with property-scoped transitions, and `gui/web` re-exports it. Remaining scope: non-Button interactive elements only (table rows, custom clickables).
3. **Property-scoped transitions only.** Codify "no `transition-all`" (the `StateTabs` pattern) as the rule; audit existing components for stragglers.
4. **Lot-ledger expand.** Animate the chevron rotate (150ms) and row reveal (Radix Collapsible or `grid-template-rows` trick) instead of instant pop.
5. **Row hover affordances.** Table rows get Zinc Mist hover (already spec'd) plus actions revealed via opacity transition — never `display` toggles, and never layout shift.
6. **Status dot transitions.** Armed→triggered→paused dots cross-fade (opacity/scale, 150ms) rather than swap.
7. **Concentric radii check.** Cards are `rounded-xl` (12px); inner controls at 8px need ≥4px padding differential — the entity popover's OHLC mini-boxes currently fail this (and are being flattened anyway per the audit).
8. **Sheet/dialog motion.** 200ms ease-out-quart enter, subtler exit; the decided move from reflowing side panels to overlay sheets removes the worst motion problem (animating page layout) for free.
9. **Hit areas.** The composer's eye/plus icons and `StateTabs` pencil are near 32px on desktop; keep the mobile 40px+ pattern (`size-10 md:size-8` is fine given pointer precision, but verify the composer icons).

### Loading states and skeletons

Current state: `Skeleton` is used only by `ChatPanel`; `text-shimmer` covers workflow steps; market-state pages render nothing/empty until data arrives.

1. **Route-level skeletons for market-state pages.** Table-row skeletons matching final row geometry (symbol block, right-aligned number columns) + inspector skeleton. Skeletons must reserve exact heights — the point is zero layout shift when data lands.
2. **First-load only.** Never skeleton on background refresh; stale-while-revalidate already keeps old values on screen (verified live — keep it that way). Skeleton = "I have nothing yet," not "I'm refreshing."
3. **Distinguish loading from empty.** "No tickers yet" must never flash before data resolves; gate empty states on settled queries.
4. **In-button pending.** Add ticker / Save / Create alert / Rename buttons need a pending state (spinner replacing label, width preserved) while awaiting the WS/tool ack — today the only feedback is the eventual toast/panel close.
5. **Long-run affordance for Reports.** "Generate today" kicks off a model run; reuse the steps-card shimmer pattern with step labels rather than leaving a static page.
6. **Router pending states.** TanStack Router supports `pendingComponent` per route — wire the skeletons there so navigation gets them for free.
7. **Numbers placeholder vocabulary.** When a single value is unavailable (not loading), use an em-dash "—", never 0 or blank — pairs with the zero-filled-quote guards on the agent side.

### Suggested sequencing

Superseded by the Execution plan below.

## Accuracy review notes (2026-07-09, verified against code)

Claims re-checked before delegation; corrections applied above:

- **Confirmed:** no watchlist/portfolio delete in the GUI (only item/lot `Remove` with inline confirm in `WatchlistPage.jsx:279`, `PortfolioPage.jsx:301`); `ReportScheduleForm` (`MarketStatePage.jsx:425`) offers only "Save schedule," no disable; `Skeleton` used only by `ChatPanel`; no `components.json`; no Table/Tabs/DropdownMenu/Command/AlertDialog/ScrollArea/Separator/chart/motion deps in `gui/web/package.json`.
- **Corrected:** press-feedback standardization was already shipped in `packages/ui/src/button-variants.js` (see strikethrough above).
- **Refined:** the alert "Armed · last checked just now at −13.53" string is not composed in `AlertsPage.jsx` — the formatter lives further back (server projector or view-model); the fix task must trace it first. The "(no messages)" sidebar titles do not appear in `gui/web` source — they come from Pi session records, so the fix is lazy session creation / server-side filtering, not a client string change. `fetchedAt` still flows through `gui/server/quote-snapshot-store.ts` → `market-state-api.ts` → `portfolio-view-model.js`, so degraded-staleness badges are a client-formatting task, no server changes needed.

## Execution plan (for delegated agents)

Ground rules for every task: TDD per AGENTS.md (failing test first; tests live in `tests/unit/gui-web/`, mirror existing `*-render.test.ts` patterns); run `npm test` before finishing; verify live in the browser against `npm run gui` (CLAUDE.md rule 5 — unit tests alone are not done); update `CHANGELOG.md` [Unreleased]; run `graphify update .` after code changes. Each task owns a disjoint file set — do not touch files owned by a concurrently running task.

### Wave 0 — one tiny blocking task

- **T0. DESIGN.md alignment** (docs only, no code). Apply the "Required DESIGN.md changes" section above. Blocks T5–T8 and T12 so the normative doc never disagrees with landing code.

### Wave 1 — parallel, disjoint ownership (up to 5 agents)

- **T1. shadcn foundation.** Add `gui/web/components.json` mapped to existing token names; pull `table`, `tabs`, `dropdown-menu`, `alert-dialog`, `scroll-area`, `separator`, `command`, `chart` via CLI; adapt imports to repo conventions (`.jsx`, `cn` from `@opencandle/ui`). Owns: `gui/web/components.json`, `gui/web/src/components/ui/*` (new files only). Blocks T4a and all of Wave 2.
- **T2. Chat error recovery.** Failed tool/workflow cards get a human-readable reason and a retry affordance; no more dead-end "Tool error / Quote unavailable." Owns: `features/chat/tool-drawer.jsx`, `steps-card.jsx`, `features/renderers/*`.
- **T3. Context drawer removal** (decision 2). Delete `features/context-panel/FinancialContextPanel.jsx`, the composer eye trigger, and the `?drawer=context` route state; move the data-quality line to Diagnostics. Owns: `features/context-panel/*` + the trigger in `ChatPanel.jsx`. Run before or by the same agent as T2 if ChatPanel conflicts arise.
- **T4. Session hygiene.** New chat creates a session lazily on first send (or empty sessions are filtered from the sidebar); "(no messages)" rows disappear. Owns: `gui/server` session-creation path + `features/sessions/SessionHistory.jsx`. Note: titles originate in Pi session records, not client strings.
- **T11. Durable copy pass.** Exchange-code mapping (NMS→NASDAQ etc.) in ticker autocomplete/search results; Add Holding helper text; provider status labels in catalog; Diagnostics CLI-instruction removal. Excludes strings inside pages being overhauled in Wave 2 (those fold into their tasks). Owns: `features/chat/cashtag-autocomplete.jsx`, shared instrument-search primitive, `features/catalog/*` copy, form helper strings.

### Wave 2 — after T1; shell first, then pages in parallel

- **T4a. Market-state shell migration.** The one structural change made once: side panels → overlay `Sheet` (no page reflow), page-header consolidation (kill the duplicated "Watchlists / Watchlists 1" pattern, promote tabs into the page header), fix the mislabeled count. Owns: `features/market-state/MarketStatePage.jsx`, `shared.jsx`. Blocks T5, T6, T8.
- **T5. Watchlist overhaul.** Quote board columns (company name, last, change $, change %, volume, sparkline via `chart`, alert count), row click-through + hover actions (`dropdown-menu`), inspector with price chart/ranges/actions, watchlist delete (`alert-dialog`), route skeleton, empty-vs-loading gating, fix clipped autocomplete (`scroll-area`/portal). Owns: `WatchlistPage.jsx`, `format.js`, related server watchlist API if needed.
- **T6. Portfolio page.** Allocation donut or categorical segmented bar, lot-expand animation, currency select, acquisition-date field, in-button pending on Save, route skeleton. Owns: `PortfolioPage.jsx`, `portfolio-view-model.js`, `features/catalog/form-primitives.jsx` (coordinate with T9 if concurrent).
- **T7. Diagnostics overhaul.** Card-wall → grouped table rows (`table`); "Degraded" reserved for real warnings/failures (unchecked ≠ degraded — see `DiagnosticsPage.jsx:17` tone map); neutral zeros; accept the data-quality line from T3. Owns: `features/diagnostics/*`.
- **T8. Alerts fixes.** Trace and fix the observed-value formatter ("price $82.62 is 13.5% below the 20-day SMA" instead of "at −13.53" — formatter is upstream of `AlertsPage.jsx`, likely server projector); cooldown → human units; condition-adaptive threshold label/unit; "next check in ~Xm". Owns: `AlertsPage.jsx` + the server-side alert formatting path.
- **T9. Catalog polish.** Migrate palette to `command` (cmdk) for arrow-key nav; fix tab-switch height jump; provider status plain language (if not covered by T11). Owns: `features/catalog/CatalogOverlay.jsx`.

### Wave 3 — after Wave 2 pages settle (parallel)

- **T10. Home layout.** Center hero + suggestions + composer as one block; personalized suggestion chips from saved state; sidebar count pills. Also fix (found in Wave-1 browser verification): at 390px the "Deep research: NVDA (multi-analyst…)" and "Compare NVDA and AMD" suggestion chips overflow/clip past the right viewport edge. Owns: home/ChatPanel empty-state region (after T2/T3 to avoid ChatPanel conflicts).
- **T12. Freshness degraded badges** (decision 1; needs T0). Client-side: derive age from `fetchedAt` (already served), amber badge only when stale/prior-session/failed. Owns: `format.js` + badge placement in the pages (small diffs, after T5/T6).
- **T13. Quote-change flash.** Value-change background pulse or number-flow digit roll in watchlist/portfolio tables; respects `prefers-reduced-motion`. After T5/T6 (touches their tables).
- **T14. Polish pass.** Markdown-table styling in chat answers (right-aligned tabular numbers, signed colors); entity popover stat-grid flatten + sparkline; concentric-radius and transition audit; hit-area check on composer icons; Tremor Tracker tick-strip for alert history (needs T8's event data); fix the a11y warning found in Wave-1 verification ("Blocked aria-hidden on an element because its descendant retained focus" when the mobile history drawer opens — focus should move into the drawer or the trigger should not stay focused under aria-hidden). Cross-cutting, runs last. (Execution note 2026-07-09: the Tremor Tracker tick-strip for alert history was deferred — the alert log is too sparse to make a tick-strip meaningful yet; revisit once alert events accumulate. Signed cell coloring inside rendered markdown tables was also dropped as too fragile; alignment + tabular numerals only.)

Parallelism summary: Wave 1 runs T1+T2+T3+T4+T11 concurrently (T2/T3 same lane if ChatPanel contention); Wave 2 runs T4a then T5+T6+T7+T8+T9 concurrently; Wave 3 runs T10+T12+T13 then T14. Any task that discovers its assumptions are wrong (e.g. T8's formatter lives somewhere unexpected, T4's session creation is load-bearing for routing) should stop and report rather than improvise.

### Execution outcome (2026-07-09): all waves shipped and browser-verified

All tasks T0–T14 landed (T5/T6/T8 serialized over `MarketStatePage.jsx` instead of parallel; T10 pulled forward). Deferred items for future passes, each with its reason recorded above or in the task handoffs:

- Watchlist/inspector **sparklines and price charts** (T5 stretch): needs a cached daily-history series in the quote snapshot with its own refresh policy.
- **Tremor Tracker tick-strip** for alert history (T14): alert-event history too sparse to be meaningful yet.
- Inspector **"Ask in chat"** action (T5): composer state is ChatPanel-owned; needs a small App.jsx wiring change.
- Add Holding **purchase date** (T6): `opened_at` exists in storage but `src/tools/portfolio/tracker.ts` doesn't accept/forward it.
- Alerts **"next check in ~Xm"** (T8): runner interval isn't in the automation-status payload.
- Signed **red/green coloring inside rendered markdown tables** (T14): dropped as fragile; alignment + tabular numerals shipped.
- Minor: `/favicon.ico` 404; one duplicate form-field `id` (browser autofill warning).
