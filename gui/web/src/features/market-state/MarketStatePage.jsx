import {
  Activity,
  Bell,
  BriefcaseBusiness,
  FileText,
  ListPlus,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Target,
  TrendingUp,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Textarea } from "../../components/ui/textarea.jsx";
import { cn } from "../../lib/utils.js";
import { searchInstruments, useMarketState } from "../../hooks/useMarketState.jsx";
import { DesktopSidebarRestore, MobileHeader } from "../layout/AppShellChrome.jsx";
import { buildAlertRows } from "./alert-view-model.js";
import { TOOL_INVOKE_TIMEOUT_MESSAGE } from "../../hooks/useGuiConnection.jsx";

const PAGE_META = {
  watchlists: {
    label: "Watchlists",
    title: "Watchlists",
    subtitle: "Saved tickers, thesis notes, targets, stops, quotes, and linked alert context.",
    primaryLabel: "Add ticker",
    primaryPanel: "watchlist-add",
    searchLabel: "Search saved symbols",
  },
  portfolios: {
    label: "Portfolios",
    title: "Portfolios",
    subtitle: "Holdings, allocation coverage, quote freshness, and portfolio-level context.",
    primaryLabel: "Add holding",
    primaryPanel: "holding-add",
    searchLabel: "Search holdings",
  },
  alerts: {
    label: "Alerts",
    title: "Alerts",
    subtitle: "Alert rules, local monitoring status, check history, events, and notifications.",
    primaryLabel: "Create alert",
    primaryPanel: "alert-create",
    searchLabel: "Search alert rules",
  },
  reports: {
    label: "Reports",
    title: "Reports",
    subtitle: "Morning report generation, schedule configuration, run history, and delivery state.",
    primaryLabel: "Generate today",
    searchLabel: "Search report history",
  },
  predictions: {
    label: "Predictions",
    title: "Thesis Tracker",
    subtitle: "Saved research expectations to revisit, resolve, and connect back to market state.",
    primaryLabel: "Record thesis",
    primaryPanel: "thesis-record",
    searchLabel: "Search theses",
  },
};

const DOMAINS = Object.keys(PAGE_META).map((id) => ({ id, label: PAGE_META[id].label }));
const EMPTY_ACTIONS = [];
const UNSUPPORTED_MUTATION_FALLBACK_MESSAGE = "Market-state mutations require acknowledged tool invocation support. Reconnect the GUI and try again.";

export async function invokeMarketStateMutation({
  readOnly,
  toolName,
  args,
  invokeToolRequest,
  setToast,
  refresh,
  setPendingMutation,
}) {
  if (readOnly) {
    setToast?.("This GUI session is read-only until it reconnects as the writer.", { destructive: true });
    return false;
  }
  setPendingMutation?.({ toolName });
  try {
    if (typeof invokeToolRequest !== "function") {
      throw new Error(UNSUPPORTED_MUTATION_FALLBACK_MESSAGE);
    }
    await invokeToolRequest(toolName, args);
    await refresh();
    return true;
  } catch (mutationError) {
    const message = mutationError instanceof Error ? mutationError.message : String(mutationError);
    const stillRunning = message === TOOL_INVOKE_TIMEOUT_MESSAGE;
    setToast?.(message, {
      destructive: !stillRunning,
      title: stillRunning ? "Operation still running" : "Tool failed",
    });
    return false;
  } finally {
    setPendingMutation?.(null);
  }
}

export function MarketStatePage({ domain, role, send, invokeTool: invokeToolRequest, navigate, setToast, onOpenSidebar, sidebarCollapsed = false, onExpandSidebar }) {
  const { state, loading, error, refresh, refreshQuotes } = useMarketState();
  const readOnly = role !== "writer";
  const active = PAGE_META[domain] ?? PAGE_META.watchlists;
  const activeId = PAGE_META[domain] ? domain : "watchlists";
  const [filter, setFilter] = useState("");
  const [panel, setPanel] = useState(null);
  const [pendingMutation, setPendingMutation] = useState(null);
  const panelOpenerRef = useRef(null);
  const mutationPending = Boolean(pendingMutation);

  const invokeTool = async (toolName, args) => {
    return invokeMarketStateMutation({
      readOnly,
      toolName,
      args,
      invokeToolRequest,
      setToast,
      refresh,
      setPendingMutation,
    });
  };

  const openPanel = (type, data) => {
    panelOpenerRef.current = typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setPanel({ type, data });
  };
  const closePanel = () => {
    const opener = panelOpenerRef.current;
    setPanel(null);
    panelOpenerRef.current = null;
    window.setTimeout(() => {
      if (opener?.isConnected) opener.focus();
    }, 0);
  };
  const canRefreshPrices = activeId === "watchlists" || activeId === "portfolios" || activeId === "alerts";

  const primaryAction = () => {
    if (activeId === "reports") {
      invokeTool("daily_watchlist_report", { action: "run" });
      return;
    }
    openPanel(active.primaryPanel);
  };

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <MobileHeader onOpenSidebar={onOpenSidebar} />
      {sidebarCollapsed ? <DesktopSidebarRestore onExpandSidebar={onExpandSidebar} /> : null}
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-3">
          <PageHeader
            meta={active}
            loading={loading}
            readOnly={readOnly || mutationPending}
            onPrimary={primaryAction}
          />
          <PageToolbar
            meta={active}
            filter={filter}
            setFilter={setFilter}
            loading={loading}
            readOnly={readOnly}
            mutationPending={mutationPending}
            canRefreshPrices={canRefreshPrices}
            onRefresh={refresh}
            onRefreshPrices={refreshQuotes}
            onConfigureReport={() => openPanel("report-configure")}
            onRunAlertCheck={() => invokeTool("manage_alerts", { action: "check" })}
            onCheckTheses={() => invokeTool("track_prediction", { action: "check" })}
            activeId={activeId}
          />
          {error ? <StatusBand tone="error">{error}</StatusBand> : null}
          {mutationPending ? <StatusBand>Saving market-state change. Controls will unlock after the server acknowledges the operation.</StatusBand> : null}
          {readOnly ? <StatusBand>{readOnlyMessage(role)}</StatusBand> : null}
          <div className={cn(
            "grid min-h-0 gap-3",
            panel ? "xl:grid-cols-[minmax(0,1fr)_380px]" : "grid-cols-1",
          )}>
            <div className="flex min-w-0 flex-col gap-3">
              {activeId === "watchlists" ? <Watchlists state={state} filter={filter} readOnly={readOnly || mutationPending} openPanel={openPanel} invokeTool={invokeTool} /> : null}
              {activeId === "portfolios" ? <Portfolios state={state} filter={filter} setFilter={setFilter} readOnly={readOnly || mutationPending} openPanel={openPanel} invokeTool={invokeTool} navigate={navigate} /> : null}
              {activeId === "alerts" ? <Alerts state={state} filter={filter} readOnly={readOnly || mutationPending} openPanel={openPanel} invokeTool={invokeTool} /> : null}
              {activeId === "reports" ? <Reports state={state} filter={filter} readOnly={readOnly || mutationPending} invokeTool={invokeTool} /> : null}
              {activeId === "predictions" ? <Predictions state={state} filter={filter} readOnly={readOnly || mutationPending} openPanel={openPanel} invokeTool={invokeTool} /> : null}
            </div>
            {panel ? (
              <ContextPanel title={panelTitle(panel.type)} onClose={closePanel}>
                <PanelContent
                  panel={panel}
                  state={state}
                  readOnly={readOnly || mutationPending}
                  invokeTool={invokeTool}
                  closePanel={closePanel}
                />
              </ContextPanel>
            ) : null}
          </div>
        </div>
      </main>
    </section>
  );
}

