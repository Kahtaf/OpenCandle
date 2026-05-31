import {
  Activity,
  Bell,
  BriefcaseBusiness,
  FileText,
  ListPlus,
  RefreshCw,
  Search,
  Target,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { cn } from "../../lib/utils.js";
import { searchInstruments, useMarketState } from "../../hooks/useMarketState.jsx";
import { buildAlertRows } from "./alert-view-model.js";

const DOMAINS = [
  { id: "watchlists", label: "Watchlists", path: "/watchlists", icon: ListPlus },
  { id: "portfolios", label: "Portfolios", path: "/portfolios", icon: BriefcaseBusiness },
  { id: "alerts", label: "Alerts", path: "/alerts", icon: Bell },
  { id: "reports", label: "Reports", path: "/reports", icon: FileText },
  { id: "predictions", label: "Predictions", path: "/predictions", icon: TrendingUp },
];

export function MarketStatePage({ domain, role, send, navigate, setToast }) {
  const { state, loading, error, refresh, refreshQuotes } = useMarketState();
  const readOnly = role === "follower";
  const active = DOMAINS.find((item) => item.id === domain) ?? DOMAINS[0];

  const invokeTool = (toolName, args) => {
    if (readOnly) {
      setToast?.("Follower mode: market-state mutations are disabled.");
      return;
    }
    if (send?.("tool.invoke", { toolName, args })) {
      window.setTimeout(() => void refresh(), 700);
    }
  };

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="border-b border-border bg-background px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-semibold tracking-normal text-foreground">{active.label}</h1>
              <p className="text-xs text-muted-foreground">
                Durable SQLite-backed market state. GUI actions are recorded through the session tool path.
              </p>
            </div>
            <Button variant="bordered" size="sm" prefixIcon={RefreshCw} onClick={refresh} disabled={loading}>
              Refresh
            </Button>
            <Button variant="bordered" size="sm" prefixIcon={Activity} onClick={refreshQuotes} disabled={loading}>
              Quotes
            </Button>
          </div>
          <nav className="flex gap-1 overflow-x-auto" aria-label="Market state sections">
            {DOMAINS.map((item) => (
              <Button
                key={item.id}
                variant={item.id === active.id ? "brand" : "ghost"}
                size="sm"
                prefixIcon={item.icon}
                onClick={() => navigate({ to: item.path })}
                className="shrink-0"
              >
                {item.label}
              </Button>
            ))}
          </nav>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4">
          {error ? <StatusBand tone="error">{error}</StatusBand> : null}
          {readOnly ? <StatusBand>Follower mode: read-only. Take over the session to mutate saved state.</StatusBand> : null}
          {active.id === "watchlists" ? <Watchlists state={state} readOnly={readOnly} invokeTool={invokeTool} /> : null}
          {active.id === "portfolios" ? <Portfolios state={state} readOnly={readOnly} invokeTool={invokeTool} navigate={navigate} /> : null}
          {active.id === "alerts" ? <Alerts state={state} readOnly={readOnly} invokeTool={invokeTool} /> : null}
          {active.id === "reports" ? <Reports state={state} readOnly={readOnly} invokeTool={invokeTool} /> : null}
          {active.id === "predictions" ? <Predictions state={state} readOnly={readOnly} invokeTool={invokeTool} /> : null}
        </div>
      </main>
    </section>
  );
}

