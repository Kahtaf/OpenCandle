import { Plus, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Textarea } from "../../components/ui/textarea.jsx";
import { TOOL_INVOKE_TIMEOUT_MESSAGE } from "../../hooks/useGuiConnection.jsx";
import { useMarketState } from "../../hooks/useMarketState.jsx";
import { cn } from "../../lib/utils.js";
import { InstrumentSuggestionList } from "../instruments/instrument-search.jsx";
import {
  clampInstrumentActiveIndex,
  instrumentSuggestionOptionId,
  nextInstrumentActiveIndex,
} from "../instruments/instrument-search-helpers.js";
import { useInstrumentSearch } from "../instruments/use-instrument-search.js";
import { DesktopSidebarRestore, MobileHeader } from "../layout/AppShellChrome.jsx";
import { AlertsPage } from "./AlertsPage.jsx";
import { quoteFreshness } from "./format.js";
import { PortfolioPage } from "./PortfolioPage.jsx";
import { ReportsPage } from "./ReportsPage.jsx";
import { Badge, StatusBand } from "./shared.jsx";
import { WatchlistPage } from "./WatchlistPage.jsx";

const PAGE_META = {
  watchlists: {
    title: "Watchlists",
    primaryLabel: "Add ticker",
    primaryPanel: "watchlist-add",
  },
  portfolios: {
    title: "Portfolios",
    primaryLabel: "Add holding",
    primaryPanel: "holding-add",
  },
  alerts: {
    title: "Alerts",
    primaryLabel: "Create alert",
    primaryPanel: "alert-create",
  },
  reports: {
    title: "Reports",
    primaryLabel: "Generate today",
  },
};

const UNSUPPORTED_MUTATION_FALLBACK_MESSAGE =
  "Market-state mutations require acknowledged tool invocation support. Reconnect the GUI and try again.";

export async function invokeMarketStateMutation({
  readOnly,
  toolName,
  args,
  invokeToolRequest,
  setToast,
  refresh,
  refreshQuotes,
  setPendingMutation,
}) {
  if (readOnly) {
    setToast?.("Saved-state changes are unavailable while OpenCandle reconnects local access.", {
      destructive: true,
    });
    return false;
  }
  setPendingMutation?.({ toolName });
  try {
    if (typeof invokeToolRequest !== "function") {
      throw new Error(UNSUPPORTED_MUTATION_FALLBACK_MESSAGE);
    }
    await invokeToolRequest(toolName, args);
    await refresh();
    await refreshQuotes?.();
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

export function MarketStatePage({
  domain,
  role,
  send,
  invokeTool: invokeToolRequest,
  navigate,
  setToast,
  onOpenSidebar,
  onOpenHome,
  sidebarCollapsed = false,
  onExpandSidebar,
}) {
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
      refreshQuotes,
      setPendingMutation,
    });
  };

  const openPanel = (type, data) => {
    panelOpenerRef.current =
      typeof document !== "undefined" && document.activeElement instanceof HTMLElement
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

  const primaryAction = () => {
    if (activeId === "reports") {
      invokeTool("daily_watchlist_report", { action: "run" });
      return;
    }
    openPanel(active.primaryPanel);
  };

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <MobileHeader onOpenSidebar={onOpenSidebar} onOpenHome={onOpenHome} />
      {sidebarCollapsed ? <DesktopSidebarRestore onExpandSidebar={onExpandSidebar} /> : null}
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-3">
          <PageHeader
            meta={active}
            loading={loading}
            readOnly={readOnly || mutationPending}
            onPrimary={primaryAction}
            quoteSnapshot={state.quoteSnapshot}
          />
          {error ? <StatusBand tone="error">{error}</StatusBand> : null}
          {mutationPending ? (
            <StatusBand>
              Saving market-state change. Controls will unlock after the server acknowledges the
              operation.
            </StatusBand>
          ) : null}
          {readOnly ? <StatusBand>{readOnlyMessage(role)}</StatusBand> : null}
          <div
            className={cn(
              "grid min-h-0 gap-3",
              panel ? "xl:grid-cols-[minmax(0,1fr)_380px]" : "grid-cols-1",
            )}
          >
            <div className="flex min-w-0 flex-col gap-3">
              {activeId === "watchlists" ? (
                <WatchlistPage
                  state={state}
                  filter={filter}
                  setFilter={setFilter}
                  readOnly={readOnly || mutationPending}
                  openPanel={openPanel}
                  invokeTool={invokeTool}
                />
              ) : null}
              {activeId === "portfolios" ? (
                <PortfolioPage
                  state={state}
                  filter={filter}
                  setFilter={setFilter}
                  readOnly={readOnly || mutationPending}
                  openPanel={openPanel}
                  invokeTool={invokeTool}
                  navigate={navigate}
                />
              ) : null}
              {activeId === "alerts" ? (
                <AlertsPage
                  state={state}
                  filter={filter}
                  setFilter={setFilter}
                  readOnly={readOnly || mutationPending}
                  openPanel={openPanel}
                  invokeTool={invokeTool}
                />
              ) : null}
              {activeId === "reports" ? (
                <ReportsPage
                  state={state}
                  readOnly={readOnly || mutationPending}
                  openPanel={openPanel}
                  invokeTool={invokeTool}
                />
              ) : null}
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

function PageHeader({ meta, loading, readOnly, onPrimary, quoteSnapshot }) {
  const freshness = quoteFreshness({ fetchedAt: quoteSnapshot?.generatedAt });
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 px-1">
      <h1 className="text-[17px] font-semibold text-foreground">{meta.title}</h1>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">{freshness.label}</span>
        {freshness.stale ? <Badge tone="warn">stale</Badge> : null}
        <Button
          type="button"
          variant="brand"
          size="sm"
          rounded="full"
          prefixIcon={Plus}
          disabled={readOnly || loading}
          onClick={onPrimary}
        >
          {meta.primaryLabel}
        </Button>
      </div>
    </header>
  );
}