function PageHeader({ meta, loading, readOnly, onPrimary }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-card px-4 py-3 shadow-subtle-xs">
      <div className="min-w-0">
        <h1 className="text-base font-semibold tracking-normal text-foreground">{meta.title}</h1>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{meta.subtitle}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          SQLite-backed local state. Last refresh updates automatically while the GUI is open.
        </p>
      </div>
      <Button
        type="button"
        variant="brand"
        size="sm"
        prefixIcon={Plus}
        disabled={readOnly || loading}
        onClick={onPrimary}
      >
        {meta.primaryLabel}
      </Button>
    </header>
  );
}

function PageToolbar({
  meta,
  filter,
  setFilter,
  loading,
  readOnly,
  mutationPending,
  canRefreshPrices,
  onRefresh,
  onRefreshPrices,
  onConfigureReport,
  onRunAlertCheck,
  onCheckTheses,
  activeId,
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 shadow-subtle-xs md:flex-row md:items-center md:justify-between">
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">{meta.searchLabel}</span>
        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
        <Input
          className="pl-9"
          placeholder={meta.searchLabel}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="bordered" size="sm" prefixIcon={RefreshCw} onClick={onRefresh} disabled={loading}>
          Refresh
        </Button>
        {canRefreshPrices ? (
          <Button variant="bordered" size="sm" prefixIcon={Activity} onClick={onRefreshPrices} disabled={loading || readOnly || mutationPending}>
            Refresh prices
          </Button>
        ) : null}
        {activeId === "reports" ? (
          <Button variant="bordered" size="sm" prefixIcon={SlidersHorizontal} disabled={readOnly || mutationPending} onClick={onConfigureReport}>
            Configure schedule
          </Button>
        ) : null}
        {activeId === "alerts" ? (
          <Button variant="bordered" size="sm" prefixIcon={Activity} disabled={readOnly || mutationPending} onClick={onRunAlertCheck}>
            Run check
          </Button>
        ) : null}
        {activeId === "predictions" ? (
          <Button variant="bordered" size="sm" prefixIcon={Activity} disabled={readOnly || mutationPending} onClick={onCheckTheses}>
            Check theses
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Watchlists({ state, filter, readOnly, openPanel, invokeTool }) {
  const alertsByInstrument = useMemo(() => groupBy(state.alerts, "instrumentId"), [state.alerts]);
  const quotesByItem = useMemo(() => groupByOne(state.quoteSnapshot?.watchlistQuotes, "itemId"), [state.quoteSnapshot]);
  const rows = useMemo(() => filterItems(state.watchlist, filter, ["symbol", "name", "thesis", "notes", "tags"]), [state.watchlist, filter]);
  const staleCount = rows.filter((item) => quotesByItem.get(item.id)?.stale).length;
  const alertCount = rows.filter((item) => alertsByInstrument.get(item.instrumentId)?.length).length;

  return (
    <>
      <SummaryStrip
        items={[
          ["Symbols", rows.length],
          ["With alerts", alertCount],
          ["Stale quotes", staleCount],
        ]}
      />
      <Panel title="Default Watchlist" count={rows.length}>
        {rows.length === 0 ? (
          <EmptyState
            icon={ListPlus}
            title={state.watchlist.length === 0 ? "No tickers yet" : "No symbols match this search"}
            action="Use Add ticker to start the default watchlist, then add thesis notes, targets, stops, and tags."
            cta={{
              label: "Add ticker",
              disabled: readOnly,
              onClick: () => openPanel("watchlist-add"),
            }}
          />
        ) : (
          <DataTable
            columns={["Symbol", "Quote", "Freshness", "Target", "Stop", "Thesis", "Tags", "Alert status", "Actions"]}
            rows={rows.map((item) => ({
              key: item.id,
              cells: [
                <TickerCell key="symbol" symbol={item.symbol} sub={item.name || item.exchange || item.assetType} />,
                quoteCell(quotesByItem.get(item.id)),
                quoteFreshness(quotesByItem.get(item.id)),
                moneyOrDash(item.targetPrice),
                moneyOrDash(item.stopPrice),
                item.thesis || "N/A",
                item.tags?.length ? item.tags.join(", ") : "N/A",
                alertStatus(alertsByInstrument.get(item.instrumentId)),
                <RowActions
                  key="actions"
                  disabled={readOnly}
                  actions={[
                    { label: "Details", readOnlySafe: true, onClick: () => openPanel("watchlist-detail", { item }) },
                    ["Edit", () => openPanel("watchlist-edit", { item })],
                    ...buildWatchlistRowActions(item, invokeTool),
                  ]}
                />,
              ],
            }))}
          />
        )}
      </Panel>
    </>
  );
}

function Portfolios({ state, filter, setFilter, readOnly, openPanel, invokeTool, navigate }) {
  const quotesByLot = useMemo(() => groupByOne(state.quoteSnapshot?.portfolioQuotes, "lotId"), [state.quoteSnapshot]);
  const rows = useMemo(() => filterItems(state.portfolio, filter, ["id", "symbol", "notes", "currency"]), [state.portfolio, filter]);
  const summary = state.quoteSnapshot?.portfolioSummary;
  const totalCost = state.portfolio.reduce((sum, lot) => sum + (Number(lot.quantity) * Number(lot.avgCost)), 0);
  const staleCount = rows.filter((lot) => quotesByLot.get(lot.id)?.stale).length;

  return (
    <>
      <SummaryStrip
        items={[
          ["Holdings", rows.length],
          ["Total value", summary ? moneyWithCurrency(summary.totalValue, summary.baseCurrency) : "Not checked"],
          ["P&L", summary ? moneyWithCurrency(summary.totalPnl, summary.baseCurrency) : totalCost > 0 ? `Cost basis $${totalCost.toFixed(2)}` : "N/A"],
          ["Stale quotes", staleCount],
        ]}
      />
      <Panel title="Default Portfolio" count={rows.length}>
        {rows.length === 0 ? (
          <EmptyState
            icon={BriefcaseBusiness}
            title={state.portfolio.length === 0 ? "No holdings yet" : "No holdings match this search"}
            action="Add a holding when you are ready, or keep using watchlists without a portfolio."
            cta={{
              label: state.portfolio.length === 0 ? "Skip For Now" : "Clear search",
              onClick: state.portfolio.length === 0 ? () => navigate?.({ to: "/watchlists" }) : () => setFilter(""),
            }}
          />
        ) : (
          <DataTable
            columns={["Lot", "Symbol", "Quantity", "Avg cost", "Current", "Value", "Allocation", "P&L", "Quote", "Currency", "Actions"]}
            rows={rows.map((lot) => {
              const quote = quotesByLot.get(lot.id);
              return {
                key: lot.id,
                cells: [
                  `#${lot.id}`,
                  <TickerCell key="symbol" symbol={lot.symbol} sub={lot.exchange || lot.assetType} />,
                  formatNumber(lot.quantity),
                  moneyOrDash(lot.avgCost),
                  portfolioCurrentCell(quote),
                  portfolioValueCell(quote),
                  allocationCell(quote),
                  portfolioPnlCell(quote),
                  quoteFreshness(quote),
                  lot.currency,
                  <RowActions
                    key="actions"
                    disabled={readOnly}
                    actions={[
                      { label: "Details", readOnlySafe: true, onClick: () => openPanel("holding-detail", { lot }) },
                      ["Edit", () => openPanel("holding-edit", { lot })],
                      ["Remove", () => invokeTool("track_portfolio", { action: "remove", lot_id: lot.id })],
                    ]}
                  />,
                ],
              };
            })}
          />
        )}
        {summary?.excludedFromTotals?.length ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Excluded from totals: {summary.excludedFromTotals.map((row) => `${row.symbol} (${row.reason})`).join(", ")}
          </p>
        ) : null}
      </Panel>
    </>
  );
}

function Alerts({ state, filter, readOnly, openPanel, invokeTool }) {
  const alertRows = useMemo(() => buildAlertRows(state.alerts, state.alertEvents), [state.alerts, state.alertEvents]);
  const rows = useMemo(() => filterItems(alertRows, filter, ["rule", "scope", "mode", "status"]), [alertRows, filter]);
  const runner = state.runnerLease;
  const unreadCount = state.notifications.filter((notification) => notification.status !== "acknowledged").length;

  return (
    <>
      <SummaryStrip
        items={[
          ["Monitoring", runner ? "Running locally" : "Manual only"],
          ["Owner", runner?.ownerKind || "N/A"],
          ["Last check", rows.find((row) => row.lastChecked !== "N/A")?.lastChecked || "N/A"],
          ["Unread notifications", unreadCount],
        ]}
      />
      <Panel title="Alert Rules" count={rows.length}>
        {rows.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={state.alerts.length === 0 ? "No alerts yet" : "No alert rules match this search"}
            action="Create an alert rule, then run checks manually or with the local runner while OpenCandle is open."
            cta={{
              label: "Create alert",
              disabled: readOnly,
              onClick: () => openPanel("alert-create"),
            }}
          />
        ) : (
          <DataTable
            columns={["Rule", "Scope", "Mode", "Last checked", "Last observed", "Latest event", "Status", "Actions"]}
            rows={rows.map((row) => ({
              key: row.id,
              cells: [
                row.rule,
                row.scope,
                row.mode,
                row.lastChecked,
                row.lastObserved,
                row.latestEvent,
                row.status,
                <RowActions
                  key="actions"
                  disabled={readOnly}
                  actions={[
                    { label: "Details", readOnlySafe: true, onClick: () => openPanel("alert-detail", { row }) },
                    [row.toggleLabel, () => invokeTool("manage_alerts", { action: "set_enabled", id: row.id, enabled: !row.enabled })],
                  ]}
                />,
              ],
            }))}
          />
        )}
      </Panel>
      <Panel title="Alert Events" count={state.alertEvents.length}>
        {state.alertEvents.length === 0 ? (
          <EmptyState icon={Bell} title="No alert events" action="Alert firings, stale evaluations, and manual check outcomes appear here." />
        ) : (
          <DataTable
            columns={["Observed", "Rule", "Source", "Status", "Message"]}
            rows={state.alertEvents.slice(0, 10).map((event) => ({
              key: event.id ?? `${event.alertRuleId}:${event.observedAt || event.triggeredAt}`,
              cells: [
                shortDate(event.observedAt || event.triggeredAt),
                `#${event.alertRuleId}`,
                event.sourceProvider || (event.instrumentId ? `#${event.instrumentId}` : "N/A"),
                event.status,
                event.message || "N/A",
              ],
            }))}
          />
        )}
      </Panel>
      <Panel title="Check Runs" count={state.alertCheckRuns.length}>
        {state.alertCheckRuns.length === 0 ? (
          <EmptyState icon={Activity} title="No check runs" action="Run a check to record automation history." />
        ) : (
          <DataTable
            columns={["Started", "Trigger", "Status", "Checked", "Triggered", "Unavailable"]}
            rows={state.alertCheckRuns.slice(0, 10).map((run) => ({
              key: run.id ?? run.startedAt,
              cells: [
                shortDate(run.startedAt),
                run.triggerType,
                run.status,
                run.checkedCount,
                run.triggeredCount,
                run.unavailableCount,
              ],
            }))}
          />
        )}
      </Panel>
      <NotificationsPanel
        title="Notifications"
        notifications={state.notifications}
        attempts={state.notificationDeliveryAttempts}
        readOnly={readOnly}
        invokeTool={invokeTool}
      />
    </>
  );
}

function Reports({ state, filter, readOnly, invokeTool }) {
  const reportNotifications = state.notifications.filter((notification) => notification.sourceType === "report_run");
  const reportRuns = useMemo(() => filterItems(state.reportRuns, filter, ["id", "triggerType", "status", "summaryJson"]), [state.reportRuns, filter]);
  const nextTemplate = state.reportTemplates.find((template) => template.enabled) ?? state.reportTemplates[0];
  const lastRun = state.reportRuns[0];

  return (
    <>
      <SummaryStrip
        items={[
          ["Next report", nextTemplate ? shortDate(nextTemplate.nextRunAt) : "Not configured"],
          ["Last report", lastRun ? `${lastRun.status} ${shortDate(lastRun.completedAt || lastRun.startedAt)}` : "No runs"],
          ["Templates", state.reportTemplates.length],
          ["Report notifications", reportNotifications.length],
        ]}
      />
      <Panel title="Morning Report" meta="Generate now or configure the existing local morning report schedule.">
        <div className="flex flex-wrap gap-2">
          <Button variant="brand" size="sm" prefixIcon={FileText} disabled={readOnly} onClick={() => invokeTool("daily_watchlist_report", { action: "run" })}>
            Generate today
          </Button>
          <Button variant="bordered" size="sm" disabled={readOnly} onClick={() => invokeTool("daily_watchlist_report", { action: "configure", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, local_time: "08:00" })}>
            Configure 08:00
          </Button>
        </div>
      </Panel>
      <Panel title="Report Templates" count={state.reportTemplates.length}>
        {state.reportTemplates.length === 0 ? (
          <EmptyState icon={FileText} title="No report template configured" action="Generate today's watchlist report, or configure the default morning schedule when you are ready." />
        ) : (
          <DataTable
            columns={["Name", "Type", "Cadence", "Local time", "Timezone", "Next run", "Status"]}
            rows={state.reportTemplates.map((template) => ({
              key: template.id ?? template.name,
              cells: [
                template.name,
                template.reportType,
                template.cadence,
                template.localTime,
                template.timezone,
                shortDate(template.nextRunAt),
                template.enabled ? "Enabled" : "Disabled",
              ],
            }))}
          />
        )}
      </Panel>
      <Panel title="Report Runs" count={reportRuns.length}>
        {reportRuns.length === 0 ? (
          <EmptyState icon={FileText} title="No reports generated" action="Generate today's watchlist report to create readable report history." />
        ) : (
          <DataTable
            columns={["Started", "Trigger", "Scheduled for", "Completed", "Status", "Summary"]}
            rows={reportRuns.map((run) => ({
              key: run.id ?? run.startedAt,
              cells: [
                shortDate(run.startedAt),
                run.triggerType,
                shortDate(run.scheduledFor),
                shortDate(run.completedAt),
                run.status,
                summarize(run.summaryJson),
              ],
            }))}
          />
        )}
      </Panel>
      <NotificationsPanel
        title="Report Notifications"
        notifications={reportNotifications}
        attempts={state.notificationDeliveryAttempts}
        readOnly={readOnly}
        invokeTool={invokeTool}
      />
    </>
  );
}

function Predictions({ state, filter, readOnly, openPanel, invokeTool }) {
  const rows = useMemo(() => filterItems(state.predictions, filter, ["symbol", "direction", "status", "thesis"]), [state.predictions, filter]);
  const dueSoonCount = rows.filter((prediction) => prediction.status === "open" && isDueSoon(prediction.expiresAt)).length;
  const resolvedCount = rows.filter((prediction) => prediction.status === "resolved" || prediction.status === "cancelled").length;

  return (
    <>
      <SummaryStrip
        items={[
          ["Open theses", rows.filter((prediction) => prediction.status === "open").length],
          ["Due soon", dueSoonCount],
          ["Resolved", resolvedCount],
        ]}
      />
      <Panel title="Thesis Tracker" count={rows.length}>
        {rows.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title={state.predictions.length === 0 ? "No theses recorded" : "No theses match this search"}
            action="Record a thesis as a saved research expectation to revisit later."
            cta={{
              label: "Record thesis",
              disabled: readOnly,
              onClick: () => openPanel("thesis-record"),
            }}
          />
        ) : (
          <DataTable
            columns={["Symbol", "Direction", "Conviction", "Entry", "Target", "Expires", "Status", "Actions"]}
            rows={rows.map((prediction) => ({
              key: prediction.id,
              cells: [
                <TickerCell key="symbol" symbol={prediction.symbol} />,
                prediction.direction,
                formatNumber(prediction.conviction),
                moneyOrDash(prediction.entryPrice),
                moneyOrDash(prediction.targetPrice),
                shortDate(prediction.expiresAt),
                prediction.status,
                <RowActions
                  key="actions"
                  disabled={readOnly}
                  actions={[
                    { label: "Details", readOnlySafe: true, onClick: () => openPanel("thesis-detail", { prediction }) },
                    {
                      label: "Cancel",
                      disabled: prediction.status !== "open",
                      onClick: () => invokeTool("track_prediction", { action: "cancel", id: prediction.id }),
                    },
                  ]}
                />,
              ],
            }))}
          />
        )}
      </Panel>
    </>
  );
}

function PanelContent({ panel, state, readOnly, invokeTool, closePanel }) {
  const item = panel.data?.item;
  const lot = panel.data?.lot;
  const row = panel.data?.row;
  const prediction = panel.data?.prediction;

  if (panel.type === "watchlist-add" || panel.type === "watchlist-edit") {
    return (
      <SymbolActionPanel
        key={`${panel.type}:${item?.id ?? item?.symbol ?? "new"}`}
        title={panel.type === "watchlist-add" ? "Add ticker" : "Edit ticker"}
        disabled={readOnly}
        initialSymbol={item?.symbol}
        fields={[
          { name: "target_price", label: "Target", type: "number", defaultValue: item?.targetPrice },
          { name: "stop_price", label: "Stop", type: "number", defaultValue: item?.stopPrice },
          { name: "thesis", label: "Thesis", multiline: true, defaultValue: item?.thesis },
          { name: "notes", label: "Notes", multiline: true, defaultValue: item?.notes },
          { name: "tags", label: "Tags", defaultValue: item?.tags?.join(", ") },
        ]}
        onSubmit={async (values) => {
          const saved = await invokeTool("manage_watchlist", {
            action: panel.type === "watchlist-add" ? "add" : "update",
            symbol: values.symbol,
            target_price: numberOrUndefined(values.target_price),
            stop_price: numberOrUndefined(values.stop_price),
            thesis: values.thesis || undefined,
            notes: values.notes || undefined,
            tags: parseTags(values.tags),
          });
          if (saved) closePanel();
          return saved;
        }}
      />
    );
  }

  if (panel.type === "watchlist-detail" && item) {
    const quote = groupByOne(state.quoteSnapshot?.watchlistQuotes, "itemId").get(item.id);
    return (
      <DetailStack
        rows={[
          ["Symbol", item.symbol],
          ["Name", item.name || "N/A"],
          ["Quote", quoteCell(quote)],
          ["Freshness", quoteFreshness(quote)],
          ["Target", moneyOrDash(item.targetPrice)],
          ["Stop", moneyOrDash(item.stopPrice)],
          ["Thesis", item.thesis || "N/A"],
          ["Notes", item.notes || "N/A"],
          ["Tags", item.tags?.join(", ") || "N/A"],
        ]}
        actions={[
          ["Remove", () => invokeTool("manage_watchlist", { action: "remove", symbol: item.symbol })],
        ]}
        readOnly={readOnly}
      />
    );
  }

  if (panel.type === "holding-add" || panel.type === "holding-edit") {
    return (
      <HoldingForm
        key={`${panel.type}:${lot?.id ?? "new"}`}
        disabled={readOnly}
        lot={lot}
        onSubmit={async (values) => {
          const saved = await invokeTool("track_portfolio", {
            action: lot ? "update" : "add",
            lot_id: lot?.id,
            symbol: values.symbol,
            shares: Number(values.shares),
            avg_cost: Number(values.avg_cost),
            currency: values.currency || undefined,
          });
          if (saved) closePanel();
          return saved;
        }}
      />
    );
  }

  if (panel.type === "holding-detail" && lot) {
    const quote = groupByOne(state.quoteSnapshot?.portfolioQuotes, "lotId").get(lot.id);
    return (
      <DetailStack
        rows={[
          ["Lot", `#${lot.id}`],
          ["Symbol", lot.symbol],
          ["Quantity", formatNumber(lot.quantity)],
          ["Average cost", moneyOrDash(lot.avgCost)],
          ["Current", portfolioCurrentCell(quote)],
          ["Value", portfolioValueCell(quote)],
          ["Allocation", allocationCell(quote)],
          ["P&L", portfolioPnlCell(quote)],
          ["Freshness", quoteFreshness(quote)],
          ["Currency", lot.currency],
          ["Notes", lot.notes || "N/A"],
        ]}
        actions={[
          ["Remove", () => invokeTool("track_portfolio", { action: "remove", lot_id: lot.id })],
        ]}
        readOnly={readOnly}
      />
    );
  }

  if (panel.type === "alert-create") {
    return <AlertCreateForm disabled={readOnly} invokeTool={invokeTool} onSaved={closePanel} />;
  }

  if (panel.type === "alert-detail" && row) {
    return (
      <DetailStack
        rows={[
          ["Rule", row.rule],
          ["Scope", row.scope],
          ["Mode", row.mode],
          ["Last checked", row.lastChecked],
          ["Last observed", row.lastObserved],
          ["Latest event", row.latestEvent],
          ["Status", row.status],
          ["Evaluation", "Manual checks and the local runner use the existing alert lifecycle semantics."],
        ]}
        actions={[
          [row.toggleLabel, () => invokeTool("manage_alerts", { action: "set_enabled", id: row.id, enabled: !row.enabled })],
        ]}
        readOnly={readOnly}
      />
    );
  }

  if (panel.type === "report-configure") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Configure the existing morning report schedule for 08:00 in this browser timezone. This does not add hosted scheduling.
        </p>
        <Button
          variant="brand"
          size="sm"
          disabled={readOnly}
          onClick={async () => {
            const saved = await invokeTool("daily_watchlist_report", {
              action: "configure",
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              local_time: "08:00",
            });
            if (saved) closePanel();
          }}
        >
          Configure 08:00
        </Button>
      </div>
    );
  }

  if (panel.type === "thesis-record") {
    return (
      <SymbolActionPanel
        key={panel.type}
        title="Record thesis"
        disabled={readOnly}
        fields={[
          { name: "direction", label: "Direction", placeholder: "bullish | bearish | neutral", required: true },
          { name: "conviction", label: "Conviction", type: "number", required: true },
          { name: "entry_price", label: "Entry", type: "number", required: true },
          { name: "target_price", label: "Target", type: "number" },
          { name: "timeframe_days", label: "Days", type: "number" },
        ]}
        onSubmit={async (values) => {
          const saved = await invokeTool("track_prediction", {
            action: "record",
            symbol: values.symbol,
            direction: values.direction || "bullish",
            conviction: Number(values.conviction),
            entry_price: Number(values.entry_price),
            target_price: numberOrUndefined(values.target_price),
            timeframe_days: numberOrUndefined(values.timeframe_days),
          });
          if (saved) closePanel();
          return saved;
        }}
      />
    );
  }

  if (panel.type === "thesis-detail" && prediction) {
    return (
      <DetailStack
        rows={[
          ["Symbol", prediction.symbol],
          ["Direction", prediction.direction],
          ["Conviction", formatNumber(prediction.conviction)],
          ["Entry", moneyOrDash(prediction.entryPrice)],
          ["Target", moneyOrDash(prediction.targetPrice)],
          ["Expires", shortDate(prediction.expiresAt)],
          ["Status", prediction.status],
          ["Thesis", prediction.thesis || "N/A"],
        ]}
        actions={[
          {
            label: "Cancel",
            disabled: prediction.status !== "open",
            onClick: () => invokeTool("track_prediction", { action: "cancel", id: prediction.id }),
          },
        ]}
        readOnly={readOnly}
      />
    );
  }

  return <p className="text-sm text-muted-foreground">Select a row or action to view details.</p>;
}