function Watchlists({ state, readOnly, invokeTool }) {
  const alertsByInstrument = useMemo(() => groupBy(state.alerts, "instrumentId"), [state.alerts]);
  const quotesByItem = useMemo(() => groupByOne(state.quoteSnapshot?.watchlistQuotes, "itemId"), [state.quoteSnapshot]);
  return (
    <>
      <SymbolActionPanel
        title="Add ticker"
        disabled={readOnly}
        fields={[
          { name: "target_price", label: "Target", type: "number" },
          { name: "stop_price", label: "Stop", type: "number" },
          { name: "thesis", label: "Thesis" },
          { name: "notes", label: "Notes" },
          { name: "tags", label: "Tags" },
        ]}
        onSubmit={(values) => invokeTool("manage_watchlist", {
          action: "add",
          symbol: values.symbol,
          target_price: numberOrUndefined(values.target_price),
          stop_price: numberOrUndefined(values.stop_price),
          thesis: values.thesis || undefined,
          notes: values.notes || undefined,
          tags: parseTags(values.tags),
        })}
      />
      <SymbolActionPanel
        title="Update ticker"
        disabled={readOnly}
        fields={[
          { name: "target_price", label: "Target", type: "number" },
          { name: "stop_price", label: "Stop", type: "number" },
          { name: "thesis", label: "Thesis" },
          { name: "notes", label: "Notes" },
          { name: "tags", label: "Tags" },
        ]}
        onSubmit={(values) => invokeTool("manage_watchlist", {
          action: "update",
          symbol: values.symbol,
          target_price: numberOrUndefined(values.target_price),
          stop_price: numberOrUndefined(values.stop_price),
          thesis: values.thesis || undefined,
          notes: values.notes || undefined,
          tags: parseTags(values.tags),
        })}
      />
      <Panel title="Default Watchlist" count={state.watchlist.length}>
        {state.watchlist.length === 0 ? (
          <EmptyState icon={ListPlus} title="No tickers yet" action="Use Add ticker to start the default watchlist." />
        ) : (
          <DataTable
            columns={["Symbol", "Name", "Quote", "Freshness", "Target", "Stop", "Thesis", "Notes", "Tags", "Alert status", ""]}
            rows={state.watchlist.map((item) => [
              <TickerCell key="symbol" symbol={item.symbol} sub={item.exchange || item.assetType} />,
              item.name || "N/A",
              quoteCell(quotesByItem.get(item.id)),
              quoteFreshness(quotesByItem.get(item.id)),
              moneyOrDash(item.targetPrice),
              moneyOrDash(item.stopPrice),
              item.thesis || "N/A",
              item.notes || "N/A",
              item.tags?.length ? item.tags.join(", ") : "N/A",
              alertStatus(alertsByInstrument.get(item.instrumentId)),
              <RowActions
                key="actions"
                disabled={readOnly}
                actions={buildWatchlistRowActions(item, invokeTool)}
              />,
            ])}
          />
        )}
      </Panel>
    </>
  );
}

