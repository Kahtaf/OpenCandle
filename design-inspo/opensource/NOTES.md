# Open-source design inspiration — watchlists, portfolios, alerts, reports, predictions

Research date: 2026-06-12. All screenshots in this directory were verified as real images.
Sources: GitHub READMEs, project marketing sites, and live screenshots of the Ghostfolio
public demo (ghostfol.io) captured with agent-browser at 1440x900.

---

## Ghostfolio (ghostfol.io, github.com/ghostfolio/ghostfolio) — Angular, dark theme

The closest analog to OpenCandle's market-state pages: it has literally the same nav
(Overview / Holdings / Summary / Watchlist / Markets + Portfolio: Analysis / Activities /
Allocations / X-ray). Live-demo screenshots captured here.

- **Overview** (`ghostfolio-home-overview.png`): radically minimal. Full-bleed line chart of
  portfolio value with gradient fill, then one huge centered number (total value) with
  abs/% change in green underneath, then a `Today | YTD | 1Y | 5Y | Max` segmented range
  control. No table, no cards. The number IS the page.
- **Holdings** (`ghostfolio-holdings.png`): centered page title, then a single full-width
  table: logo icon + Name with ticker as gray subtext on a second line | First Activity |
  Quantity | Value | Allocation % (sortable, default sort) | Change (abs, green/red with
  +/- prefix) | Performance %. Active/Closed segmented pill filter top-right, table/grid
  view toggle top-left. No card chrome around the table — just row dividers.
- **Watchlist** (`ghostfolio-watchlist.png`): same table treatment with columns
  Name | Last All Time High | Change from All Time High (i.e. drawdown-from-ATH as the
  headline watchlist metric, not day change). Empty demo state shows a skeleton shimmer
  row, not a "no data" box.
- **Markets** (`ghostfolio-markets.png`): Fear & Greed line chart for last 365 days with
  Greed/Fear axis labels, current mood as emoji + "Fear 32/100" lockup, then the
  benchmarks table (Name | Last ATH | Change from ATH) below.
- **Portfolio > Analysis** (`ghostfolio-analysis.png`): three stat cards in a row (Total
  amount / Change with currency effect / Performance %), then a Performance chart with a
  "Compare with… Nasdaq-100" benchmark dropdown overlaying portfolio vs benchmark lines.
- **Portfolio > Allocations** (`ghostfolio-allocations.png`): full-width "Proportion of Net
  Worth 100%" progress bar card, then a 3-up grid of donut charts (By Platform / By
  Currency / By Asset Class), then a large "By Holding" pie with ticker labels. Donuts are
  unlabeled until hover — clean but low-info.
- **Portfolio > Activities** (`ghostfolio-activities.png`): transaction table with a colored
  type chip per row (BUY etc.), Date, Quantity, Unit Price, Fee, Value, Currency, Account.
  This is the tax-lot ledger pattern.
- **X-ray** (`ghostfolio-xray.png`): rule-based portfolio static analysis. Header summary
  "7 out of 16 rules align with your portfolio", then rules grouped by category (Liquidity,
  Emergency Fund, Currency Cluster Risks, Asset Class Cluster Risks…), each rule = status
  icon (green check / red warning triangle) + bold rule name + one-sentence plain-English
  finding with the actual numbers inline ("Over 50% of your current investment is in USD
  (94.9%)"). **Directly reusable as an alerts/predictions status list.**
- `ghostfolio-mobile-mockup.png`: README phone mockup — chart + big number + bottom tab bar
  (3 icons) is the whole mobile app.

## Wealthfolio (wealthfolio.app, github.com/wealthfolio/wealthfolio) — Tauri + React + shadcn, light cream theme

Best visual match for OpenCandle's light "research desk" aesthetic (warm cream background,
olive/sage accent, monospace numerals, soft rounded cards).

- **Main layout** (`wealthfolio-overview.webp`, `wealthfolio-holdings-landing.png`): thin
  icon-only left rail; content starts with pill tabs (Investments / Net Worth / Spending),
  then big-number header (value + abs/% change + "past 3 months") over a soft area chart
  with range pills (1D…ALL) under the chart; below, two columns: Accounts list (cards with
  name, sub-count, value, green/red delta) and Holdings list (logo, ticker, shares,
  value, signed % chip). Mobile = same stack, bottom tab bar.