function ContextPanel({ title, onClose, children }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    node.focus({ preventScroll: true });
  }, [title]);

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className="rounded-md border border-border bg-card shadow-subtle-xs outline-none focus-visible:ring-2 focus-visible:ring-ring xl:sticky xl:top-0 xl:max-h-[calc(100vh-120px)] xl:overflow-y-auto"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <Button type="button" variant="ghost" size="xs" icon={X} tooltip="Close panel" aria-label="Close panel" onClick={onClose} />
      </div>
      <div className="p-4">{children}</div>
    </aside>
  );
}

export function SymbolActionPanel({ title, fields, disabled, initialSymbol = "", onSubmit }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((field) => [field.name, field.defaultValue ?? ""])));
  const [query, setQuery] = useState(initialSymbol);
  const [selected, setSelected] = useState(initialSymbol);
  const resolvedSymbol = selected || initialSymbol;

  const submit = async (event) => {
    event.preventDefault();
    if (!resolvedSymbol) return;
    const saved = await onSubmit({ ...values, symbol: resolvedSymbol });
    if (saved === false) return;
    setValues(Object.fromEntries(fields.map((field) => [field.name, field.defaultValue ?? ""])));
    setQuery(initialSymbol);
    setSelected(initialSymbol);
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {resolvedSymbol ? `Selected ${resolvedSymbol}` : "Search provider-backed candidates and select a resolved ticker before saving."}
        </p>
      </div>
      <SymbolSearchInput
        query={query}
        selected={selected}
        disabled={disabled || Boolean(initialSymbol)}
        onQueryChange={setQuery}
        onSelectedChange={setSelected}
      />
      <div className="grid gap-3">
        {fields.map((field) => (
          field.multiline ? (
            <Textarea
              key={field.name}
              aria-label={field.label}
              placeholder={field.label}
              value={values[field.name] || ""}
              disabled={disabled}
              required={field.required}
              onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
            />
          ) : (
            <Input
              key={field.name}
              aria-label={field.label}
              type={field.type || "text"}
              step={field.type === "number" ? "any" : undefined}
              placeholder={field.placeholder || field.label}
              value={values[field.name] || ""}
              disabled={disabled}
              required={field.required}
              onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
            />
          )
        ))}
      </div>
      <Button type="submit" variant="brand" disabled={disabled || !resolvedSymbol} prefixIcon={Target}>Save</Button>
    </form>
  );
}