function Portfolios({ state, readOnly, invokeTool, navigate }) {
  const totalCost = state.portfolio.reduce((sum, lot) => sum + (Number(lot.quantity) * Number(lot.avgCost)), 0);
  const quotesByLot = useMemo(() => groupByOne(state.quoteSnapshot?.portfolioQuotes, "lotId"), [state.quoteSnapshot]);
  const summary = state.quoteSnapshot?.portfolioSummary;
  return (
    <>
      <SymbolActionPanel
        title="Add holding"
        disabled={readOnly}
        fields={[
          { name: "shares", label: "Quantity", type: "number", required: true },
          { name: "avg_cost", label: "Avg cost", type: "number", required: true },
          { name: "currency", label: "Currency" },
        ]}
        onSubmit={(values) => invokeTool("track_portfolio", {
          action: "add",
          symbol: values.symbol,
          shares: Number(values.shares),
          avg_cost: Number(values.avg_cost),
          currency: values.currency || undefined,
        })}
      />
      <PortfolioUpdatePanel disabled={readOnly} invokeTool={invokeTool} />
      <Panel
        title="Default Portfolio"
        count={state.portfolio.length}
        meta={summary ? `Value ${moneyWithCurrency(summary.totalValue, summary.baseCurrency)} | P&L ${moneyWithCurrency(summary.totalPnl, summary.baseCurrency)}` : totalCost > 0 ? `Cost basis $${totalCost.toFixed(2)}` : undefined}
      >
        {state.portfolio.length === 0 ? (
          <EmptyState
            icon={BriefcaseBusiness}
            title="No holdings yet"
            action="Add a holding when you are ready, or keep using watchlists without a portfolio."
            cta={{
              label: "Skip For Now",
              onClick: () => navigate({ to: "/watchlists" }),
            }}
          />
        ) : (
          <DataTable
            columns={["Lot", "Symbol", "Quantity", "Avg cost", "Current", "Value", "Allocation", "P&L", "Quote", "Currency", "Notes", ""]}
            rows={state.portfolio.map((lot) => {
              const quote = quotesByLot.get(lot.id);
              return [
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
                lot.notes || "N/A",
                <RowActions
                  key="actions"
                  disabled={readOnly}
                  actions={[["Remove", () => invokeTool("track_portfolio", { action: "remove", lot_id: lot.id })]]}
                />,
              ];
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

function PortfolioUpdatePanel({ disabled, invokeTool }) {
  const [values, setValues] = useState({});

  const submit = (event) => {
    event.preventDefault();
    const lotId = numberOrUndefined(values.lot_id);
    if (lotId == null) return;
    invokeTool("track_portfolio", {
      action: "update",
      lot_id: lotId,
      shares: numberOrUndefined(values.shares),
      avg_cost: numberOrUndefined(values.avg_cost),
      currency: values.currency || undefined,
    });
    setValues({});
  };

  return (
    <Panel title="Update holding" meta="Use the lot id shown in the portfolio table">
      <form className="grid gap-3 sm:grid-cols-[120px_1fr_1fr_1fr_auto]" onSubmit={submit}>
        {[
          { name: "lot_id", label: "Lot ID", type: "number", required: true },
          { name: "shares", label: "Quantity", type: "number" },
          { name: "avg_cost", label: "Avg cost", type: "number" },
          { name: "currency", label: "Currency" },
        ].map((field) => (
          <Input
            key={field.name}
            type={field.type || "text"}
            placeholder={field.label}
            value={values[field.name] || ""}
            disabled={disabled}
            required={field.required}
            onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
          />
        ))}
        <Button type="submit" variant="brand" disabled={disabled || numberOrUndefined(values.lot_id) == null}>Save</Button>
      </form>
    </Panel>
  );
}

function Alerts({ state, readOnly, invokeTool }) {
  const alertRows = useMemo(() => buildAlertRows(state.alerts, state.alertEvents), [state.alerts, state.alertEvents]);
  return (
    <>
      <Panel title="Create Price Alert" meta="Manual checks in V1">
        <AlertCreateForm disabled={readOnly} invokeTool={invokeTool} />
      </Panel>
      <Panel
        title="Alert Rules"
        count={state.alerts.length}
        action={<Button size="sm" variant="bordered" prefixIcon={Activity} disabled={readOnly} onClick={() => invokeTool("manage_alerts", { action: "check" })}>Run check</Button>}
      >
        {state.alerts.length === 0 ? (
          <EmptyState icon={Bell} title="No alerts yet" action="Create a manual price alert, then run checks explicitly." />
        ) : (
          <DataTable
            columns={["Rule", "Scope", "Mode", "Last checked", "Last observed", "Latest event", "Status", "Actions"]}
            rows={alertRows.map((row) => [
              row.rule,
              row.scope,
              row.mode,
              row.lastChecked,
              row.lastObserved,
              row.latestEvent,
              row.status,
              <RowActions
                disabled={readOnly}
                actions={[
                  [row.toggleLabel, () => invokeTool("manage_alerts", { action: "set_enabled", id: row.id, enabled: !row.enabled })],
                ]}
              />,
            ])}
          />
        )}
      </Panel>
      <Panel title="Alert Events" count={state.alertEvents.length}>
        {state.alertEvents.length === 0 ? (
          <EmptyState icon={Bell} title="No alert events" action="Run a manual check after creating alerts to record events." />
        ) : (
          <DataTable
            columns={["Triggered", "Rule", "Instrument", "Status", "Message"]}
            rows={state.alertEvents.map((event) => [
              shortDate(event.triggeredAt),
              `#${event.alertRuleId}`,
              event.instrumentId ? `#${event.instrumentId}` : "N/A",
              event.status,
              event.message || "N/A",
            ])}
          />
        )}
      </Panel>
    </>
  );
}

function Reports({ state, readOnly, invokeTool }) {
  return (
    <>
      <Panel title="Morning Report" meta="Manual run now, schedule metadata preserved">
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
          <EmptyState icon={FileText} title="No report template configured" action="Configure the morning report to preserve schedule metadata." />
        ) : (
          <DataTable
            columns={["Name", "Type", "Cadence", "Local time", "Timezone", "Status"]}
            rows={state.reportTemplates.map((template) => [
              template.name,
              template.reportType,
              template.cadence,
              template.localTime,
              template.timezone,
              template.enabled ? "Enabled" : "Disabled",
            ])}
          />
        )}
      </Panel>
      <Panel title="Report Runs" count={state.reportRuns.length}>
        {state.reportRuns.length === 0 ? (
          <EmptyState icon={FileText} title="No reports generated" action="Generate today's watchlist report to create history." />
        ) : (
          <DataTable
            columns={["Started", "Completed", "Status", "Summary"]}
            rows={state.reportRuns.map((run) => [
              shortDate(run.startedAt),
              shortDate(run.completedAt),
              run.status,
              summarize(run.summaryJson),
            ])}
          />
        )}
      </Panel>
    </>
  );
}

function Predictions({ state, readOnly, invokeTool }) {
  return (
    <>
      <SymbolActionPanel
        title="Record prediction"
        disabled={readOnly}
        fields={[
          { name: "direction", label: "Direction", placeholder: "bullish | bearish | neutral", required: true },
          { name: "conviction", label: "Conviction", type: "number", required: true },
          { name: "entry_price", label: "Entry", type: "number", required: true },
          { name: "target_price", label: "Target", type: "number" },
          { name: "timeframe_days", label: "Days", type: "number" },
        ]}
        onSubmit={(values) => invokeTool("track_prediction", {
          action: "record",
          symbol: values.symbol,
          direction: values.direction || "bullish",
          conviction: Number(values.conviction),
          entry_price: Number(values.entry_price),
          target_price: numberOrUndefined(values.target_price),
          timeframe_days: numberOrUndefined(values.timeframe_days),
        })}
      />
      <Panel
        title="Predictions"
        count={state.predictions.length}
        action={<Button size="sm" variant="bordered" disabled={readOnly} onClick={() => invokeTool("track_prediction", { action: "check" })}>Check</Button>}
      >
        {state.predictions.length === 0 ? (
          <EmptyState icon={TrendingUp} title="No predictions recorded" action="Record a thesis and check outcomes later." />
        ) : (
          <DataTable
            columns={["Symbol", "Direction", "Conviction", "Entry", "Target", "Expires", "Status", ""]}
            rows={state.predictions.map((prediction) => [
              <TickerCell key="symbol" symbol={prediction.symbol} />,
              prediction.direction,
              formatNumber(prediction.conviction),
              moneyOrDash(prediction.entryPrice),
              moneyOrDash(prediction.targetPrice),
              shortDate(prediction.expiresAt),
              prediction.status,
              <RowActions
                key="actions"
                disabled={readOnly || prediction.status !== "open"}
                actions={[
                  ["Cancel", () => invokeTool("track_prediction", { action: "cancel", id: prediction.id })],
                ]}
              />,
            ])}
          />
        )}
      </Panel>
    </>
  );
}

function SymbolActionPanel({ title, fields, disabled, onSubmit }) {
  const [values, setValues] = useState({});
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");

  const submit = (event) => {
    event.preventDefault();
    const symbol = selected || query.trim().toUpperCase();
    if (!symbol) return;
    onSubmit({ ...values, symbol });
    setValues({});
    setQuery("");
    setSelected("");
  };

  return (
    <Panel title={title} meta={selected ? `Selected ${selected}` : "Search Yahoo candidates before saving"}>
      <form className="grid gap-3 lg:grid-cols-[minmax(220px,1.2fr)_repeat(3,minmax(120px,0.7fr))_auto]" onSubmit={submit}>
        <SymbolSearchInput
          query={query}
          selected={selected}
          disabled={disabled}
          onQueryChange={setQuery}
          onSelectedChange={setSelected}
        />
        {fields.map((field) => (
          <Input
            key={field.name}
            type={field.type || "text"}
            placeholder={field.label}
            value={values[field.name] || ""}
            disabled={disabled}
            required={field.required}
            onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
          />
        ))}
        <Button type="submit" variant="brand" disabled={disabled || !query.trim()} prefixIcon={Target}>Save</Button>
      </form>
    </Panel>
  );
}

function SymbolSearchInput({ query, selected, disabled, onQueryChange, onSelectedChange }) {
  const [candidates, setCandidates] = useState([]);

  useEffect(() => {
    let disposed = false;
    if (query.trim().length < 2 || selected) {
      setCandidates([]);
      return;
    }
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
      <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
      <Input
        className="pl-9"
        placeholder="Search ticker or company"
        value={query}
        disabled={disabled}
        onChange={(event) => {
          onQueryChange(event.target.value);
          onSelectedChange("");
        }}
      />
      {candidates.length ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-subtle-md">
          {candidates.map((candidate) => (
            <button
              key={`${candidate.provider}:${candidate.symbol}:${candidate.exchange}`}
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-secondary"
              onClick={() => {
                onSelectedChange(candidate.symbol);
                onQueryChange(`${candidate.symbol} - ${candidate.name || candidate.quoteType}`);
                setCandidates([]);
              }}
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

function AlertCreateForm({ disabled, invokeTool }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [threshold, setThreshold] = useState("");
  const [condition, setCondition] = useState("create_price_above");
  const [period, setPeriod] = useState("14");
  const [cooldown, setCooldown] = useState("3600");
  const needsThreshold = !condition.includes("_sma");
  const needsPeriod = condition.includes("_sma") || condition.includes("_rsi_") || condition === "create_volume_spike";
  return (
    <form
      className="grid gap-3 lg:grid-cols-[minmax(220px,1.2fr)_140px_120px_140px_170px_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        const symbol = selected || query.trim().toUpperCase();
        if (!symbol || (needsThreshold && !threshold)) return;
        invokeTool("manage_alerts", {
          action: condition,
          symbol,
          threshold: needsThreshold ? Number(threshold) : undefined,
          period: needsPeriod ? Number(period) : undefined,
          cooldown_seconds: numberOrUndefined(cooldown),
        });
        setQuery("");
        setSelected("");
        setThreshold("");
      }}
    >
      <SymbolSearchInput
        query={query}
        selected={selected}
        disabled={disabled}
        onQueryChange={setQuery}
        onSelectedChange={setSelected}
      />
      <Input type="number" placeholder={needsThreshold ? "Threshold" : "No threshold"} value={threshold} disabled={disabled || !needsThreshold} onChange={(event) => setThreshold(event.target.value)} />
      <Input type="number" placeholder="Period" value={period} disabled={disabled || !needsPeriod} onChange={(event) => setPeriod(event.target.value)} />
      <Input type="number" placeholder="Cooldown sec" value={cooldown} disabled={disabled} onChange={(event) => setCooldown(event.target.value)} />
      <select
        className="h-11 rounded-md border border-border bg-card px-3 text-sm text-foreground md:h-9"
        value={condition}
        disabled={disabled}
        onChange={(event) => setCondition(event.target.value)}
      >
        <option value="create_price_above">Price above</option>
        <option value="create_price_below">Price below</option>
        <option value="create_price_above_sma">Price above SMA</option>
        <option value="create_price_below_sma">Price below SMA</option>
        <option value="create_rsi_above">RSI above</option>
        <option value="create_rsi_below">RSI below</option>
        <option value="create_volume_spike">Volume spike</option>
      </select>
      <Button type="submit" variant="brand" disabled={disabled || !query.trim() || (needsThreshold && !threshold)}>Create</Button>
    </form>
  );
}

function Panel({ title, count, meta, action, children }) {
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
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function DataTable({ columns, rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            {columns.map((column) => <th key={column} className="px-2 py-2 font-medium">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-border/70 last:border-0">
              {row.map((cell, cellIndex) => <td key={cellIndex} className="px-2 py-2 align-middle text-foreground">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ icon: Icon, title, action, cta }) {
  return (
    <div className="flex min-h-[120px] items-center gap-3 rounded-md border border-dashed border-border bg-secondary/50 px-4 py-4">
      <span className="inline-flex size-9 items-center justify-center rounded-md bg-card text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{action}</div>
      </div>
      {cta ? (
        <Button type="button" variant="bordered" size="sm" onClick={cta.onClick}>
          {cta.label}
        </Button>
      ) : null}
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
    <div className="flex justify-end gap-1">
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
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      disabled={disabled || normalized.disabled}
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

function alertStatus(alerts) {
  if (!alerts?.length) return "No rule";
  if (alerts.some((alert) => alert.lastTriggeredAt)) return "Triggered";
  if (alerts.some((alert) => alert.lastCheckedAt)) return "Manual checked";
  return "Never checked";
}

function describeCondition(condition) {
  if (!condition || typeof condition !== "object") return "";
  if (typeof condition.threshold === "number") return `$${condition.threshold}`;
  return summarize(condition);
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

function numberOrUndefined(value) {
  if (value === "" || value == null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseTags(value) {
  const tags = String(value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags.length ? tags : undefined;
}
