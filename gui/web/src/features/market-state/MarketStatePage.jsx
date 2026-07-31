import { BellPlus, Loader2, Plus, RefreshCw, Search, Settings, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../components/ui/alert-dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Select } from "../../components/ui/select.jsx";
import { Sheet, SheetContent } from "../../components/ui/sheet.jsx";
import { TOOL_INVOKE_TIMEOUT_MESSAGE } from "../../hooks/useGuiConnection.jsx";
import { useMarketState } from "../../hooks/useMarketState.jsx";
import { useRuntimeTransport } from "../../runtime/runtime-transport-context.jsx";
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

export { nextStateTabIndex, StateTabs } from "./shared.jsx";

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
    primaryIcon: BellPlus,
    primaryPanel: "alert-create",
    secondaryLabel: "Check alerts",
    secondaryIcon: RefreshCw,
  },
  reports: {
    title: "Reports",
    primaryLabel: "Configure report",
    primaryIcon: Settings,
    primaryPanel: "report-configure",
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
  alertSymbol,
  role,
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
  const [panel, setPanel] = useState(() =>
    domain === "alerts" && alertSymbol
      ? { type: "alert-create", data: { symbol: alertSymbol.trim().toUpperCase() } }
      : null,
  );
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
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        if (opener?.isConnected) opener.focus();
      }, 0);
    }
  };

  const primaryAction = () => {
    openPanel(active.primaryPanel);
  };
  const secondaryAction = () => {
    if (activeId === "alerts") invokeTool("manage_alerts", { action: "check" });
  };

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <MobileHeader onOpenSidebar={onOpenSidebar} onOpenHome={onOpenHome} />
      {sidebarCollapsed ? <DesktopSidebarRestore onExpandSidebar={onExpandSidebar} /> : null}
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-3">
          {activeId !== "watchlists" && activeId !== "portfolios" ? (
            <PageHeader
              meta={active}
              loading={loading}
              readOnly={readOnly || mutationPending}
              onPrimary={primaryAction}
              onSecondary={active.secondaryLabel ? secondaryAction : undefined}
            />
          ) : null}
          {error ? <StatusBand tone="error">{error}</StatusBand> : null}
          {mutationPending ? (
            <StatusBand>
              Saving market-state change. Controls will unlock after the server acknowledges the
              operation.
            </StatusBand>
          ) : null}
          {readOnly ? <StatusBand>{readOnlyMessage(role)}</StatusBand> : null}
          <div className="flex min-w-0 flex-col gap-3">
            {activeId === "watchlists" ? (
              <WatchlistPage
                state={state}
                loading={loading}
                filter={filter}
                setFilter={setFilter}
                readOnly={readOnly || mutationPending}
                openPanel={openPanel}
                invokeTool={invokeTool}
                navigate={navigate}
                renderPageHeader={(tabs) => (
                  <PageHeader
                    meta={active}
                    loading={loading}
                    readOnly={readOnly || mutationPending}
                    onPrimary={primaryAction}
                    tabs={tabs}
                  />
                )}
              />
            ) : null}
            {activeId === "portfolios" ? (
              <PortfolioPage
                state={state}
                loading={loading}
                filter={filter}
                setFilter={setFilter}
                readOnly={readOnly || mutationPending}
                openPanel={openPanel}
                invokeTool={invokeTool}
                navigate={navigate}
                renderPageHeader={(tabs) => (
                  <PageHeader
                    meta={active}
                    loading={loading}
                    readOnly={readOnly || mutationPending}
                    onPrimary={primaryAction}
                    tabs={tabs}
                  />
                )}
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
                navigate={navigate}
              />
            </ContextPanel>
          ) : null}
        </div>
      </main>
    </section>
  );
}

