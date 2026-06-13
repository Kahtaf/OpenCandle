import { Check, ChevronDown, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import { Input } from "../../components/ui/input.jsx";
import { cn } from "../../lib/utils.js";
import { useStableId } from "./use-stable-id.js";

// ---------------------------------------------------------------------------
// Field — wraps every input with a hairline-spaced label, hint, and required mark
// ---------------------------------------------------------------------------

export function Field({ label, hint, required = false, children, className }) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="flex items-baseline justify-between gap-3 text-xs font-medium text-foreground">
        <span>
          {label}
          {required ? (
            <span className="text-foreground/40" aria-hidden="true">
              {" "}
              *
            </span>
          ) : null}
        </span>
        {hint ? (
          <span className="text-[11px] font-normal text-muted-foreground">{hint}</span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// SegmentedControl — pill-style enum picker for short option sets (3–5 items)
// ---------------------------------------------------------------------------

export function SegmentedControl({ value, onChange, options, ariaLabel }) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex h-9 items-center rounded-md border border-border bg-card p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-8 min-w-9 items-center justify-center rounded-[4px] px-2.5 text-xs font-medium tabular-nums transition-colors",
              selected
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EnumSelect — for longer enum lists; native select with consistent chrome
// ---------------------------------------------------------------------------

export function EnumSelect({ value, onChange, options, placeholder, ariaLabel }) {
  return (
    <div className="relative">
      <select
        aria-label={ariaLabel}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || undefined)}
        className="h-9 w-full appearance-none rounded-md border border-border bg-card px-3 pr-9 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {placeholder ? (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// NumberWithChips — preset chips + free-form number input. Useful for periods
// expressed as days/hours/years where common values dominate.
// ---------------------------------------------------------------------------

export function NumberWithChips({
  value,
  onChange,
  presets,
  suffix,
  min,
  max,
  step = 1,
  placeholder,
}) {
  const isPreset = presets.some((preset) => preset.value === value);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((preset) => {
          const selected = preset.value === value;
          return (
            <button
              key={String(preset.value)}
              type="button"
              onClick={() => onChange(preset.value)}
              className={cn(
                "inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium tabular-nums transition-colors",
                selected
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <div className="relative w-32">
        <Input
          type="number"
          inputMode="numeric"
          value={isPreset ? "" : (value ?? "")}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder ?? "Custom"}
          onChange={(event) => {
            const next = event.target.value === "" ? undefined : Number(event.target.value);
            onChange(next);
          }}
          className="h-8 pr-8 text-xs tabular-nums"
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SymbolInput — single ticker input with uppercase coercion and live suggestions
// from a passed-in lookup function (e.g. search_ticker tool wrapper)
// ---------------------------------------------------------------------------

export function SymbolInput({ value, onChange, lookup, placeholder = "AAPL", ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState({ query: "", items: [] });
  const [pendingQuery, setPendingQuery] = useState("");
  const debounce = useRef(null);
  const query = String(value || "").trim();
  const visibleSuggestions = suggestions.query === query ? suggestions.items : [];
  const pending = pendingQuery === query && query.length > 0;

  useEffect(() => {
    if (!lookup) return undefined;
    if (query.length < 1) {
      return undefined;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setPendingQuery(query);
      try {
        const results = await lookup(query);
        setSuggestions({ query, items: results.slice(0, 6) });
      } catch {
        setSuggestions({ query, items: [] });
      } finally {
        setPendingQuery((current) => (current === query ? "" : current));
      }
    }, 180);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, lookup]);

  return (
    <div className="relative">
      <Input
        aria-label={ariaLabel}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className="h-9 tabular-nums"
        autoCapitalize="characters"
      />
      {open && visibleSuggestions.length > 0 ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-md border border-border bg-card shadow-subtle-sm">
          {visibleSuggestions.map((s) => (
            <button
              key={s.symbol}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(s.symbol);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-secondary"
            >
              <span className="font-medium tabular-nums text-foreground">{s.symbol}</span>
              <span className="truncate text-xs text-muted-foreground">{s.name}</span>
            </button>
          ))}
        </div>
      ) : null}
      {pending ? (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wider text-muted-foreground">
          …
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SymbolChips — multi-ticker chip input with per-chip remove and inline add
// ---------------------------------------------------------------------------

export function SymbolChips({
  value = [],
  onChange,
  placeholder = "Add ticker",
  min,
  max,
  ariaLabel = "Ticker symbols",
}) {
  const [draft, setDraft] = useState("");
  const limitReached = max != null && value.length >= max;

  const add = () => {
    const next = draft.trim().toUpperCase();
    if (!next) return;
    if (value.includes(next)) {
      setDraft("");
      return;
    }
    if (limitReached) return;
    onChange([...value, next]);
    setDraft("");
  };

  const remove = (symbol) => onChange(value.filter((entry) => entry !== symbol));

  const onKeyDown = (event) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add();
    } else if (event.key === "Backspace" && !draft && value.length > 0) {
      event.preventDefault();
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div>
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
        {value.map((symbol) => (
          <span
            key={symbol}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-1.5 py-0.5 text-xs font-medium tabular-nums text-foreground"
          >
            {symbol}
            <button
              type="button"
              aria-label={`Remove ${symbol}`}
              onClick={() => remove(symbol)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          aria-label={ariaLabel}
          value={draft}
          onChange={(event) => setDraft(event.target.value.toUpperCase())}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? placeholder : ""}
          disabled={limitReached}
          className="min-w-[80px] flex-1 bg-transparent py-1 text-xs tabular-nums text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-40"
          autoCapitalize="characters"
        />
        {draft.trim() ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Add ticker"
            onClick={add}
          >
            <Plus />
          </Button>
        ) : null}
      </div>
      {min != null && value.length < min ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Add at least {min} symbol{min === 1 ? "" : "s"}.
        </p>
      ) : null}
      {max != null ? (
        <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
          {value.length}/{max}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MultiSelectChips — fixed option set, click to toggle (filing types, source filters)
// ---------------------------------------------------------------------------

export function MultiSelectChips({ value = [], onChange, options }) {
  const toggle = (key) => {
    if (value.includes(key)) onChange(value.filter((entry) => entry !== key));
    else onChange([...value, key]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const selected = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => toggle(option.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors",
              selected
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {selected ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DateInput — native date picker, formatted to YYYY-MM-DD
// ---------------------------------------------------------------------------

export function DateInput({ value, onChange, min, max, placeholder = "YYYY-MM-DD" }) {
  return (
    <Input
      type="date"
      value={value ?? ""}
      min={min}
      max={max}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value || undefined)}
      className="h-9 tabular-nums"
    />
  );
}

// ---------------------------------------------------------------------------
// FreeText — long-form input for goals/objectives/queries with character hint
// ---------------------------------------------------------------------------

export function FreeText({
  value,
  onChange,
  placeholder,
  rows = 3,
  maxLength,
  ariaLabel = "Text input",
}) {
  return (
    <div>
      <textarea
        aria-label={ariaLabel}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
        className="block w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />
      {maxLength ? (
        <div className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">
          {(value || "").length}/{maxLength}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MoneyInput — number with currency prefix, locale-aware grouping on blur
// ---------------------------------------------------------------------------

export function MoneyInput({ value, onChange, currency = "USD", min = 0, placeholder = "0" }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(formatMoneyDraft(value, false));

  // Keep the draft in sync with external value changes when the field isn't focused.
  useEffect(() => {
    if (!focused) setDraft(formatMoneyDraft(value, false));
  }, [value, focused]);

  const symbol = currencySymbol(currency);

  const commit = (raw) => {
    setFocused(false);
    if (!raw || !raw.replace(/[^0-9.]/g, "")) {
      onChange(undefined);
      setDraft("");
      return;
    }
    const cleaned = Number(raw.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(cleaned)) {
      onChange(cleaned);
      setDraft(formatMoneyDraft(cleaned, false));
    }
  };

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        {symbol}
      </span>
      <Input
        value={focused ? draft : formatMoneyDraft(value, false)}
        inputMode="decimal"
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value.replace(/[^0-9.]/g, ""))}
        onFocus={() => {
          setFocused(true);
          setDraft(value != null ? String(value) : "");
        }}
        onBlur={(event) => commit(event.target.value)}
        min={min}
        className="h-9 pl-7 tabular-nums"
      />
    </div>
  );
}

function formatMoneyDraft(value, focused) {
  if (value == null || value === "") return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  if (focused) return String(num);
  return num.toLocaleString("en-US");
}

function currencySymbol(currency) {
  if (!currency) return "$";
  if (currency === "USD" || currency === "CAD" || currency === "AUD") return "$";
  if (currency === "EUR") return "€";
  if (currency === "GBP") return "£";
  if (currency === "JPY") return "¥";
  return currency;
}

// ---------------------------------------------------------------------------
// PercentInput — entered as percent (e.g. 10), stored as decimal (0.10)
// ---------------------------------------------------------------------------

export function PercentInput({ value, onChange, min, max, step = 0.5, placeholder }) {
  const display =
    value == null || value === "" ? "" : String(Number((Number(value) * 100).toFixed(4)));
  return (
    <div className="relative">
      <Input
        type="number"
        inputMode="decimal"
        value={display}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") {
            onChange(undefined);
            return;
          }
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) onChange(parsed / 100);
        }}
        className="h-9 pr-7 tabular-nums"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        %
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SuggestionCloud — quick-pick chips for a free-form input
// ---------------------------------------------------------------------------

export function SuggestionCloud({ suggestions, onPick, label = "Suggestions" }) {
  if (!suggestions?.length) return null;
  return (
    <div className="grid gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.value || suggestion.label}
            type="button"
            onClick={() => onPick(suggestion.value || suggestion.label)}
            className="inline-flex h-7 items-center rounded-full border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {suggestion.label}
          </button>
        ))}
      </div>
    </div>
  );
}
