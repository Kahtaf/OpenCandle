import { Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { cn } from "../../lib/utils.js";

// Two-step inline confirm for destructive actions; arms on first click, resets after 4s.
export function ConfirmButton({
  label,
  confirmLabel = "Confirm?",
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
      {armed ? confirmLabel : label}
    </Button>
  );
}

export function Panel({ title, count, meta, actions, children }) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-subtle-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {count !== undefined ? (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
              {count}
            </span>
          ) : null}
          {meta ? <p className="text-xs text-muted-foreground">{meta}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
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
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return (
    <span
      className={cn(
        "tabular-nums font-medium",
        value > 0 ? "text-success" : value < 0 ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {sign}
      {Math.abs(value).toFixed(decimals)}%
    </span>
  );
}

export function SignedMoney({ value, percent, currency = "USD" }) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return <span className="text-muted-foreground">—</span>;
  }
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return (
    <span
      className={cn(
        "tabular-nums font-medium",
        value > 0 ? "text-success" : value < 0 ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {sign}
      {money(Math.abs(value), currency)}
      {typeof percent === "number" && Number.isFinite(percent)
        ? ` (${sign}${Math.abs(percent).toFixed(1)}%)`
        : ""}
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

export function Badge({ tone = "neutral", children }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[11px] font-medium",
        tone === "warn"
          ? "border-warning/30 bg-warning/10 text-warning"
          : tone === "ok"
            ? "border-success/30 bg-success/10 text-success"
            : "border-transparent bg-secondary text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
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
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const formatted = value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === "USD" ? `$${formatted}` : `${currency} ${formatted}`;
}

export function moneyOrDash(value, currency = "USD") {
  return typeof value === "number" ? money(value, currency) : "—";
}

export function formatNumber(value) {
  return typeof value === "number" ? value.toLocaleString() : "—";
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
