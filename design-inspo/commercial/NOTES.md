# Commercial trading app layout research

Reference screenshots in this directory were pulled from App Store listings, official
help-center articles (TradingView, IBKR Campus, Webull Learn), and design teardowns.
All observations below are verified against the downloaded images or the cited articles.
Researched June 2026 for OpenCandle's watchlist / portfolio / alerts / reports /
predictions GUI surfaces.

---

## Per-app anatomy

### Robinhood (mobile-first consumer)
Images: `robinhood-crypto-portfolio-holdings.png`, `robinhood-watchlist-list-rows.png`,
`robinhood-asset-detail-position.png`, `robinhood-asset-detail-chart-header.png`,
`robinhood-advanced-chart-indicators.png`, `robinhood-collections-grid.png`,
`robinhood-managed-portfolio-allocation-donut.png`, `robinhood-stock-detail-chart.gif`

- **Portfolio home**: giant total value (largest text on screen), directly under it a
  one-line delta chip "▲ $X (Y%) Today", then an unlabeled sparkline-style line chart,
  then a time-range pill row (LIVE/1D/1W/1M/3M/YTD/1Y). Holdings list below: ticker +
  shares held on the left, mini sparkline in the middle, price inside a solid
  green/red rounded chip on the right. No table headers, no grid lines.
- **Color is the status system**: the entire chart and accents flip green/red based on
  the day's direction. Red is warmed toward orange so it reads "down", not "error".
- **Watchlist/list rows** (`robinhood-watchlist-list-rows.png`): list header card with
  name, source/freshness ("Updated 8 hrs ago"), description, item count, and a sort
  control; rows are ticker (bold) + company name (muted) on the left, colored price
  text on the right. Quotes update by streaming — there is no refresh affordance
  anywhere in the app.
- **Asset detail** (`robinhood-asset-detail-position.png`,
  `robinhood-asset-detail-chart-header.png`): strict vertical stack — ticker (small,
  muted) → company name → price → two delta lines (Today and After-Hours, each with
  arrow + colored $ and % change) → chart → range pills → "Your position" section
  (shares, market value) → stats → news → analyst/trading trends → collections.
  Position info appears only if you own it. Scrubbing the chart shows the price at
  that point in the header (header IS the chart legend).
- **Progressive disclosure**: no cost-basis/lot detail, no Greeks, no order book on
  the default view. Stats are a flat 2-column label/value grid (Market cap, P/E,
  52-wk high/low). "Expand" link opens the advanced chart with indicators
  (`robinhood-advanced-chart-indicators.png`) — indicator chips (Volume, BOLL, SMA)
  sit above the chart as removable tags.

### TradingView (desktop-first power tool — closest analog to OpenCandle)
Images: `tradingview-watchlist-panel-with-symbol-detail.png`,
`tradingview-watchlist-advanced-overview-tabs.png`,
`tradingview-watchlist-dividends-tab.png`, `tradingview-watchlist-earnings-tab.png`,
`tradingview-market-summary-indices.png`, `tradingview-watchlist-actions-menu.png`,
`tradingview-watchlist-add-symbol-dialog.png`,
`tradingview-asset-detail-with-watchlist-rail.png`

- **Watchlist is a right-hand rail**, not a page. Compact table: logo chip + ticker |
  Last | Chg | Chg% (red/green text, no chips). Rows are grouped into user-defined,
  collapsible sections ("STOCKS", flag colors). Selecting a row loads the chart on
  the left AND a symbol summary card directly below the watchlist: full name,
  exchange, sector, big price + delta, market-open dot, day's range / 52-wk range
  rendered as a thin slider bar with the current position marked, key stats (next
  earnings, volume, avg volume, market cap), and a one-sentence "why it moved" news
  blurb. Master-detail in a single glance, zero navigation.
- **Cells flash** yellow/up-tick green on quote updates (live streaming); no refresh.
- **Advanced view** (`...advanced-overview-tabs.png`): the same watchlist expands into
  a full-screen table with tab strip (Overview / Earnings / Dividends / News) and a
  second-level column-set switcher (Price / Financials / Performance / Risk /
  Technicals). The Earnings and Dividends tabs reuse the watchlist's symbols as the
  row set ("Upcoming earnings: TODAY & YESTERDAY / NEXT 14 DAYS" grouping) — i.e. a
  daily report generated from the watchlist. Directly relevant to OpenCandle's
  daily watchlist reports.