function PanelContent({ panel, state, readOnly, invokeTool, closePanel }) {
  const item = panel.data?.item;
  const lot = panel.data?.lot;

  if (panel.type === "watchlist-add" || panel.type === "watchlist-edit") {
    return (
      <SymbolActionPanel
        key={`${panel.type}:${item?.id ?? item?.symbol ?? "new"}`}
        title={panel.type === "watchlist-add" ? "Add ticker" : "Edit ticker"}
        disabled={readOnly}
        initialSymbol={item?.symbol}
        fields={[
          {
            name: "target_price",
            label: "Target",
            type: "number",
            defaultValue: item?.targetPrice,
          },
          { name: "stop_price", label: "Stop", type: "number", defaultValue: item?.stopPrice },
          { name: "thesis", label: "Thesis", multiline: true, defaultValue: item?.thesis },
          { name: "notes", label: "Notes", multiline: true, defaultValue: item?.notes },
          { name: "tags", label: "Tags", defaultValue: item?.tags?.join(", ") },
        ]}
        onSubmit={async (values) => {
          const saved = await invokeTool(
            "manage_watchlist",
            buildWatchlistMutationArgs(panel.type, values),
          );
          if (saved) closePanel();
          return saved;
        }}
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

  if (panel.type === "alert-create") {
    return <AlertCreateForm disabled={readOnly} invokeTool={invokeTool} onSaved={closePanel} />;
  }

  if (panel.type === "report-configure") {
    return (
      <ReportScheduleForm disabled={readOnly} invokeTool={invokeTool} closePanel={closePanel} />
    );
  }

  return <p className="text-sm text-muted-foreground">Select an action to continue.</p>;
}

function ReportScheduleForm({ disabled, invokeTool, closePanel }) {
  const [localTime, setLocalTime] = useState("08:00");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const saved = await invokeTool("daily_watchlist_report", {
          action: "configure",
          timezone,
          local_time: localTime,
        });
        if (saved) closePanel();
      }}
    >
      <p className="text-sm text-muted-foreground">
        The morning report runs daily while OpenCandle is open. Times use your timezone ({timezone}
        ).
      </p>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Run at
        <Input
          aria-label="Report time"
          type="time"
          value={localTime}
          disabled={disabled}
          required
          onChange={(event) => setLocalTime(event.target.value)}
        />
      </label>
      <Button type="submit" variant="brand" size="sm" disabled={disabled || !localTime}>
        Save schedule
      </Button>
    </form>
  );
}

function ContextPanel({ title, onClose, children }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    // At xl the panel is an in-flow column: scroll it into view. Below xl it is
    // a fixed bottom sheet, so scrolling the document would just jump the page.
    if (window.matchMedia("(min-width: 1280px)").matches) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      node.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    }
    node.focus({ preventScroll: true });
  }, [title]);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-foreground/25 xl:hidden"
        aria-hidden="true"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-xl border border-border bg-card shadow-subtle-md outline-none focus-visible:ring-2 focus-visible:ring-ring xl:sticky xl:top-0 xl:bottom-auto xl:inset-x-auto xl:z-auto xl:max-h-[calc(100vh-120px)] xl:rounded-md xl:shadow-subtle-xs"
      >
        <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-border bg-card px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            icon={X}
            tooltip="Close panel"
            aria-label="Close panel"
            onClick={onClose}
          />
        </div>
        <div className="p-4">{children}</div>
      </aside>
    </>
  );
}