function PageHeader({ meta, loading, readOnly, onPrimary, onSecondary, tabs }) {
  const PrimaryIcon = meta.primaryIcon ?? Plus;
  const SecondaryIcon = meta.secondaryIcon;
  return (
    <header className="flex flex-col gap-2 px-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-balance text-[17px] font-semibold text-foreground">{meta.title}</h1>
        <div className="flex items-center gap-2">
          {meta.secondaryLabel && SecondaryIcon ? (
            <Button
              type="button"
              variant="bordered"
              size="sm"
              rounded="full"
              prefixIcon={SecondaryIcon}
              disabled={readOnly || loading}
              onClick={onSecondary}
            >
              {meta.secondaryLabel}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="brand"
            size="sm"
            rounded="full"
            prefixIcon={PrimaryIcon}
            disabled={readOnly || loading}
            onClick={onPrimary}
          >
            {meta.primaryLabel}
          </Button>
        </div>
      </div>
      {tabs ? <div className="border-t border-border">{tabs}</div> : null}
    </header>
  );
}

function PanelContent({ state, panel, readOnly, invokeTool, closePanel, navigate }) {
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
        navigate={navigate}
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
        onDelete={async () => {
          const saved = await invokeTool("manage_watchlist", {
            action: "delete",
            watchlist_name: watchlist.name,
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
        navigate={navigate}
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
    return (
      <AlertCreateForm
        disabled={readOnly}
        invokeTool={invokeTool}
        onSaved={closePanel}
        symbol={panel.data?.symbol}
        navigate={navigate}
      />
    );
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
        navigate={navigate}
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
  return (
    <Sheet
      open
      autoFocus
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" handleLabel={title}>
        <ContextPanelFrame title={title} onClose={onClose}>
          {children}
        </ContextPanelFrame>
      </SheetContent>
    </Sheet>
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
          size="icon-sm"
          icon={X}
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
  const [pending, setPending] = useState(false);
  const trimmed = name.trim();

  const submit = async (event) => {
    event.preventDefault();
    if (!trimmed) return;
    setPending(true);
    try {
      await onSubmit({ name: trimmed });
    } finally {
      setPending(false);
    }
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
      <PendingSubmitButton pending={pending} disabled={disabled || !trimmed}>
        Create portfolio
      </PendingSubmitButton>
    </form>
  );
}

export function WatchlistRenameForm({ disabled, watchlist, onSubmit, onDelete }) {
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="submit" variant="brand" disabled={disabled || !trimmed || unchanged}>
          Rename watchlist
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={disabled || !onDelete}
            >
              Delete watchlist
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {watchlist?.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Tickers in this watchlist will be removed. OpenCandle will keep another watchlist
                active.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => onDelete?.()}
              >
                Delete watchlist
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </form>
  );
}

export function PortfolioRenameForm({ disabled, portfolio, onSubmit }) {
  const nameId = useId();
  const [name, setName] = useState(portfolio?.name ?? "");
  const [pending, setPending] = useState(false);
  const trimmed = name.trim();
  const unchanged = trimmed === (portfolio?.name ?? "");

  const submit = async (event) => {
    event.preventDefault();
    if (!trimmed || unchanged) return;
    setPending(true);
    try {
      await onSubmit({ name: trimmed });
    } finally {
      setPending(false);
    }
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
      <PendingSubmitButton pending={pending} disabled={disabled || !trimmed || unchanged}>
        Rename portfolio
      </PendingSubmitButton>
    </form>
  );
}

export function SymbolActionPanel({ disabled, onSubmit, navigate }) {
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
        navigate={navigate}
      />
      <Button type="submit" variant="brand" disabled={disabled || !resolvedSymbol}>
        {resolvedSymbol ? "Save" : "Select a ticker to save"}
      </Button>
    </form>
  );
}

export function HoldingForm({ disabled, lot, onSubmit, navigate }) {
  const transport = useRuntimeTransport();
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
  const [pending, setPending] = useState(false);
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
    getInstrumentQuote(resolvedSymbol, transport)
      .then((quote) => {
        if (!disposed) applyAutofill(quote);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
    };
  }, [lot, resolvedSymbol, transport]);

  const submit = async (event) => {
    event.preventDefault();
    if (!resolvedSymbol || !values.shares || !values.avg_cost) return;
    setPending(true);
    try {
      await onSubmit({ ...values, symbol: resolvedSymbol });
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
      <p className="text-xs text-muted-foreground">
        {resolvedSymbol
          ? `Selected ${resolvedSymbol}`
          : "Search for a stock or fund, then select a match before saving."}
      </p>
      <SymbolSearchInput
        query={query}
        selected={selected}
        disabled={disabled || pending || Boolean(lot)}
        onQueryChange={setQuery}
        onSelectedChange={setSelected}
        navigate={navigate}
      />
      <label htmlFor={quantityId} className="grid gap-1 text-xs font-medium text-muted-foreground">
        Quantity
        <Input
          id={quantityId}
          type="number"
          step="any"
          value={values.shares}
          disabled={disabled || pending}
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
          disabled={disabled || pending}
          required
          onChange={(event) =>
            setValues((current) => ({ ...current, avg_cost: event.target.value }))
          }
        />
      </label>
      <label htmlFor={currencyId} className="grid gap-1 text-xs font-medium text-muted-foreground">
        Currency
        <Select
          id={currencyId}
          value={values.currency}
          disabled={disabled || pending}
          onChange={(event) =>
            setValues((current) => ({ ...current, currency: event.target.value }))
          }
        >
          {holdingCurrencyOptions(lot?.currency, values.currency).map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </Select>
      </label>
      <PendingSubmitButton
        pending={pending}
        disabled={disabled || !resolvedSymbol || !values.shares || !values.avg_cost}
      >
        Save
      </PendingSubmitButton>
    </form>
  );
}

const HOLDING_CURRENCIES = ["USD", "CAD", "EUR", "GBP", "JPY", "CHF", "AUD"];

function holdingCurrencyOptions(...currencies) {
  return [
    ...new Set([...HOLDING_CURRENCIES, ...currencies.map((currency) => currency?.trim())]),
  ].filter(Boolean);
}

export function PendingSubmitButton({ pending, disabled, children }) {
  return (
    <Button
      type="submit"
      variant="brand"
      className="relative"
      aria-busy={pending || undefined}
      disabled={disabled || pending}
    >
      <span className={pending ? "invisible" : undefined}>{children}</span>
      {pending ? (
        <Loader2 aria-label="Saving" className="absolute size-4 animate-spin" role="status" />
      ) : null}
    </Button>
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

export function SymbolSearchInput({
  query,
  selected,
  disabled,
  onQueryChange,
  onSelectedChange,
  navigate,
}) {
  const transport = useRuntimeTransport();
  const inputId = useId();
  const listboxId = useId();
  const exactSymbolHintId = useId();
  const searchRef = useRef(null);
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
  const allowExactSymbol = transport.kind === "hosted";

  const selectCandidate = (candidate) => {
    onSelectedChange(candidate.symbol);
    onQueryChange(`${candidate.symbol} - ${candidate.name || candidate.quoteType}`);
    setCandidates([]);
    setActiveIndex(-1);
  };

  return (
    <div ref={searchRef} className="relative">
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
        aria-describedby={allowExactSymbol ? exactSymbolHintId : undefined}
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
          } else if (event.key === "Enter") {
            if (activeCandidate) {
              event.preventDefault();
              selectCandidate(activeCandidate);
              return;
            }
            const exactSymbol = allowExactSymbol ? normalizeExactHostedSymbol(query) : "";
            if (exactSymbol) {
              event.preventDefault();
              onSelectedChange(exactSymbol);
              onQueryChange(exactSymbol);
              setCandidates([]);
              setActiveIndex(-1);
            }
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
      {allowExactSymbol ? (
        <p id={exactSymbolHintId} className="mt-1 text-xs text-muted-foreground">
          Search is unavailable in hosted mode. Enter an exact symbol and press Enter.
        </p>
      ) : null}
      {visibleCandidates.length ? (
        <InstrumentSuggestionList
          id={listboxId}
          optionIdPrefix={listboxId}
          candidates={visibleCandidates}
          activeIndex={clampedActiveIndex}
          portalAnchor={searchRef.current}
          className="max-h-64 overflow-y-auto rounded-md border border-border bg-card shadow-subtle-md"
          rowClassName="text-xs"
          onActiveIndexChange={setActiveIndex}
          onSelect={selectCandidate}
          navigate={navigate}
        />
      ) : null}
    </div>
  );
}

export function normalizeExactHostedSymbol(value) {
  const symbol = String(value ?? "")
    .trim()
    .toUpperCase();
  return /^[A-Z0-9][A-Z0-9.^/_-]{0,19}$/.test(symbol) ? symbol : "";
}

export const clampComboboxActiveIndex = clampInstrumentActiveIndex;
export const nextComboboxActiveIndex = nextInstrumentActiveIndex;

const ALERT_COOLDOWN_OPTIONS = [
  { value: 900, label: "15 minutes" },
  { value: 3600, label: "1 hour" },
  { value: 14_400, label: "4 hours" },
  { value: 86_400, label: "1 day" },
];

export function alertConditionFormFields(condition) {
  if (condition === "create_price_above" || condition === "create_price_below") {
    return {
      threshold: { min: undefined, max: undefined, step: "0.01" },
      thresholdLabel: "Price threshold ($)",
      thresholdPlaceholder: "80.00",
      thresholdRequired: true,
    };
  }
  if (condition === "create_rsi_above" || condition === "create_rsi_below") {
    return {
      threshold: { min: 0, max: 100, step: "0.1" },
      thresholdLabel: "RSI level (0–100)",
      thresholdPlaceholder: "30",
      thresholdRequired: true,
      period: { label: "RSI period (days)", min: 1, max: 100 },
    };
  }
  if (condition === "create_percent_move_up" || condition === "create_percent_move_down") {
    return {
      threshold: { min: 0, max: undefined, step: "0.1" },
      thresholdLabel: "Move threshold (%)",
      thresholdPlaceholder: "3.0",
      thresholdRequired: true,
    };
  }
  if (condition === "create_volume_spike") {
    return {
      threshold: { min: undefined, max: undefined, step: "0.1" },
      thresholdLabel: "Volume multiple (× average)",
      thresholdPlaceholder: "2.0",
      thresholdRequired: false,
      period: { label: "Average volume period (days)", min: 1, max: 100 },
    };
  }
  if (condition === "create_sma_cross_above" || condition === "create_sma_cross_below") {
    return {
      fastPeriod: { label: "Fast SMA period (days)", min: 1, max: 399 },
      slowPeriod: { label: "Slow SMA period (days)", min: 1, max: 400 },
    };
  }
  return {
    period: { label: "SMA period (days)", min: 1, max: 200 },
  };
}

function cooldownOptions(value) {
  const selected = numberOrUndefined(value) ?? 3600;
  if (ALERT_COOLDOWN_OPTIONS.some((option) => option.value === selected)) {
    return ALERT_COOLDOWN_OPTIONS;
  }
  return [...ALERT_COOLDOWN_OPTIONS, { value: selected, label: `Custom (${selected}s)` }];
}

export function isAlertDraftValid(draft, fields) {
  const threshold = numberOrUndefined(draft.threshold);
  const period = numberOrUndefined(draft.period);
  const fastPeriod = numberOrUndefined(draft.fast_period);
  const slowPeriod = numberOrUndefined(draft.slow_period);
  if (fields.thresholdRequired && threshold == null) return false;
  if (
    fields.threshold &&
    threshold != null &&
    ((fields.threshold.min != null && threshold < fields.threshold.min) ||
      (fields.threshold.max != null && threshold > fields.threshold.max))
  ) {
    return false;
  }
  if (draft.condition.includes("percent_move") && (threshold == null || threshold <= 0))
    return false;
  if (
    fields.period &&
    (period == null || period < fields.period.min || period > fields.period.max)
  ) {
    return false;
  }
  if (
    fields.fastPeriod &&
    (fastPeriod == null || fastPeriod < fields.fastPeriod.min || fastPeriod > fields.fastPeriod.max)
  ) {
    return false;
  }
  if (
    fields.slowPeriod &&
    (slowPeriod == null || slowPeriod < fields.slowPeriod.min || slowPeriod > fields.slowPeriod.max)
  ) {
    return false;
  }
  if (fields.fastPeriod && fields.slowPeriod && fastPeriod >= slowPeriod) return false;
  return true;
}

export function AlertCreateForm({ disabled, invokeTool, onSaved, alert, symbol, navigate }) {
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
  const fields = alertConditionFormFields(condition);
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
        if (!resolvedSymbol || !isAlertDraftValid(draft, fields)) return;
        const saved = await invokeTool("manage_alerts", {
          action: isEditing ? "update" : condition,
          id: alert?.id,
          condition_action: isEditing ? condition : undefined,
          symbol: resolvedSymbol,
          threshold: fields.threshold && threshold ? Number(threshold) : undefined,
          period: fields.period ? numberOrUndefined(period) : undefined,
          fast_period: fields.fastPeriod ? numberOrUndefined(fast_period) : undefined,
          slow_period: fields.slowPeriod ? numberOrUndefined(slow_period) : undefined,
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
        navigate={navigate}
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
      {fields.threshold ? (
        <label
          htmlFor={thresholdId}
          className="grid gap-1 text-xs font-medium text-muted-foreground"
        >
          {fields.thresholdLabel}
          <Input
            id={thresholdId}
            type="number"
            min={fields.threshold.min}
            max={fields.threshold.max}
            step={fields.threshold.step}
            placeholder={fields.thresholdPlaceholder}
            value={threshold}
            disabled={disabled}
            onChange={(event) => setDraftField("threshold", event.target.value)}
          />
        </label>
      ) : null}
      {fields.period ? (
        <label htmlFor={periodId} className="grid gap-1 text-xs font-medium text-muted-foreground">
          {fields.period.label}
          <Input
            id={periodId}
            type="number"
            min={fields.period.min}
            max={fields.period.max}
            step="1"
            value={period}
            disabled={disabled}
            onChange={(event) => setDraftField("period", event.target.value)}
          />
        </label>
      ) : null}
      {fields.fastPeriod && fields.slowPeriod ? (
        <div className="grid grid-cols-2 gap-2">
          <label
            htmlFor={fastPeriodId}
            className="grid gap-1 text-xs font-medium text-muted-foreground"
          >
            {fields.fastPeriod.label}
            <Input
              id={fastPeriodId}
              type="number"
              min={fields.fastPeriod.min}
              max={fields.fastPeriod.max}
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
            {fields.slowPeriod.label}
            <Input
              id={slowPeriodId}
              type="number"
              min={fields.slowPeriod.min}
              max={fields.slowPeriod.max}
              step="1"
              value={slow_period}
              disabled={disabled}
              onChange={(event) => setDraftField("slow_period", event.target.value)}
            />
          </label>
        </div>
      ) : null}
      <label htmlFor={cooldownId} className="grid gap-1 text-xs font-medium text-muted-foreground">
        Re-alert at most every
        <Select
          id={cooldownId}
          value={cooldown}
          disabled={disabled}
          onChange={(event) => setDraftField("cooldown", event.target.value)}
        >
          {cooldownOptions(cooldown).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>
      <div className="rounded-md border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
        {summary}
      </div>
      <Button
        type="submit"
        variant="brand"
        disabled={disabled || !resolvedSymbol || !isAlertDraftValid(draft, fields)}
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