- **Watchlist management**: one "..." actions menu (share toggle, add alert on the
  list, make a copy, rename, add section, clear, create/upload list, recently-used
  list switcher). Add-symbol is a typeahead dialog with asset-class filter pills
  (Stocks/Funds/Futures/Forex/Crypto/Indices/Bonds) and a "+" per row so you can add
  many symbols without closing.
- **Alerts**: created contextually everywhere — right-click on a chart price level,
  from a watchlist row, or the panel "+". Managed centrally in an Alerts rail panel:
  each row shows condition summary; status dots (green = active, orange = paused/
  fired, red = stopped/expired); controls to pause/resume/edit/delete; alert levels
  are draggable on the chart itself. A separate **Alerts Log** (bottom panel) keeps
  the fired-event history; exportable to CSV. Active-vs-history is a hard split.

### Coinbase (mobile-first consumer, very clean)
Images: `coinbase-portfolio-home-balance-chart.png`, `coinbase-trending-asset-list.png`,
`coinbase-predictions-list.png`, `coinbase-asset-detail-tabs.png`

- **Portfolio home**: total balance → delta line ("↗ $131.36 (1.38%) 1D") → line
  chart over dotted-grid background → range pills (1D/1W/1M/1Y/YTD/All) → an
  asset-CLASS rollup list (Crypto / Stocks / Derivatives / Predictions / Cash), each
  row: icon + label left, value right, green delta where applicable, chevron to
  drill in. Holdings come only after the class rollup (Bitcoin row with value +
  delta). Scrolling collapses the balance into the top bar.
- **Asset list rows** (`coinbase-trending-asset-list.png`): round token icon, name
  (bold) + market cap (muted subtitle), price (right-aligned) + small ↗/↘ % in
  green/red. Filter chips ("Trending", "All networks") above the list.
- **Predictions** (`coinbase-predictions-list.png`): a "Predictions" card on the home
  page with an aggregate open P&L in the header ("↗ $2.66 open") and rows = event
  icon + question/position title + subtitle, current value right-aligned with green
  P&L underneath. Predictions are treated exactly like a holdings list — same row
  grammar. Good model for OpenCandle's predictions tracker.
- **Asset detail** (`coinbase-asset-detail-tabs.png`): asset header + "My balance /
  Insights" tab strip; balance card with value, chevron, and "% of portfolio" row
  (39%) — portfolio-context stats live on the asset page.
- Coinbase's design system (CDS, cds.coinbase.com) ships `SparklineInteractive`,
  `SparklineGradient` (used large on portfolio + asset detail), `LineChart` — gradient
  fill under the line is their signature chart treatment.

### Webull (hybrid; desktop platform + mobile)
Images: `webull-desktop-workspace-watchlist-chart-orders.png`,
`webull-desktop-options-chain.png`, `webull-desktop-advanced-charting.png`,
`webull-desktop-widget-layout-builder.png`, `webull-alert-create-price-rule.png`,
`webull-alert-create-price-movement-toggles.png`, `webull-alert-create-volume-toggle.png`,
`webull-alert-create-news-toggle.png`

- **Desktop workspace**: 3-column layout — left: watchlist rail (ticker + mini
  sparkline + price + colored % change stacked in compact rows); center: chart +
  tabbed bottom panel (positions/orders/news); right: quote panel + order entry +
  time & sales. Everything is a dockable widget; "Add Widgets" gallery lets users
  compose layouts (`webull-desktop-widget-layout-builder.png`).