- **Performance** (`wealthfolio-performance-dashboard.png`): comparison chips ("All
  Portfolio ×", "S&P 500 ×", + Add account, + Add Benchmark) above a multi-line % return
  chart; stat strip across the top of the card: Time-Weighted Return / Annualized /
  Volatility / Max Drawdown (red) / Period Gain (green).
- **Portfolio insights** (`wealthfolio-portfolio-insights.png`): top stat band (Portfolio
  Value / Cash Balance / Invested with per-currency breakdown chips), 4-up half-donut
  gauges (Accounts / Classes / Regions / Sectors) each with center label + dominant
  segment %, a treemap "Composition" (size = weight, green/red = daily move, Daily/Total
  toggle) and a right rail "Target Allocation" with per-class progress bars, drift in
  signed pp, and "Suggested Moves" (Trim Cash -$257K…). The drift + suggested-moves rail
  is a great prediction/recommendation surface.
- **Allocation targets / rebalance** (`wealthfolio-allocation-targets-stack.png`): target vs
  actual table with progress bars and signed deltas, projected cash to invest, and a
  "Rebalance" CTA.
- `wealthfolio-investments-tracking.png`, `wealthfolio-income-tracking.png`,
  `wealthfolio-networth-landing.png`: more of the same system at different sizes.

## Maybe Finance (github.com/maybe-finance/maybe, archived) — Rails + Hotwire, light theme

- **Dashboard** (`maybe-dashboard.png`): two sidebars — far-left icon rail (Home /
  Transactions / Budgets), then an accounts sidebar with collapsible groups (Cash,
  Investments, Crypto…) each showing value + tiny sparkline + % change. Main column:
  "Welcome back" header with prominent black "+ New" button; Net Worth card = label,
  big number, "$44,014.97 (↑6.1%) vs. last month" in green, single-color line chart,
  30D dropdown top-right; Assets card = horizontal stacked allocation bar with colored
  per-class legend (Cash 21% · Investments 42%…), then a table NAME | WEIGHT | VALUE where
  weight renders as a mini vertical-bar gauge + %. Expandable chevron rows for drill-down.
- Pattern note: the stacked bar + legend + weight-gauge table is a lighter-weight,
  scannable alternative to donut charts.

## OpenBB Workspace (openbb.co, github.com/OpenBB-finance/OpenBB) — dense pro dashboards

- **Equity dashboard** (`openbb-equity-dashboard.png`,
  `openbb-equity-dashboard-copilot.png`): grid of independent widgets, each with its own
  title bar, ticker-symbol param chip, and toolbar: Ticker Information (sparkline + price +
  day change), Key Metrics (label/value rows), Price Performance, full candlestick chart
  with volume, Management table, Revenue by segment stacked bars. Everything is
  per-widget-parameterized; a copilot chat panel docks on the right without displacing the
  grid. The whole screen is a composable workspace, not a fixed page.
- **Template gallery** (`openbb-template-gallery.png`): dashboards ship as named templates
  (Equity, Analyst, Comparison, Charting, Earnings…) in a card gallery — a clean way to
  present "report types".
- Their README images were architecture diagrams (discarded); these come from
  docs.openbb.co/workspace.

## Portfolio Performance (portfolio-performance.info) — Java/SWT desktop, light theme

- **Desktop** (`portfolio-performance-desktop.png`): classic master-detail: left tree nav
  (Securities / Accounts / Reports > Performance / Taxonomies) with the report canvas on
  the right; the dashboard is a year-by-year column grid where each year repeats the same
  KPI cells (mini performance chart, True Time-Weighted Return %, Delta, per-portfolio
  returns) colored green/red. Dense, spreadsheet-like, very information-first.
- **Mobile** (`portfolio-performance-mobile.png`): holdings donut + simple list.
- Takeaway: the repeated-KPI-grid works well for "daily report history" comparison views.

## Stocknear (github.com/stocknear/frontend, stocknear.com) — SvelteKit + Tailwind, dark

- Could NOT capture: repo README has no screenshots and stocknear.com sits behind a
  Cloudflare bot challenge that blocked automated capture. From the repo: SvelteKit +
  Tailwind (`components.json` = shadcn-svelte), i18n, Playwright tests. Site is a dense,
  dark, table-heavy stock research product (screener, options flow, dark pool data,
  watchlists with login). Worth a manual visit in a normal browser for dense-table
  reference; no local images included.

## TradingView lightweight-charts (tradingview.github.io/lightweight-charts)

- `lightweight-charts-landing.png`: docs landing showing the default chart style — thin
  baseline/area series, right-side price scale, sparse time axis, crosshair. The library
  (45KB, MIT-ish license w/ attribution) is the obvious candidate for OpenCandle inline
  sparklines and price/alert charts; plugin examples include price lines, alert markers
  (`createPriceLine` with title) and series markers usable for alert-trigger and
  prediction-outcome annotations.

---

## Downloaded file inventory

| File | What it shows |
|---|---|
| ghostfolio-home-overview.png | Overview: chart + giant total number + range pills |
| ghostfolio-holdings.png | Holdings table (name+ticker, value, allocation %, change) |
| ghostfolio-watchlist.png | Watchlist table columns + skeleton empty state |
| ghostfolio-markets.png | Fear & Greed chart + market mood lockup |
| ghostfolio-analysis.png | 3 stat cards + benchmark-compare performance chart |
| ghostfolio-allocations.png | Net-worth bar + 3-up donuts + by-holding pie |
| ghostfolio-activities.png | Activity ledger with BUY type chips (lot history) |
| ghostfolio-xray.png | Rule-check list with pass/warn icons (alerts-style) |
| ghostfolio-mobile-mockup.png | Mobile: chart + number + bottom tabs |
| wealthfolio-overview.webp | Desktop+mobile shell, accounts/holdings columns |
| wealthfolio-holdings-landing.png | Same, hi-res |
| wealthfolio-networth-landing.png | Net worth view, hi-res |
| wealthfolio-performance-dashboard.png | Benchmark chips + return/vol/drawdown stat strip |
| wealthfolio-portfolio-insights.png | Half-donut gauges, treemap, target-drift rail |
| wealthfolio-allocation-targets-stack.png | Target vs actual + rebalance flow |
| wealthfolio-investments-tracking.png | Investments tab w/ holdings rail |
| wealthfolio-income-tracking.png | Income view |
| maybe-dashboard.png | Net worth card + stacked allocation bar + weight table |
| openbb-equity-dashboard.png | Dense widget-grid equity dashboard |
| openbb-equity-dashboard-copilot.png | Same + docked AI copilot panel |
| openbb-template-gallery.png | Dashboard template card gallery |
| portfolio-performance-desktop.png | Tree nav + per-year KPI report grid |
| portfolio-performance-mobile.png | Mobile holdings donut/list |
| lightweight-charts-landing.png | Default lightweight-charts chart style |

## Patterns worth stealing

1. **Big-number hero header** (Ghostfolio, Wealthfolio, Maybe): every portfolio/watchlist
   page leads with one dominant value + signed abs/% change + time-range pills over a soft
   area chart. OpenCandle's portfolio page should lead with total value/P&L this way.
2. **Two-line name cell** (Ghostfolio, Wealthfolio): logo/avatar + company name with ticker
   in muted small caps underneath. Keeps tables narrow and scannable.
3. **Signed, colored deltas everywhere**: `+ 23,909.45` / `+ 87.07 %` green, `- 936.17` red,
   with explicit +/- prefixes, right-aligned, tabular numerals.
4. **Allocation as stacked bar + weight-gauge table** (Maybe) rather than only donuts —
   cheaper to render, easier to compare; keep donuts for class/sector breakdown (Ghostfolio
   3-up grid, Wealthfolio half-donut gauges with center label).
5. **X-ray rule list as the alerts/predictions pattern** (Ghostfolio): "N of M rules
   triggered" summary + grouped list of {status icon, bold rule name, one-sentence finding
   with live numbers}. Maps 1:1 to OpenCandle alert states (triggered / armed /
   unavailable) and prediction scorecards (hit / miss / open).