export function SymbolActionPanel({ fields, disabled, initialSymbol = "", onSubmit }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((field) => [field.name, field.defaultValue ?? ""])),
  );
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
      <p className="text-xs text-muted-foreground">
        {resolvedSymbol
          ? `Selected ${resolvedSymbol}`
          : "Search and select a ticker before saving."}
      </p>
      <SymbolSearchInput
        query={query}
        selected={selected}
        disabled={disabled || Boolean(initialSymbol)}
        onQueryChange={setQuery}
        onSelectedChange={setSelected}
      />
      <div className="grid gap-3">
        {fields.map((field) => (
          <label key={field.name} className="grid gap-1 text-xs font-medium text-muted-foreground">
            {field.label}
            {field.type === "select" ? (
              <select
                aria-label={field.label}
                className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground md:h-9"
                value={values[field.name] || ""}
                disabled={disabled}
                required={field.required}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.name]: event.target.value }))
                }
              >
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.multiline ? (
              <Textarea
                aria-label={field.label}
                className="rounded-md border border-border bg-card px-3 py-2"
                value={values[field.name] || ""}
                disabled={disabled}
                required={field.required}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.name]: event.target.value }))
                }
              />
            ) : (
              <Input
                aria-label={field.label}
                type={field.type || "text"}
                step={field.type === "number" ? "any" : undefined}
                placeholder={field.placeholder}
                value={values[field.name] || ""}
                disabled={disabled}
                required={field.required}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.name]: event.target.value }))
                }
              />
            )}
          </label>
        ))}
      </div>
      <Button type="submit" variant="brand" disabled={disabled || !resolvedSymbol}>
        {resolvedSymbol ? "Save" : "Select a ticker to save"}
      </Button>
    </form>
  );
}

export function buildWatchlistMutationArgs(panelType, values) {
  const isEdit = panelType === "watchlist-edit";
  return {
    action: isEdit ? "update" : "add",
    symbol: values.symbol,
    target_price: isEdit
      ? numberOrNull(values.target_price)
      : numberOrUndefined(values.target_price),
    stop_price: isEdit ? numberOrNull(values.stop_price) : numberOrUndefined(values.stop_price),
    thesis: isEdit ? blankToNull(values.thesis) : values.thesis || undefined,
    notes: isEdit ? blankToNull(values.notes) : values.notes || undefined,
    tags: isEdit ? (parseTags(values.tags) ?? []) : parseTags(values.tags),
  };
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
        {resolvedSymbol
          ? `Selected ${resolvedSymbol}`
          : "Search provider-backed candidates and select a resolved ticker before saving."}
      </p>
      <SymbolSearchInput
        query={query}
        selected={selected}
        disabled={disabled || Boolean(lot)}
        onQueryChange={setQuery}
        onSelectedChange={setSelected}
      />
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Quantity
        <Input
          aria-label="Quantity"
          type="number"
          step="any"
          value={values.shares}
          disabled={disabled}
          required
          onChange={(event) => setValues((current) => ({ ...current, shares: event.target.value }))}
        />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Average cost per share
        <Input
          aria-label="Average cost"
          type="number"
          step="any"
          value={values.avg_cost}
          disabled={disabled}
          required
          onChange={(event) =>
            setValues((current) => ({ ...current, avg_cost: event.target.value }))
          }
        />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Currency
        <Input
          aria-label="Currency"
          value={values.currency}
          disabled={disabled}
          onChange={(event) =>
            setValues((current) => ({ ...current, currency: event.target.value }))
          }
        />
      </label>
      <Button
        type="submit"
        variant="brand"
        disabled={disabled || !resolvedSymbol || !values.shares || !values.avg_cost}
      >
        Save
      </Button>
    </form>
  );
}