export function HoldingForm({ disabled, lot, onSubmit }) {
  const [values, setValues] = useState({
    shares: lot?.quantity ?? "",
    avg_cost: lot?.avgCost ?? "",
    currency: lot?.currency ?? "USD",
  });
  const [query, setQuery] = useState(lot?.symbol ?? "");
  const [selected, setSelected] = useState(lot?.symbol ?? "");
  const resolvedSymbol = selected || lot?.symbol;

  const submit = async (event) => {
    event.preventDefault();
    if (!resolvedSymbol || !values.shares || !values.avg_cost) return;
    await onSubmit({ ...values, symbol: resolvedSymbol });
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
      <p className="text-xs text-muted-foreground">
        {resolvedSymbol ? `Selected ${resolvedSymbol}` : "Search provider-backed candidates and select a resolved ticker before saving."}
      </p>
      <SymbolSearchInput
        query={query}
        selected={selected}
        disabled={disabled || Boolean(lot)}
        onQueryChange={setQuery}
        onSelectedChange={setSelected}
      />
      <Input aria-label="Quantity" type="number" step="any" placeholder="Quantity" value={values.shares} disabled={disabled} required onChange={(event) => setValues((current) => ({ ...current, shares: event.target.value }))} />
      <Input aria-label="Average cost" type="number" step="any" placeholder="Avg cost" value={values.avg_cost} disabled={disabled} required onChange={(event) => setValues((current) => ({ ...current, avg_cost: event.target.value }))} />
      <Input aria-label="Currency" placeholder="Currency" value={values.currency} disabled={disabled} onChange={(event) => setValues((current) => ({ ...current, currency: event.target.value }))} />
      <Button type="submit" variant="brand" disabled={disabled || !resolvedSymbol || !values.shares || !values.avg_cost}>Save</Button>
    </form>
  );
}