6. **Drift + suggested moves rail** (Wealthfolio): target vs actual progress bars with
   signed pp drift and concrete suggested actions — a strong template for prediction
   tracking and daily-report "what changed" sections.
7. **Type chips in ledgers** (Ghostfolio activities): colored BUY/SELL/DIV chips make tax-lot
   tables scannable; lot rows expand via chevron (Maybe) instead of separate pages.
8. **Per-widget dashboards with template gallery** (OpenBB): widgets own their params and
   toolbars; report types presented as a card gallery. Good for daily-report layouts and
   an eventual composable dashboard.
9. **Skeleton shimmer rows, no manual refresh buttons** (Ghostfolio, Wealthfolio): tables
   load with skeleton rows; quotes refresh in the background and rows update in place. No
   refresh buttons anywhere in any of these apps.
10. **Benchmark compare as removable chips** (Wealthfolio) or a single dropdown
    (Ghostfolio) on performance charts; stat strip (TWR / annualized / volatility / max
    drawdown / period gain) along the top of the chart card.
11. **Watchlist headline metric = distance from ATH** (Ghostfolio): an opinionated,
    decision-oriented column instead of generic day change; worth offering alongside
    day-change and target-vs-price columns.
12. **Mobile = same stack, bottom tab bar** (Ghostfolio, Wealthfolio): no separate mobile
    IA; the column layout collapses and primary nav moves to a 3-5 icon bottom bar.