export function SymbolSearchInput({ query, selected, disabled, onQueryChange, onSelectedChange }) {
  const inputId = useId();
  const listboxId = useId();
  const { candidates, setCandidates, activeIndex, setActiveIndex } = useInstrumentSearch({
    query,
    enabled: query.trim().length >= 2 && !selected,
    minLength: 2,
    limit: 5,
    debounceMs: 180,
    initialActiveIndex: -1,
  });
  const visibleCandidates = query.trim().length >= 2 && !selected ? candidates : [];
  const clampedActiveIndex = clampInstrumentActiveIndex(activeIndex, visibleCandidates.length);
  const activeCandidate = clampedActiveIndex >= 0 ? visibleCandidates[clampedActiveIndex] : null;
  const activeOptionId = activeCandidate
    ? instrumentSuggestionOptionId(listboxId, clampedActiveIndex)
    : undefined;

  const selectCandidate = (candidate) => {
    onSelectedChange(candidate.symbol);
    onQueryChange(`${candidate.symbol} - ${candidate.name || candidate.quoteType}`);
    setCandidates([]);
    setActiveIndex(-1);
  };

  return (
    <div className="relative">
      <label className="sr-only" htmlFor={inputId}>
        Search ticker or company
      </label>
      <Search
        className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"
        aria-hidden="true"
      />
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
            setActiveIndex((index) =>
              nextInstrumentActiveIndex(index, visibleCandidates.length, "next"),
            );
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (visibleCandidates.length === 0) return;
            setActiveIndex((index) =>
              nextInstrumentActiveIndex(index, visibleCandidates.length, "previous"),
            );
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
        <InstrumentSuggestionList
          id={listboxId}
          optionIdPrefix={listboxId}
          candidates={visibleCandidates}
          activeIndex={clampedActiveIndex}
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-subtle-md"
          rowClassName="text-xs"
          onActiveIndexChange={setActiveIndex}
          onSelect={selectCandidate}
        />
      ) : null}
    </div>
  );
}

export const clampComboboxActiveIndex = clampInstrumentActiveIndex;
export const nextComboboxActiveIndex = nextInstrumentActiveIndex;

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
  const needsPeriod =
    condition.includes("_sma") ||
    condition.includes("_rsi_") ||
    condition === "create_volume_spike";
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
      <p className="text-xs text-muted-foreground">
        Pick a symbol and condition. Rules are checked while OpenCandle is open.
      </p>
      <SymbolSearchInput
        query={query}
        selected={selected}
        disabled={disabled}
        onQueryChange={(value) => setDraftField("query", value)}
        onSelectedChange={(value) => setDraftField("selected", value)}
      />
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Condition
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
      </label>
      {supportsThreshold ? (
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          {condition === "create_volume_spike"
            ? "Multiplier (× average volume, optional)"
            : "Threshold"}
          <Input
            aria-label="Alert threshold"
            type="number"
            step="any"
            value={threshold}
            disabled={disabled}
            onChange={(event) => setDraftField("threshold", event.target.value)}
          />
        </label>
      ) : null}
      {needsPeriod ? (
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Period (days)
          <Input
            aria-label="Alert period"
            type="number"
            step="any"
            value={period}
            disabled={disabled}
            onChange={(event) => setDraftField("period", event.target.value)}
          />
        </label>
      ) : null}
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Cooldown between triggers (seconds)
        <Input
          aria-label="Alert cooldown seconds"
          type="number"
          step="any"
          value={cooldown}
          disabled={disabled}
          onChange={(event) => setDraftField("cooldown", event.target.value)}
        />
      </label>
      <div className="rounded-md border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
        {summary}
      </div>
      <Button
        type="submit"
        variant="brand"
        disabled={disabled || !resolvedSymbol || (needsThreshold && !threshold)}
      >
        Create alert
      </Button>
    </form>
  );
}

function readOnlyMessage(role) {
  if (role === "connecting")
    return "Connecting to the GUI session. Saved-state changes will resume when local access is ready.";
  if (role === "disconnected")
    return "Disconnected from the GUI session. Saved-state changes will resume automatically.";
  return "Saved-state changes are unavailable in this window while OpenCandle reconnects local access. Tables, summaries, and details remain available.";
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
      onClick: () =>
        invokeTool("manage_alerts", {
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

function panelTitle(type) {
  const titles = {
    "watchlist-add": "Add Ticker",
    "watchlist-edit": "Edit Ticker",
    "holding-add": "Add Holding",
    "holding-edit": "Edit Holding",
    "alert-create": "Create Alert",
    "report-configure": "Configure Report",
  };
  return titles[type] || "Details";
}
function conditionSummary(condition, threshold, period) {
  const label = condition.replace("create_", "").replaceAll("_", " ");
  if (condition.includes("_sma")) return `${label} over ${period || "the selected"} periods`;
  if (condition.includes("_rsi_"))
    return `${label} ${threshold || "the threshold"} over ${period || "the selected"} periods`;
  if (condition === "create_volume_spike")
    return `has a volume spike above ${threshold || "2"}x the ${period || "selected"}-period average`;
  return `${label} $${threshold || "the threshold"}`;
}

function numberOrUndefined(value) {
  if (value === "" || value == null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numberOrNull(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function blankToNull(value) {
  const text = String(value ?? "").trim();
  return text ? value : null;
}

function parseTags(value) {
  const tags = [];
  for (const part of String(value ?? "").split(",")) {
    const tag = part.trim();
    if (tag) tags.push(tag);
  }
  return tags.length ? tags : undefined;
}