- **Alerts creation lives on the asset page** (bell icon), not a global form. The
  create screen (`webull-alert-create-*.png`): sticky symbol header with live price +
  master on/off toggle; "Quotes / Technical" tab split; then rule sections — Price
  ("Price below ▾ | 130 | toggle", plus "+ Add Alert" to stack more rules), Price
  Movement (preset toggles: "Sharp Rise — rose by 3% within 5 minutes", "Hit a New
  52 Week High"), Volume ("Volume Above ___ K"), News (one toggle). Alerts are
  toggles-with-parameters, not a wizard. Repeat ("Alert me only once / every time")
  is a per-rule option.
- **Global alert management** is tucked away: Menu → Shortcuts → My Alerts lists all
  working alerts. Contextual creation, central management.

### Yahoo Finance (web + mobile, portfolio tracker — closest feature set to OpenCandle)
Images: `yahoofinance-portfolio-header-holdings.png`,
`yahoofinance-asset-detail-key-stats.png`, `yahoofinance-market-indices-tiles.png`,
`yahoofinance-news-feed.png`

- **Portfolio screen**: "PORTFOLIOS" section header → big total value with green/red
  delta line ("+$1,250.35 (+0.78%) Today") → range pills (1D/5D/1M/6M/YTD/1Y/All) →
  area chart → named portfolio subsection ("Robinhood stocks" with its own value +
  delta) → holdings rows: ticker + name left, mini sparkline middle, price + change
  chip (solid red/green rounded rect) right. Multiple portfolios stack vertically on
  one screen.
- **Web portfolio table**: user-customizable column views — pick up to 16 of ~65
  fields (incl. Cost Basis), drag to reorder, save as named views with a tab strip
  above the table. Lots: 2024 redesign added transaction recording (Buy/Sell/
  Sell-Short/Buy-to-Cover) with automatic FIFO lot management and automatic dividend
  tracking. Lots are entered/viewed per-holding, not shown in the main table.
- **Asset detail** (`yahoofinance-asset-detail-key-stats.png`): price + delta +
  market-state line ("Market open ... at 3:30 PM EDT") → chart with prior-close
  dashed reference line → range pills → "Summary / Analysis / Financials" tabs →
  KEY STATISTICS card where the 52-week range is a slider bar with current price
  marked, then Previous Close / Open / Volume / Avg Volume as label-value pairs.
- **Markets strip** (`yahoofinance-market-indices-tiles.png`): index tiles with mini
  charts + a "US MARKETS CLOSE IN 2H 24M" countdown — market-session status as a
  first-class element.

### Fidelity (desktop-first brokerage; deepest lot/cost-basis disclosure)
Image: `fidelity-home-accounts-summary.jpg`

- **Home**: horizontal "Markets" ticker tile strip (DJIA/NASDAQ/S&P with deltas and
  as-of timestamp) above an accounts summary card — total value, "↗ +$275.00 (+0.31%)
  today / Today's Gain/Loss", range tabs (1M/YTD/1Y/3Y) and a value-over-time line
  chart with y-axis labels, then per-account rollup rows.
- **Positions page (web)**: classic data table. Each position row has a +/- expander
  at far left; expanding reveals the individual tax lots inline (acquired date,
  quantity, cost basis per lot, gain/loss per lot). "Expand All / Collapse All"
  control at table level. Lots are also reachable via an Action dropdown ("View
  Lots") on each row. Splitting/editing lots is a separate flow that adds rows with
  a "Quantity Remaining" counter. This inline expander-row pattern is the canonical
  lots-progressive-disclosure for desktop.

### Interactive Brokers (desktop + mobile pro tool)
Images: `ibkr-mobile-watchlist-columns.jpg`, `ibkr-mobile-symbol-search.jpg`,
`ibkr-mobile-watchlist-actions-menu.jpg`, `ibkr-mobile-advanced-scanner-form.jpg`,
`ibkr-mobile-scanner-actions-menu.jpg`

- **Watchlist** (`ibkr-mobile-watchlist-columns.jpg`): dense table even on mobile —
  Instrument | Last | Change | Change % | Volume column headers; red/green text on
  values; position info (Pos/FX P&L) inlined as a second muted line under owned
  symbols; watchlists organized as tabs ("My Favorites", "+New List"). Tap a column
  header to sort, tap again to flip direction. Tap a row → expands a thumbnail chart
  inline within the row; tap again → full instrument detail. Two-stage drill-in.
- **Watchlist actions** are one sheet (`ibkr-mobile-watchlist-actions-menu.jpg`): Add
  Instrument, Edit, New Watchlist, New Advanced Scanner, Manage Watchlists/Tabs/
  Columns, Sync Columns toggle (watchlists + column sets sync across desktop/mobile/
  web via a Watchlist Library).
- **Scanners are sibling objects of watchlists** — a scanner result page can be saved
  as a watchlist (`ibkr-mobile-scanner-actions-menu.jpg`). Scanner form is a long
  label/field list (Avg Volume Above, Change % Above, EMA(20) Below...) with a "Run
  Scanner" button.
- Portfolio screen shows daily P&L, net liquidity, market value, realized/unrealized
  per position; multi-column sorting.

---

## Patterns worth stealing

### Watchlist
1. **Row grammar (consumer)**: [ticker bold + name muted] — [sparkline] — [price +
   change chip]. Color-filled chips (Robinhood/Yahoo) read faster than colored text
   at glance distance; colored plain text (TradingView/IBKR) wins at high density.
   For OpenCandle's research-desk density, use colored text in tables, chips only in
   summary cards.
2. **Master-detail rail (TradingView)** — desktop-first gold standard: watchlist as a
   persistent right/left rail; selecting a row populates a detail pane (chart, range
   slider bars, key stats, news blurb) without navigation. Far better for a research
   tool than mobile-style row → new-page navigation.
3. **Live updates, never a refresh button**: stream/poll quietly; signal freshness
   with cell flash on change (TradingView), an "as of" timestamp (Fidelity), or
   "Updated Xm ago" in the list header (Robinhood). Show market-session state
   explicitly (open dot, "closes in 2h 24m" countdown).
4. **Sections inside one list** (TradingView) beat many separate lists; collapsible
   group headers ("STOCKS", "ETFS", user sections).
5. **Typeahead add dialog** with asset-class filter pills and a "+" per result row so
   multiple adds don't close the dialog.
6. **Column-set switcher** (TradingView Price/Performance/Risk/Technicals; Yahoo
   saved custom views): one table, multiple saved column presets, tab strip above.
7. **Watchlist-derived report tabs** (TradingView Earnings/Dividends/News tabs over
   the same symbol set) — this is exactly OpenCandle's daily watchlist report: same
   rows, different lens, grouped "Today / Next 14 days".

### Portfolio
1. **Universal header stack**: total value (biggest type on the page) → one delta
   line "▲ $X (Y%) Today" → optional second line for total return → range pills →
   value-over-time chart. Every app (Robinhood, Coinbase, Yahoo, Fidelity) uses this
   exact order. Chart legend = header (scrubbing updates the header numbers).
2. **Rollup before holdings** (Coinbase asset classes; Fidelity accounts): group
   summary rows with chevrons before the flat holdings list. OpenCandle equivalents:
   per-portfolio rollups, or equity/ETF/crypto class rollups.
3. **Lots via inline row expander** (Fidelity): holdings table rows expand with +/-
   to show tax lots (date, qty, cost/lot, G/L per lot); "Expand all" at table level.
   Best desktop pattern — keeps lots out of the default view but zero clicks away.
   Mobile alternative: lots behind the holding's detail sheet.
4. **Don't show by default**: cost basis columns (Yahoo hides behind custom views),
   realized vs unrealized split, per-lot data, dividend history. Default view =
   symbol, qty, price, market value, day change, total G/L.
5. **Allocation donut** (Robinhood Strategies) only as a secondary card, never the
   hero — the time-series chart is always the hero.

### Alerts
1. **Create contextually, manage centrally** (Webull, TradingView): creation entry
   points live on the asset page (bell icon) and on watchlist rows / chart price
   levels; a single global Alerts page/panel lists everything. Never force users to
   a global "new alert" form that starts with picking a symbol.
2. **Alert = toggle with parameters** (Webull): sticky symbol header with live price
   + master toggle; rule rows like "Price below ▾ [130] [toggle]"; "+ Add Alert" to
   stack rules; preset semantic toggles ("Sharp rise: 3% in 5 min", "New 52-wk
   high"). Tabs split simple (Quotes) from advanced (Technical) rules.
3. **Status dot vocabulary** (TradingView): green = active, orange = fired/paused,
   red = stopped/expired; pause/resume/edit/delete inline per row.
4. **Hard split active-vs-history**: active alerts list + separate fired-events
   "Alerts Log" (timestamped, exportable). OpenCandle's alert events table maps to
   the log directly.
5. **Alert levels drawn on the chart** and draggable (TradingView) — aspirational
   but high-value for a desktop research tool.

### Asset detail (watchlist row destination)
Vertical stack, consistent across all seven apps: identity (ticker/name/exchange) →
price + day delta (+ after-hours delta) → chart with prior-close reference line →
range pills → tabbed sections (Summary/Analysis/Financials or Overview/Earnings/News)
→ "Your position" (only if held; Coinbase adds "% of portfolio") → key stats grid
(52-wk range as slider bar with current marker — TradingView, Yahoo) → news → deep
links (advanced chart, filings). Position context belongs on the asset page.

### Desktop-first (OpenCandle) vs mobile-first
- Steal from **TradingView/Fidelity/IBKR/Webull-desktop**: persistent watchlist rail
  + detail pane, real tables with sortable headers + column presets, inline row
  expanders for lots, dockable/secondary panels, alert log panel, density toggles.
- Steal from **Robinhood/Coinbase/Yahoo-mobile** only the summary-header grammar
  (big number → delta line → chart → pills), the row grammar with sparklines, chip
  color language, and predictions-as-holdings-list (Coinbase) — these survive on
  OpenCandle's mobile breakpoint.
- Avoid on desktop: one-column card stacks, bottom-tab navigation, full-screen
  modal flows for things a popover/inline expander can do.
