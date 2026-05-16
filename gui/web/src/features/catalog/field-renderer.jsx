import { Input } from "../../components/ui/input.jsx";
import {
  DAYS_PRESETS,
  DateInput,
  EnumSelect,
  Field,
  FreeText,
  FRESHNESS_OPTIONS,
  HOURS_PRESETS,
  MoneyInput,
  MultiSelectChips,
  NumberWithChips,
  PercentInput,
  PERIOD_OPTIONS,
  RANGE_OPTIONS,
  SegmentedControl,
  SuggestionCloud,
  SymbolChips,
  SymbolInput,
} from "./form-primitives.jsx";

const PRESET_REGISTRY = {
  DAYS_PRESETS,
  HOURS_PRESETS,
  RANGE_OPTIONS,
  PERIOD_OPTIONS,
  FRESHNESS_OPTIONS,
};

function resolveCollection(value) {
  if (typeof value === "string") return PRESET_REGISTRY[value] ?? [];
  return value ?? [];
}

export function FieldRenderer({ field, value, onChange, lookupSymbol }) {
  const setValue = (next) => onChange(field.name, next);
  const labelEl = (
    <span className="flex items-baseline justify-between gap-3 text-xs font-medium text-foreground">
      <span>
        {field.label}
        {field.required ? <span className="text-foreground/40" aria-hidden="true"> *</span> : null}
      </span>
      {field.helper ? <span className="text-[11px] font-normal text-muted-foreground">{field.helper}</span> : null}
    </span>
  );

  switch (field.kind) {
    case "symbol":
      return (
        <Field label={field.label} hint={field.helper} required={field.required}>
          <SymbolInput value={value} onChange={setValue} lookup={lookupSymbol} placeholder={field.placeholder} ariaLabel={field.label} />
        </Field>
      );

    case "symbols":
      return (
        <Field label={field.label} hint={field.helper} required={field.required}>
          <SymbolChips value={value || []} onChange={setValue} min={field.min} max={field.max} placeholder={field.placeholder} />
        </Field>
      );

    case "segmented":
      return (
        <Field label={field.label} hint={field.helper} required={field.required}>
          <SegmentedControl value={value} onChange={setValue} options={resolveCollection(field.options)} ariaLabel={field.label} />
        </Field>
      );

    case "select":
      return (
        <Field label={field.label} hint={field.helper} required={field.required}>
          <EnumSelect value={value} onChange={setValue} options={resolveCollection(field.options)} placeholder={field.placeholder} ariaLabel={field.label} />
        </Field>
      );

    case "number-chips":
      return (
        <Field label={field.label} hint={field.helper} required={field.required}>
          <NumberWithChips value={value} onChange={setValue} presets={resolveCollection(field.presets)} suffix={field.suffix} min={field.min} max={field.max} step={field.step} placeholder={field.placeholder} />
        </Field>
      );

    case "multi-chips":
      return (
        <Field label={field.label} hint={field.helper} required={field.required}>
          <MultiSelectChips value={value || []} onChange={setValue} options={resolveCollection(field.options)} />
        </Field>
      );

    case "date":
      return (
        <Field label={field.label} hint={field.helper} required={field.required}>
          <DateInput value={value} onChange={setValue} min={field.min} max={field.max} />
        </Field>
      );

    case "freetext":
      return (
        <Field label={field.label} hint={field.helper} required={field.required}>
          <FreeText value={value} onChange={setValue} placeholder={field.placeholder} maxLength={field.maxLength} rows={field.rows} />
        </Field>
      );

    case "money":
      return (
        <Field label={field.label} hint={field.helper} required={field.required}>
          <MoneyInput value={value} onChange={setValue} currency={field.currency} placeholder={field.placeholder} />
        </Field>
      );

    case "percent":
      return (
        <Field label={field.label} hint={field.helper} required={field.required}>
          <PercentInput value={value} onChange={setValue} min={field.min} max={field.max} step={field.step} placeholder={field.placeholder} />
        </Field>
      );

    case "text":
    default:
      return (
        <Field label={field.label} hint={field.helper} required={field.required}>
          <Input
            value={value ?? ""}
            placeholder={field.placeholder}
            onChange={(event) => setValue(event.target.value)}
            className="h-9"
          />
          {field.suggestions?.length ? (
            <div className="mt-2">
              <SuggestionCloud suggestions={field.suggestions} onPick={setValue} label="Try" />
            </div>
          ) : null}
        </Field>
      );
  }
}

// Resolve initial form values from a field array, honoring `default` and falling back to undefined.
export function defaultValuesFor(fields) {
  const out = {};
  for (const field of fields) {
    if (field.default !== undefined) out[field.name] = field.default;
  }
  return out;
}

// Validate required fields are filled. Returns an array of human messages
// (empty if the form is submittable).
export function validateRequired(fields, values) {
  const issues = [];
  for (const field of fields) {
    if (!field.required) continue;
    const value = values[field.name];
    if (value == null || value === "") {
      issues.push(`${field.label} is required.`);
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) issues.push(`${field.label} is required.`);
      else if (field.min != null && value.length < field.min) issues.push(`${field.label} needs at least ${field.min} entr${field.min === 1 ? "y" : "ies"}.`);
    }
  }
  return issues;
}
