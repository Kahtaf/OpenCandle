import { Plus, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Select } from "../../components/ui/select.jsx";
import { Sheet, SheetContent } from "../../components/ui/sheet.jsx";
import { TOOL_INVOKE_TIMEOUT_MESSAGE } from "../../hooks/useGuiConnection.jsx";
import { useMarketState } from "../../hooks/useMarketState.jsx";
import { cn } from "../../lib/utils.js";
import { getInstrumentQuote } from "../instruments/instrument-api.js";
import { InstrumentSuggestionList } from "../instruments/instrument-search.jsx";
import {
  clampInstrumentActiveIndex,
  instrumentSuggestionOptionId,
  nextInstrumentActiveIndex,
} from "../instruments/instrument-search-helpers.js";
import { useInstrumentSearch } from "../instruments/use-instrument-search.js";
import { DesktopSidebarRestore, MobileHeader } from "../layout/AppShellChrome.jsx";
import { AlertsPage } from "./AlertsPage.jsx";
import { PortfolioPage } from "./PortfolioPage.jsx";
import { ReportsPage } from "./ReportsPage.jsx";
import { StatusBand } from "./shared.jsx";
import { WatchlistPage } from "./WatchlistPage.jsx";

export { StateTabs } from "./shared.jsx";

const PAGE_META = {
  watchlists: {
    title: "Watchlists",
    primaryLabel: "New Watchlist",
    primaryPanel: "watchlist-create",
  },
  portfolios: {
    title: "Portfolios",
    primaryLabel: "New Portfolio",
    primaryPanel: "portfolio-create",
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

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mediaQuery = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);
    setMatches(mediaQuery.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

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
    await invokeToolRequest(toolName, args, "", { recordTranscript: false });
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
  invokeTool: invokeToolRequest,
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
                  state={state}
                  panel={panel}
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
    <header className="flex flex-wrap items-center justify-between gap-3 px-1">
      <h1 className="text-balance text-[17px] font-semibold text-foreground">{meta.title}</h1>
      <div className="flex flex-wrap items-center gap-3">
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

function PanelContent({ state, panel, readOnly, invokeTool, closePanel }) {
  const lot = panel.data?.lot;
  const alert = panel.data?.alert;
  const watchlist = panel.data?.watchlist;
  const portfolio = panel.data?.portfolio;

  if (panel.type === "watchlist-create") {
    return (
      <WatchlistCreateForm
        disabled={readOnly}
        onSubmit={async (values) => {
          const saved = await invokeTool("manage_watchlist", {
            action: "create",
            watchlist_name: values.name,
          });
          if (saved) closePanel();
          return saved;
        }}
      />
    );
  }

  if (panel.type === "watchlist-add") {
    return (
      <SymbolActionPanel
        key={`${panel.type}:${watchlist?.id ?? "default"}`}
        disabled={readOnly}
        onSubmit={async (values) => {
          const saved = await invokeTool("manage_watchlist", {
            action: "add",
            symbol: values.symbol,
            watchlist_name: watchlist?.name,
          });
          if (saved) closePanel();
          return saved;
        }}
      />
    );
  }

  if (panel.type === "watchlist-rename") {
    if (!watchlist) {
      return <p className="text-sm text-muted-foreground">Select a watchlist to rename.</p>;
    }
    return (
      <WatchlistRenameForm
        key={`${panel.type}:${watchlist.id}`}
        disabled={readOnly}
        watchlist={watchlist}
        onSubmit={async (values) => {
          const saved = await invokeTool("manage_watchlist", {
            action: "rename",
            watchlist_name: watchlist.name,
            new_watchlist_name: values.name,
          });
          if (saved) closePanel();
          return saved;
        }}
      />
    );
  }

  if (panel.type === "portfolio-create") {
    return (
      <PortfolioCreateForm
        disabled={readOnly}
        onSubmit={async (values) => {
          const saved = await invokeTool("track_portfolio", {
            action: "create",
            portfolio_name: values.name,
          });
          if (saved) closePanel();
          return saved;
        }}
      />
    );
  }

  if (panel.type === "portfolio-rename") {
    if (!portfolio) {
      return <p className="text-sm text-muted-foreground">Select a portfolio to rename.</p>;
    }
    return (
      <PortfolioRenameForm
        key={`${panel.type}:${portfolio.id}`}
        disabled={readOnly}
        portfolio={portfolio}
        onSubmit={async (values) => {
          const saved = await invokeTool("track_portfolio", {
            action: "rename",
            portfolio_name: portfolio.name,
            new_portfolio_name: values.name,
          });
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
            portfolio_name: portfolio?.name,
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

  if (panel.type === "alert-edit") {
    if (!alert) {
      return <p className="text-sm text-muted-foreground">Select an alert to edit.</p>;
    }
    return (
      <AlertCreateForm
        key={`${panel.type}:${alert.id}`}
        disabled={readOnly}
        invokeTool={invokeTool}
        alert={alert}
        symbol={
          panel.data?.symbol ??
          state?.instruments?.find((instrument) => instrument.id === alert.instrumentId)?.symbol
        }
        onSaved={closePanel}
      />
    );
  }

  if (panel.type === "report-configure") {
    return (
      <ReportScheduleForm disabled={readOnly} invokeTool={invokeTool} closePanel={closePanel} />
    );
  }

  return <p className="text-sm text-muted-foreground">Select an action to continue.</p>;
}

function ReportScheduleForm({ disabled, invokeTool, closePanel }) {
  const reportTimeId = useId();
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
      <label
        htmlFor={reportTimeId}
        className="grid gap-1 text-xs font-medium text-muted-foreground"
      >
        Run at
        <Input
          id={reportTimeId}
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

export function ContextPanel({ title, onClose, children }) {
  const panelRef = useRef(null);
  const isInlinePanel = useMediaQuery("(min-width: 1280px)");

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus/scroll should run when a different panel title is opened.
  useEffect(() => {
    if (!isInlinePanel) return;
    const node = panelRef.current;
    if (!node) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    node.focus({ preventScroll: true });
  }, [isInlinePanel, title]);

  if (!isInlinePanel) {
    return (
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <SheetContent width="md" handleLabel={title}>
          <ContextPanelFrame title={title} onClose={onClose}>
            {children}
          </ContextPanelFrame>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className="sticky top-0 flex h-auto max-h-[calc(100vh-120px)] flex-col overflow-hidden rounded-md border border-border bg-card shadow-subtle-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ContextPanelFrame title={title} onClose={onClose}>
        {children}
      </ContextPanelFrame>
    </aside>
  );
}

function ContextPanelFrame({ title, onClose, children }) {
  return (
    <>
      <div className="sticky top-0 flex shrink-0 items-center justify-between gap-2 border-b border-border bg-secondary px-4 py-3">
        <h2 className="text-balance text-sm font-semibold text-foreground">{title}</h2>
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
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </>
  );
}

export function WatchlistCreateForm({ disabled, onSubmit }) {
  const nameId = useId();
  const [name, setName] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const saved = await onSubmit({ name: trimmed });
    if (saved === false) return;
    setName("");
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
      <label htmlFor={nameId} className="grid gap-1 text-xs font-medium text-muted-foreground">
        Name
        <Input
          id={nameId}
          aria-label="Watchlist name"
          value={name}
          disabled={disabled}
          required
          placeholder="ETFs"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <Button type="submit" variant="brand" disabled={disabled || !name.trim()}>
        Create watchlist
      </Button>
    </form>
  );
}

export function PortfolioCreateForm({ disabled, onSubmit }) {
  const nameId = useId();
  const [name, setName] = useState("");
  const trimmed = name.trim();

  const submit = async (event) => {
    event.preventDefault();
    if (!trimmed) return;
    await onSubmit({ name: trimmed });
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
      <label htmlFor={nameId} className="grid gap-1 text-xs font-medium text-muted-foreground">
        Name
        <Input
          id={nameId}
          aria-label="Portfolio name"
          value={name}
          disabled={disabled}
          required
          placeholder="Trading"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <Button type="submit" variant="brand" disabled={disabled || !trimmed}>
        Create portfolio
      </Button>
    </form>
  );
}

export function WatchlistRenameForm({ disabled, watchlist, onSubmit }) {
  const nameId = useId();
  const [name, setName] = useState(watchlist?.name ?? "");
  const trimmed = name.trim();
  const unchanged = trimmed === (watchlist?.name ?? "");

  const submit = async (event) => {
    event.preventDefault();
    if (!trimmed || unchanged) return;
    await onSubmit({ name: trimmed });
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
      <label htmlFor={nameId} className="grid gap-1 text-xs font-medium text-muted-foreground">
        Name
        <Input
          id={nameId}
          aria-label="Watchlist name"
          value={name}
          disabled={disabled}
          required
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <Button type="submit" variant="brand" disabled={disabled || !trimmed || unchanged}>
        Rename watchlist
      </Button>
    </form>
  );
}

export function PortfolioRenameForm({ disabled, portfolio, onSubmit }) {
  const nameId = useId();
  const [name, setName] = useState(portfolio?.name ?? "");
  const trimmed = name.trim();
  const unchanged = trimmed === (portfolio?.name ?? "");

  const submit = async (event) => {
    event.preventDefault();
    if (!trimmed || unchanged) return;
    await onSubmit({ name: trimmed });
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
      <label htmlFor={nameId} className="grid gap-1 text-xs font-medium text-muted-foreground">
        Name
        <Input
          id={nameId}
          aria-label="Portfolio name"
          value={name}
          disabled={disabled}
          required
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <Button type="submit" variant="brand" disabled={disabled || !trimmed || unchanged}>
        Rename portfolio
      </Button>
    </form>
  );
}

export function SymbolActionPanel({ disabled, onSubmit }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const resolvedSymbol = selected;

  const submit = async (event) => {
    event.preventDefault();
    if (!resolvedSymbol) return;
    const saved = await onSubmit({ symbol: resolvedSymbol });
    if (saved === false) return;
    setQuery("");
    setSelected("");
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
        disabled={disabled}
        onQueryChange={setQuery}
        onSelectedChange={setSelected}
      />
      <Button type="submit" variant="brand" disabled={disabled || !resolvedSymbol}>
        {resolvedSymbol ? "Save" : "Select a ticker to save"}
      </Button>
    </form>
  );
}

export function HoldingForm({ disabled, lot, onSubmit }) {
  const quantityId = useId();
  const averageCostId = useId();
  const currencyId = useId();
  const previousAutofillRef = useRef({
    shares: "",
    avg_cost: "",
    currency: lot?.currency ?? "USD",
  });
  const [values, setValues] = useState({
    shares: lot?.quantity ?? "",
    avg_cost: lot?.avgCost ?? "",
    currency: lot?.currency ?? "USD",
  });
  const [query, setQuery] = useState(lot?.symbol ?? "");
  const [selected, setSelected] = useState(lot?.symbol ?? "");
  const resolvedSymbol = selected || lot?.symbol;

  useEffect(() => {
    if (lot || !resolvedSymbol) return undefined;

    let disposed = false;
    const applyAutofill = (selectedQuote) => {
      const defaults = getHoldingAutofillDefaults({
        selectedSymbol: resolvedSymbol,
        selectedQuote,
      });
      setValues((current) =>
        getHoldingAutofillValues({
          selectedSymbol: resolvedSymbol,
          currentValues: current,
          previousAutofill: previousAutofillRef.current,
          selectedQuote,
        }),
      );
      previousAutofillRef.current = defaults;
    };

    applyAutofill(null);
    getInstrumentQuote(resolvedSymbol)
      .then((quote) => {
        if (!disposed) applyAutofill(quote);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
    };
  }, [lot, resolvedSymbol]);

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
      <label htmlFor={quantityId} className="grid gap-1 text-xs font-medium text-muted-foreground">
        Quantity
        <Input
          id={quantityId}
          type="number"
          step="any"
          value={values.shares}
          disabled={disabled}
          required
          onChange={(event) => setValues((current) => ({ ...current, shares: event.target.value }))}
        />
      </label>
      <label
        htmlFor={averageCostId}
        className="grid gap-1 text-xs font-medium text-muted-foreground"
      >
        Average cost per share
        <Input
          id={averageCostId}
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
      <label htmlFor={currencyId} className="grid gap-1 text-xs font-medium text-muted-foreground">
        Currency
        <Input
          id={currencyId}
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

function getHoldingAutofillDefaults({ selectedSymbol, selectedQuote }) {
  if (!selectedSymbol) return { shares: "", avg_cost: "", currency: "" };
  const quote =
    selectedQuote?.status === "ok" && Number.isFinite(selectedQuote.price) ? selectedQuote : null;
  return {
    shares: "100",
    avg_cost: quote ? formatAutofillNumber(quote.price) : "",
    currency: quote?.currency ? String(quote.currency).trim().toUpperCase() : "USD",
  };
}

export function getHoldingAutofillValues({
  selectedSymbol,
  currentValues,
  previousAutofill,
  selectedQuote,
}) {
  const current = {
    shares: String(currentValues?.shares ?? ""),
    avg_cost: String(currentValues?.avg_cost ?? ""),
    currency: String(currentValues?.currency ?? ""),
  };
  const defaults = getHoldingAutofillDefaults({ selectedSymbol, selectedQuote });
  const replaceableValue = (field) =>
    current[field] === "" ||
    current[field] === String(previousAutofill?.[field] ?? (field === "currency" ? "USD" : ""));

  return {
    shares: defaults.shares && replaceableValue("shares") ? defaults.shares : current.shares,
    avg_cost:
      defaults.avg_cost && replaceableValue("avg_cost") ? defaults.avg_cost : current.avg_cost,
    currency:
      defaults.currency && replaceableValue("currency") ? defaults.currency : current.currency,
  };
}

function formatAutofillNumber(value) {
  return Number.parseFloat(String(value)).toString();
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

export function AlertCreateForm({ disabled, invokeTool, onSaved, alert, symbol }) {
  const conditionId = useId();
  const thresholdId = useId();
  const periodId = useId();
  const fastPeriodId = useId();
  const slowPeriodId = useId();
  const cooldownId = useId();
  const isEditing = Boolean(alert);
  const [draft, setDraft] = useState(() => initialAlertDraft(alert, symbol));
  const setDraftField = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const { query, selected, threshold, condition, period, fast_period, slow_period, cooldown } =
    draft;
  const needsThreshold = [
    "create_price_above",
    "create_price_below",
    "create_rsi_above",
    "create_rsi_below",
    "create_percent_move_up",
    "create_percent_move_down",
  ].includes(condition);
  const supportsThreshold = needsThreshold || condition === "create_volume_spike";
  const needsPeriod =
    condition.includes("_sma") ||
    condition.includes("_rsi_") ||
    condition === "create_volume_spike";
  const needsFastSlow = condition.includes("sma_cross");
  const resolvedSymbol = selected;
  const summary = resolvedSymbol
    ? `Notify once when ${resolvedSymbol} ${conditionSummary(
        condition,
        threshold,
        period,
        fast_period,
        slow_period,
      )} during a manual or local-runner check.`
    : "Select an instrument to preview the alert rule.";

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!resolvedSymbol || (needsThreshold && !threshold)) return;
        const saved = await invokeTool("manage_alerts", {
          action: isEditing ? "update" : condition,
          id: alert?.id,
          condition_action: isEditing ? condition : undefined,
          symbol: resolvedSymbol,
          threshold: supportsThreshold && threshold ? Number(threshold) : undefined,
          period: needsPeriod ? Number(period) : undefined,
          fast_period: needsFastSlow ? Number(fast_period) : undefined,
          slow_period: needsFastSlow ? Number(slow_period) : undefined,
          cooldown_seconds: numberOrUndefined(cooldown),
        });
        if (saved) {
          if (!isEditing) {
            setDraft((current) => ({ ...current, query: "", selected: "", threshold: "" }));
          }
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
      <label htmlFor={conditionId} className="grid gap-1 text-xs font-medium text-muted-foreground">
        Condition
        <Select
          id={conditionId}
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
          <option value="create_percent_move_up">Percent move up</option>
          <option value="create_percent_move_down">Percent move down</option>
          <option value="create_sma_cross_above">Fast SMA crosses above slow SMA</option>
          <option value="create_sma_cross_below">Fast SMA crosses below slow SMA</option>
        </Select>
      </label>
      {supportsThreshold ? (
        <label
          htmlFor={thresholdId}
          className="grid gap-1 text-xs font-medium text-muted-foreground"
        >
          {condition === "create_volume_spike"
            ? "Multiplier (× average volume, optional)"
            : "Threshold"}
          <Input
            id={thresholdId}
            type="number"
            step="any"
            value={threshold}
            disabled={disabled}
            onChange={(event) => setDraftField("threshold", event.target.value)}
          />
        </label>
      ) : null}
      {needsPeriod && !needsFastSlow ? (
        <label htmlFor={periodId} className="grid gap-1 text-xs font-medium text-muted-foreground">
          Period (days)
          <Input
            id={periodId}
            type="number"
            step="any"
            value={period}
            disabled={disabled}
            onChange={(event) => setDraftField("period", event.target.value)}
          />
        </label>
      ) : null}
      {needsFastSlow ? (
        <div className="grid grid-cols-2 gap-2">
          <label
            htmlFor={fastPeriodId}
            className="grid gap-1 text-xs font-medium text-muted-foreground"
          >
            Fast period
            <Input
              id={fastPeriodId}
              type="number"
              step="1"
              value={fast_period}
              disabled={disabled}
              onChange={(event) => setDraftField("fast_period", event.target.value)}
            />
          </label>
          <label
            htmlFor={slowPeriodId}
            className="grid gap-1 text-xs font-medium text-muted-foreground"
          >
            Slow period
            <Input
              id={slowPeriodId}
              type="number"
              step="1"
              value={slow_period}
              disabled={disabled}
              onChange={(event) => setDraftField("slow_period", event.target.value)}
            />
          </label>
        </div>
      ) : null}
      <label htmlFor={cooldownId} className="grid gap-1 text-xs font-medium text-muted-foreground">
        Cooldown between triggers (seconds)
        <Input
          id={cooldownId}
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
        {isEditing ? "Save alert" : "Create alert"}
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

function panelTitle(type) {
  const titles = {
    "watchlist-create": "New Watchlist",
    "watchlist-add": "Add Ticker",
    "watchlist-rename": "Rename Watchlist",
    "portfolio-create": "New Portfolio",
    "portfolio-rename": "Rename Portfolio",
    "holding-add": "Add Holding",
    "holding-edit": "Edit Holding",
    "alert-create": "Create Alert",
    "alert-edit": "Edit Alert",
    "report-configure": "Configure Report",
  };
  return titles[type] || "Details";
}
function initialAlertDraft(alert, symbol) {
  const condition = alert ? conditionActionFromAlert(alert) : "create_price_above";
  const conditionJson =
    alert?.conditionJson && typeof alert.conditionJson === "object" ? alert.conditionJson : {};
  return {
    query: symbol ?? "",
    selected: symbol ?? "",
    threshold: alertThresholdValue(condition, conditionJson),
    condition,
    period: alertPeriodValue(condition, conditionJson),
    fast_period: stringifyDraftValue(conditionJson.fast_period ?? 50),
    slow_period: stringifyDraftValue(conditionJson.slow_period ?? 200),
    cooldown: stringifyDraftValue(alert?.cooldownSeconds ?? 3600),
  };
}

function conditionActionFromAlert(alert) {
  const condition =
    alert?.conditionJson && typeof alert.conditionJson === "object" ? alert.conditionJson : {};
  const direction = condition.direction;
  if (alert?.conditionType === "price_crosses_below") return "create_price_below";
  if (alert?.conditionType === "price_crosses_above") return "create_price_above";
  if (alert?.conditionType === "price_crosses_sma") {
    return direction === "below" ? "create_price_below_sma" : "create_price_above_sma";
  }
  if (alert?.conditionType === "rsi_threshold") {
    return direction === "below" ? "create_rsi_below" : "create_rsi_above";
  }
  if (alert?.conditionType === "volume_spike") return "create_volume_spike";
  if (alert?.conditionType === "percent_move") {
    return direction === "down" ? "create_percent_move_down" : "create_percent_move_up";
  }
  if (alert?.conditionType === "sma_cross") {
    return direction === "below" ? "create_sma_cross_below" : "create_sma_cross_above";
  }
  return "create_price_above";
}

function alertThresholdValue(condition, conditionJson) {
  if (condition === "create_volume_spike") {
    return stringifyDraftValue(conditionJson.multiplier ?? 2);
  }
  if (condition === "create_percent_move_up" || condition === "create_percent_move_down") {
    return stringifyDraftValue(conditionJson.percent ?? "");
  }
  return stringifyDraftValue(conditionJson.threshold ?? "");
}

function alertPeriodValue(condition, conditionJson) {
  if (condition === "create_volume_spike") {
    return stringifyDraftValue(conditionJson.lookback_period ?? 20);
  }
  if (condition.includes("_rsi_")) return stringifyDraftValue(conditionJson.period ?? 14);
  if (condition.includes("_sma")) return stringifyDraftValue(conditionJson.period ?? 50);
  return "14";
}

function stringifyDraftValue(value) {
  return value == null ? "" : String(value);
}

function conditionSummary(condition, threshold, period, fastPeriod, slowPeriod) {
  const label = condition.replace("create_", "").replaceAll("_", " ");
  if (condition.includes("sma_cross")) {
    return `${label} using ${fastPeriod || "fast"} and ${slowPeriod || "slow"} periods`;
  }
  if (condition.includes("percent_move")) return `${label} ${threshold || "the threshold"}%`;
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