export function SymbolSearchInput({ query, selected, disabled, onQueryChange, onSelectedChange }) {
  const inputId = useId();
  const listboxId = useId();
  const [candidates, setCandidates] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const visibleCandidates = query.trim().length >= 2 && !selected ? candidates : [];
  const clampedActiveIndex = clampComboboxActiveIndex(activeIndex, visibleCandidates.length);
  const activeCandidate = clampedActiveIndex >= 0 ? visibleCandidates[clampedActiveIndex] : null;
  const activeOptionId = activeCandidate
    ? `${listboxId}-option-${clampedActiveIndex}`
    : undefined;

  const selectCandidate = (candidate) => {
    onSelectedChange(candidate.symbol);
    onQueryChange(`${candidate.symbol} - ${candidate.name || candidate.quoteType}`);
    setCandidates([]);
    setActiveIndex(-1);
  };

  useEffect(() => {
    if (query.trim().length < 2 || selected) return undefined;
    let disposed = false;
    const timer = window.setTimeout(() => {
      searchInstruments(query).then((items) => {
        if (!disposed) setCandidates(items.slice(0, 5));
      }).catch(() => {
        if (!disposed) setCandidates([]);
      });
    }, 180);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [query, selected]);

  return (
    <div className="relative">
      <label className="sr-only" htmlFor={inputId}>Search ticker or company</label>
      <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
      <Input
        id={inputId}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visibleCandidates.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        className="pl-9"
        placeholder="Search ticker or company"
        value={query}
        disabled={disabled}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (visibleCandidates.length === 0) return;
            setActiveIndex((index) => nextComboboxActiveIndex(index, visibleCandidates.length, "next"));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (visibleCandidates.length === 0) return;
            setActiveIndex((index) => nextComboboxActiveIndex(index, visibleCandidates.length, "previous"));
          } else if (event.key === "Enter" && activeCandidate) {
            event.preventDefault();
            selectCandidate(activeCandidate);
          } else if (event.key === "Escape" && visibleCandidates.length > 0) {
            event.preventDefault();
            setCandidates([]);
            setActiveIndex(-1);
          }
        }}
        onChange={(event) => {
          setCandidates([]);
          setActiveIndex(-1);
          onQueryChange(event.target.value);
          onSelectedChange("");
        }}
      />
      {visibleCandidates.length ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Ticker suggestions"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-subtle-md"
        >
          {visibleCandidates.map((candidate, index) => (
            <button
              key={`${candidate.provider}:${candidate.symbol}:${candidate.exchange}`}
              id={`${listboxId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={index === clampedActiveIndex}
              className={cn(
                "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-secondary",
                index === clampedActiveIndex && "bg-secondary",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectCandidate(candidate)}
            >
              <span className="font-medium text-foreground">{candidate.symbol}</span>
              <span className="truncate text-muted-foreground">{candidate.name || candidate.quoteType}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function clampComboboxActiveIndex(activeIndex, candidateCount) {
  if (candidateCount <= 0) return -1;
  if (activeIndex < 0) return -1;
  return Math.min(activeIndex, candidateCount - 1);
}

export function nextComboboxActiveIndex(activeIndex, candidateCount, direction) {
  if (candidateCount <= 0) return -1;
  const current = clampComboboxActiveIndex(activeIndex, candidateCount);
  if (direction === "next") return (current + 1) % candidateCount;
  return current <= 0 ? candidateCount - 1 : current - 1;
}

export function AlertCreateForm({ disabled, invokeTool, onSaved }) {
  const [draft, setDraft] = useState({
    query: "",
    selected: "",
    threshold: "",
    condition: "create_price_above",
    period: "14",
    cooldown: "3600",
  });
  const setDraftField = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const { query, selected, threshold, condition, period, cooldown } = draft;
  const needsThreshold = !condition.includes("_sma") && condition !== "create_volume_spike";
  const supportsThreshold = needsThreshold || condition === "create_volume_spike";
  const needsPeriod = condition.includes("_sma") || condition.includes("_rsi_") || condition === "create_volume_spike";
  const resolvedSymbol = selected;
  const summary = resolvedSymbol
    ? `Notify once when ${resolvedSymbol} ${conditionSummary(condition, threshold, period)} during a manual or local-runner check.`
    : "Select an instrument to preview the alert rule.";

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!resolvedSymbol || (needsThreshold && !threshold)) return;
        const saved = await invokeTool("manage_alerts", {
          action: condition,
          symbol: resolvedSymbol,
          threshold: supportsThreshold && threshold ? Number(threshold) : undefined,
          period: needsPeriod ? Number(period) : undefined,
          cooldown_seconds: numberOrUndefined(cooldown),
        });
        if (saved) {
          setDraft((current) => ({ ...current, query: "", selected: "", threshold: "" }));
          onSaved?.();
        }
      }}
    >
      <p className="text-xs text-muted-foreground">Rule builder uses existing manage_alerts inputs and existing alert lifecycle semantics.</p>
      <SymbolSearchInput
        query={query}
        selected={selected}
        disabled={disabled}
        onQueryChange={(value) => setDraftField("query", value)}
        onSelectedChange={(value) => setDraftField("selected", value)}
      />
      <select
        aria-label="Alert condition"
        className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground md:h-9"
        value={condition}
        disabled={disabled}
        onChange={(event) => setDraftField("condition", event.target.value)}
      >
        <option value="create_price_above">Price above</option>
        <option value="create_price_below">Price below</option>
        <option value="create_price_above_sma">Price above SMA</option>
        <option value="create_price_below_sma">Price below SMA</option>
        <option value="create_rsi_above">RSI above</option>
        <option value="create_rsi_below">RSI below</option>
        <option value="create_volume_spike">Volume spike</option>
      </select>
      <Input
        aria-label="Alert threshold"
        type="number"
        step="any"
        placeholder={condition === "create_volume_spike" ? "Multiplier (optional)" : needsThreshold ? "Threshold" : "No threshold required"}
        value={threshold}
        disabled={disabled || !supportsThreshold}
        onChange={(event) => setDraftField("threshold", event.target.value)}
      />
      <Input aria-label="Alert period" type="number" step="any" placeholder="Period" value={period} disabled={disabled || !needsPeriod} onChange={(event) => setDraftField("period", event.target.value)} />
      <Input aria-label="Alert cooldown seconds" type="number" step="any" placeholder="Cooldown sec" value={cooldown} disabled={disabled} onChange={(event) => setDraftField("cooldown", event.target.value)} />
      <div className="rounded-md border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">{summary}</div>
      <Button type="submit" variant="brand" disabled={disabled || !resolvedSymbol || (needsThreshold && !threshold)}>Create alert</Button>
    </form>
  );
}

function NotificationsPanel({ title, notifications, attempts, readOnly, invokeTool }) {
  return (
    <Panel title={title} count={notifications.length}>
      {notifications.length === 0 ? (
        <EmptyState icon={Bell} title={`No ${title.toLowerCase()}`} action="Triggered alerts and report outcomes appear here." />
      ) : (
        <DataTable
          columns={["Created", "Severity", "Title", "Status", "Delivery", "Actions"]}
          rows={notifications.slice(0, 10).map((notification) => ({
            key: notification.id,
            cells: [
              shortDate(notification.createdAt),
              notification.severity,
              notification.title,
              notification.status,
              deliveryStatus(attempts, notification.id),
              <RowActions
                key="actions"
                disabled={readOnly || notification.status === "acknowledged"}
                actions={[["Acknowledge", () => invokeTool("manage_notifications", { action: "acknowledge", id: notification.id })]]}
              />,
            ],
          }))}
        />
      )}
    </Panel>
  );
}

function SummaryStrip({ items }) {
  return (
    <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md border border-border bg-card p-3 shadow-subtle-xs">
          <div className="text-[11px] uppercase tracking-normal text-muted-foreground">{label}</div>
          <div className="mt-1 truncate text-sm font-semibold text-foreground">{value}</div>
        </div>
      ))}
    </section>
  );
}

function Panel({ title, count, meta, children }) {
  return (
    <section className="rounded-md border border-border bg-card shadow-subtle-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {count !== undefined ? <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{count}</span> : null}
          </div>
          {meta ? <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p> : null}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function DataTable({ columns, rows }) {
  return (
    <>
      <div className="space-y-2 md:hidden">
        {rows.map((row) => (
          <div key={row.key} className="rounded-md border border-border bg-background p-3">
            {row.cells.map((cell, cellIndex) => (
              <div key={columns[cellIndex] ?? cellIndex} className="grid grid-cols-[108px_minmax(0,1fr)] gap-3 border-b border-border/70 py-2 last:border-0">
                <div className="text-[11px] uppercase tracking-normal text-muted-foreground">{columns[cellIndex]}</div>
                <div className="min-w-0 text-sm text-foreground">{cell}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            {columns.map((column) => <th key={column} className="p-2 font-medium">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border/70 last:border-0">
              {row.cells.map((cell, cellIndex) => <td key={columns[cellIndex] ?? cellIndex} className="p-2 align-middle text-foreground">{cell}</td>)}
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </>
  );
}

function EmptyState({ icon: Icon, title, action, cta }) {
  return (
    <div className="flex min-h-[120px] flex-col gap-3 rounded-md border border-dashed border-border bg-secondary/50 p-4 sm:flex-row sm:items-center">
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-card text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs leading-5 text-muted-foreground">{action}</div>
      </div>
      {cta ? (
        <Button type="button" variant="bordered" size="sm" disabled={cta.disabled} onClick={cta.onClick}>
          {cta.label}
        </Button>
      ) : null}
    </div>
  );
}

function DetailStack({ rows, actions = EMPTY_ACTIONS, readOnly }) {
  return (
    <div className="space-y-3">
      <dl className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-md border border-border bg-secondary/50 px-3 py-2">
            <dt className="text-[11px] uppercase tracking-normal text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-sm text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {actions.length ? <RowActions actions={actions} disabled={readOnly} /> : null}
    </div>
  );
}

function StatusBand({ tone = "default", children }) {
  return (
    <div className={cn(
      "rounded-md border px-3 py-2 text-xs",
      tone === "error"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-border bg-secondary text-muted-foreground",
    )}>
      {children}
    </div>
  );
}

function readOnlyMessage(role) {
  if (role === "connecting") return "Connecting to the GUI session: read-only until the writer connection is ready.";
  if (role === "disconnected") return "Disconnected from the GUI session: read-only until the writer reconnects.";
  return "Follower mode: read-only. Take over the session to mutate saved state; tables, summaries, and details remain available here.";
}

export function buildWatchlistRowActions(item, invokeTool) {
  const actions = [];
  if (item.targetPrice == null) {
    actions.push({
      label: "Set target first",
      disabled: true,
      onClick: () => undefined,
    });
  } else {
    actions.push({
      label: "Create alert",
      onClick: () => invokeTool("manage_alerts", {
        action: "create_price_above",
        symbol: item.symbol,
        threshold: item.targetPrice,
      }),
    });
  }
  actions.push({
    label: "Remove",
    onClick: () => invokeTool("manage_watchlist", { action: "remove", symbol: item.symbol }),
  });
  return actions;
}

function RowActions({ actions, disabled }) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {actions.map((action) => (
        <RowActionButton key={Array.isArray(action) ? action[0] : action.label} action={action} disabled={disabled} />
      ))}
    </div>
  );
}

function RowActionButton({ action, disabled }) {
  const normalized = Array.isArray(action)
    ? { label: action[0], onClick: action[1], disabled: false }
    : action;
  const blockedByReadOnly = disabled && !normalized.readOnlySafe;
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      disabled={blockedByReadOnly || normalized.disabled}
      onClick={normalized.onClick}
    >
      {normalized.label}
    </Button>
  );
}

function TickerCell({ symbol, sub }) {
  return (
    <div className="min-w-[90px]">
      <div className="font-medium text-foreground">{symbol}</div>
      {sub ? <div className="text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function groupBy(items, key) {
  const map = new Map();
  for (const item of items || []) {
    const id = item?.[key];
    if (id == null) continue;
    const existing = map.get(id) || [];
    existing.push(item);
    map.set(id, existing);
  }
  return map;
}

function groupByOne(items, key) {
  const map = new Map();
  for (const item of items || []) {
    const id = item?.[key];
    if (id == null) continue;
    map.set(id, item);
  }
  return map;
}

function filterItems(items, filter, keys) {
  const query = filter.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => keys.some((key) => {
    const value = item?.[key];
    if (Array.isArray(value)) return value.join(" ").toLowerCase().includes(query);
    return String(value ?? "").toLowerCase().includes(query);
  }));
}

function panelTitle(type) {
  const titles = {
    "watchlist-add": "Add Ticker",
    "watchlist-edit": "Edit Ticker",
    "watchlist-detail": "Ticker Details",
    "holding-add": "Add Holding",
    "holding-edit": "Edit Holding",
    "holding-detail": "Holding Details",
    "alert-create": "Create Alert",
    "alert-detail": "Alert Details",
    "report-configure": "Configure Report",
    "thesis-record": "Record Thesis",
    "thesis-detail": "Thesis Details",
  };
  return titles[type] || "Details";
}

function alertStatus(alerts) {
  if (!alerts?.length) return "No rule";
  if (alerts.some((alert) => alert.lastTriggeredAt)) return "Triggered";
  if (alerts.some((alert) => alert.lastCheckedAt)) return "Manual checked";
  return "Never checked";
}

function conditionSummary(condition, threshold, period) {
  const label = condition
    .replace("create_", "")
    .replaceAll("_", " ");
  if (condition.includes("_sma")) return `${label} over ${period || "the selected"} periods`;
  if (condition.includes("_rsi_")) return `${label} ${threshold || "the threshold"} over ${period || "the selected"} periods`;
  if (condition === "create_volume_spike") return `has a volume spike above ${threshold || "2"}x the ${period || "selected"}-period average`;
  return `${label} $${threshold || "the threshold"}`;
}

function summarize(value) {
  if (value == null) return "N/A";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function moneyOrDash(value) {
  return typeof value === "number" ? `$${value.toFixed(2)}` : "N/A";
}

function moneyWithCurrency(value, currency = "USD") {
  if (typeof value !== "number") return "N/A";
  return currency === "USD" ? `$${value.toFixed(2)}` : `${currency} ${value.toFixed(2)}`;
}

function quoteCell(quote) {
  if (!quote) return "Not checked";
  if (quote.status !== "ok") return "Unavailable";
  return moneyOrDash(quote.price);
}

function quoteFreshness(quote) {
  if (!quote) return "Not checked";
  if (quote.status !== "ok") return quote.reason || "Unavailable";
  return quote.stale ? `Stale ${shortDate(quote.fetchedAt)}` : `Fetched ${shortDate(quote.fetchedAt)}`;
}

function portfolioCurrentCell(quote) {
  if (!quote) return "Not checked";
  if (quote.status !== "ok") return "Unavailable";
  return moneyWithCurrency(quote.currentPrice, quote.currency);
}

function portfolioValueCell(quote) {
  if (!quote) return "Not checked";
  if (quote.status !== "ok") return "Unavailable";
  return moneyWithCurrency(quote.marketValue, quote.currency);
}

function portfolioPnlCell(quote) {
  if (!quote) return "Not checked";
  if (quote.status !== "ok") return "Unavailable";
  const sign = quote.pnl >= 0 ? "+" : "";
  return `${moneyWithCurrency(quote.pnl, quote.currency)} (${sign}${Number(quote.pnlPercent ?? 0).toFixed(2)}%)`;
}

function allocationCell(quote) {
  if (!quote) return "Not checked";
  if (quote.status !== "ok") return "Unavailable";
  if (typeof quote.allocationPercent !== "number") return "Excluded";
  return `${quote.allocationPercent.toFixed(1)}%`;
}

function formatNumber(value) {
  return typeof value === "number" ? value.toLocaleString() : "N/A";
}

function shortDate(value) {
  if (!value) return "N/A";
  return String(value).replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}

function deliveryStatus(attempts = [], notificationId) {
  const matching = attempts.filter((attempt) => attempt.notificationEventId === notificationId);
  if (matching.length === 0) return "In-app only";
  return matching[0].status;
}

function isDueSoon(value) {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return false;
  const now = Date.now();
  return time >= now && time - now <= 1000 * 60 * 60 * 24 * 7;
}

function numberOrUndefined(value) {
  if (value === "" || value == null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseTags(value) {
  const tags = [];
  for (const part of String(value ?? "").split(",")) {
    const tag = part.trim();
    if (tag) tags.push(tag);
  }
  return tags.length ? tags : undefined;
}
