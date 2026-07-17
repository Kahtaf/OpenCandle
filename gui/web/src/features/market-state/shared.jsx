import { Pencil, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import {
  formatNumber as formatFinancialNumber,
  formatMoney,
  formatPercent,
  formatSignedMoney,
} from "../../lib/financial-format.js";
import { cn } from "../../lib/utils.js";
import { quoteChangeDirections } from "./format.js";

// Two-step inline confirm for destructive actions; arms on first click, resets after 4s.
export function ConfirmButton({
  label,
  confirmLabel = "Confirm?",
  icon,
  ariaLabel,
  disabled,
  onConfirm,
  variant = "ghost",
  size = "xs",
  className,
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return undefined;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return (
    <Button
      type="button"
      variant={armed ? "bordered" : variant}
      size={size}
      icon={armed ? undefined : icon}
      aria-label={armed ? confirmLabel : ariaLabel}
      className={cn(armed && "border-destructive/40 text-destructive", className)}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      <span className={cn(icon && !armed && "sr-only")}>{armed ? confirmLabel : label}</span>
    </Button>
  );
}

export function Panel({ title, count, meta, actions, children }) {
  const hasDetails = title || count !== undefined || meta;
  const hasHeader = hasDetails || actions;

  return (
    <section className="rounded-xl border border-border bg-card shadow-subtle-xs">
      {hasHeader ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          {hasDetails ? (
            <div className="flex min-w-0 items-center gap-2">
              {title ? (
                <h2 className="text-balance text-sm font-semibold text-foreground">{title}</h2>
              ) : null}
              {count !== undefined ? (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {count}
                </span>
              ) : null}
              {meta ? <p className="text-xs text-muted-foreground">{meta}</p> : null}
            </div>
          ) : null}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function InspectorSection({ title, children }) {
  return (
    <section className="border-b border-border p-4 last:border-0">
      <h3 className="mb-2 text-balance text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function PanelSearch({ label, filter, setFilter }) {
  const inputId = useId();
  return (
    <label htmlFor={inputId} className="relative">
      <span className="sr-only">{label}</span>
      <Search
        className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        id={inputId}
        className="h-8 w-44 pl-8 text-xs"
        placeholder={label}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
    </label>
  );
}

export function EmptyState({ icon: Icon, title, action, cta }) {
  return (
    <div className="flex min-h-[120px] flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs leading-5 text-muted-foreground">{action}</div>
      </div>
      {cta ? (
        <Button
          type="button"
          variant="bordered"
          size="sm"
          disabled={cta.disabled}
          onClick={cta.onClick}
        >
          {cta.label}
        </Button>
      ) : null}
    </div>
  );
}

export function StatusBand({ tone = "default", children }) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-xs",
        tone === "error"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border bg-secondary text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

export function Sym({ symbol, name }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] font-semibold text-foreground">{symbol}</div>
      {name ? <div className="truncate text-[11px] text-muted-foreground">{name}</div> : null}
    </div>
  );
}

export function SignedPercent({ value, decimals = 2 }) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span
      className={cn(
        "tabular-nums font-medium",
        value > 0 ? "text-success" : value < 0 ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {formatPercent(value, { decimals, signed: true })}
    </span>
  );
}

export function SignedMoney({ value, percent, currency = "USD" }) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span
      className={cn(
        "tabular-nums font-medium",
        value > 0 ? "text-success" : value < 0 ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {formatSignedMoney(value, currency)}
      {typeof percent === "number" && Number.isFinite(percent)
        ? ` (${formatPercent(percent, { decimals: 1, signed: true })})`
        : ""}
    </span>
  );
}

export function ExtendedHoursQuote({ quote, currency = "USD", className }) {
  if (
    !quote ||
    (quote.marketState !== "PRE" && quote.marketState !== "POST") ||
    typeof quote.extendedPrice !== "number" ||
    !Number.isFinite(quote.extendedPrice)
  ) {
    return null;
  }
  const isPreMarket = quote.marketState === "PRE";
  const hasChange =
    Number.isFinite(quote.extendedChangePercent) || Number.isFinite(quote.extendedChange);
  return (
    <div
      data-slot="extended-hours-quote"
      className={cn(
        "mt-1 flex max-w-full items-center justify-end gap-1 whitespace-nowrap text-[11px] leading-4",
        className,
      )}
    >
      <span
        data-slot="extended-session-dot"
        className={cn("size-1.5 shrink-0 rounded-full", isPreMarket ? "bg-warning" : "bg-info")}
        aria-hidden="true"
      />
      <span className="truncate text-muted-foreground">
        {isPreMarket ? "Pre-market" : "After hours"} {money(quote.extendedPrice, currency)}
      </span>
      {hasChange ? (
        <span className="text-muted-foreground" aria-hidden="true">
          ·
        </span>
      ) : null}
      {hasChange ? (
        <ExtendedHoursChange
          change={quote.extendedChange}
          changePercent={quote.extendedChangePercent}
          currency={currency}
        />
      ) : null}
    </div>
  );
}

function ExtendedHoursChange({ change, changePercent, currency }) {
  if (!Number.isFinite(change) && !Number.isFinite(changePercent)) return null;
  const signedValue = Number.isFinite(change) ? change : changePercent;
  const tone =
    signedValue > 0
      ? "text-success"
      : signedValue < 0
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <span className={cn("tabular-nums font-medium", tone)}>
      {Number.isFinite(changePercent)
        ? formatPercent(changePercent, { decimals: 2, signed: true })
        : formatSignedMoney(change, currency)}
    </span>
  );
}

export function StatusDot({ tone, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn(
          "size-[7px] rounded-full",
          tone === "armed" ? "bg-success" : tone === "degraded" ? "bg-warning" : "bg-hard",
        )}
      />
      {label}
    </span>
  );
}

export function Badge({ tone = "neutral", children, className, ...props }) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[11px] font-medium",
        tone === "warn"
          ? "border-warning/30 bg-warning/10 text-warning"
          : tone === "ok"
            ? "border-success/30 bg-success/10 text-success"
            : tone === "info"
              ? "border-info/30 bg-info/10 text-info"
              : "border-transparent bg-secondary text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function useQuoteChangeFlash(quotes) {
  const previousQuotes = useRef(null);
  const [directions, setDirections] = useState(() => new Map());

  useEffect(() => {
    const previous = previousQuotes.current;
    previousQuotes.current = quotes;
    if (!previous) return undefined;

    const nextDirections = quoteChangeDirections(previous, quotes);
    if (nextDirections.size === 0) return undefined;
    setDirections(nextDirections);
    const timer = window.setTimeout(() => setDirections(new Map()), 200);
    return () => window.clearTimeout(timer);
  }, [quotes]);

  return directions;
}

export function quoteFlashClass(direction) {
  if (!direction) return "";
  return cn(
    "transition-colors duration-200 ease-out motion-reduce:transition-none motion-reduce:bg-transparent",
    direction === "up" ? "bg-success/[0.08]" : "bg-destructive/[0.08]",
  );
}

export function StateTabs({
  items,
  activeItem,
  counts,
  readOnly,
  renameLabel,
  onSelect,
  onRename,
  compactSingle = false,
}) {
  const tabRefs = useRef(new Map());
  const singleItem = compactSingle && items.length === 1;

  const onTabKeyDown = (event, index) => {
    const nextIndex = nextStateTabIndex(index, items.length, event.key);
    if (nextIndex === index) return;
    event.preventDefault();
    const nextItem = items[nextIndex];
    onSelect(nextItem.id);
    tabRefs.current.get(nextItem.id)?.focus();
  };

  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      <div
        data-slot={singleItem ? "single-state-tab" : "state-tabs"}
        className={cn("flex min-w-0 gap-1 overflow-x-auto", singleItem ? "flex-none" : "flex-1")}
        role="tablist"
        aria-orientation="horizontal"
      >
        {items.map((item, index) => {
          const active = item.id === activeItem?.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              ref={(node) => {
                if (node) tabRefs.current.set(item.id, node);
                else tabRefs.current.delete(item.id);
              }}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-[background-color,color,box-shadow,scale] duration-150 ease-out active:scale-[0.96] md:min-h-8",
                active ? "bg-background text-foreground shadow-subtle-xs" : "hover:bg-secondary",
              )}
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              <span>{item.name}</span>
              {!singleItem ? (
                <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {counts.get(item.id) ?? 0}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {activeItem ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          icon={Pencil}
          title={`${renameLabel} ${activeItem.name}`}
          aria-label={`${renameLabel} ${activeItem.name}`}
          disabled={readOnly}
          className="size-10 md:size-8"
          onClick={() => onRename(activeItem)}
        />
      ) : null}
    </div>
  );
}

export function nextStateTabIndex(currentIndex, itemCount, key) {
  if (itemCount < 1) return -1;
  if (key === "ArrowRight") return (currentIndex + 1) % itemCount;
  if (key === "ArrowLeft") return (currentIndex - 1 + itemCount) % itemCount;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  return currentIndex;
}

export function RowActions({ actions, disabled }) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {actions.map((action) => (
        <RowActionButton
          key={Array.isArray(action) ? action[0] : action.label}
          action={action}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

export function RowActionButton({ action, disabled }) {
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

export function money(value, currency = "USD") {
  return formatMoney(value, currency);
}

export function moneyOrDash(value, currency = "USD") {
  return typeof value === "number" ? money(value, currency) : "—";
}

export function formatNumber(value) {
  return formatFinancialNumber(value);
}

export function groupBy(items, key) {
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

export function groupByOne(items, key) {
  const map = new Map();
  for (const item of items || []) {
    const id = item?.[key];
    if (id == null) continue;
    map.set(id, item);
  }
  return map;
}

export function filterItems(items, filter, keys) {
  const query = filter.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) =>
    keys.some((key) => {
      const value = item?.[key];
      if (Array.isArray(value)) return value.join(" ").toLowerCase().includes(query);
      return String(value ?? "")
        .toLowerCase()
        .includes(query);
    }),
  );
}
