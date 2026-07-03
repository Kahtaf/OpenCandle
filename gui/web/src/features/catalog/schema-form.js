// Derives catalog form fields from the tool parameter schemas served in the
// catalog payload, so form definitions cannot drift from registered tools.
// Presentation overrides (tool-form-overrides.js) may refine labels, helpers,
// placeholders, and defaults of derived fields but never define new fields.

import { FIELD_OVERRIDES } from "./tool-form-overrides.js";

const SEGMENTED_MAX_OPTIONS = 5;
const HELPER_MAX_LENGTH = 80;

export function fieldsForTool(tool) {
  const props = tool.parameters?.properties || {};
  const required = tool.parameters?.required || [];
  const overrides = FIELD_OVERRIDES[tool.name] || {};
  return Object.entries(props).map(([name, schema]) => ({
    ...deriveField(name, schema, required.includes(name)),
    ...(overrides[name] || {}),
  }));
}

// Converts a form value into the arg shape the tool schema expects. Text
// inputs standing in for arrays/objects carry a `parse` marker from
// deriveField; everything else passes through.
export function coerceFieldValue(field, value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (field.parse === "csv" && typeof value === "string") {
    const parts = value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  }
  if (field.parse === "json" && typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return value;
}

function deriveField(name, rawSchema, required) {
  const schema = unwrapNullableSchema(rawSchema);
  const base = {
    name,
    label: friendlyLabel(name),
    helper: truncateHelper(schema.description),
    placeholder: schema.examples?.[0],
    required,
    ...(schema.default !== undefined ? { default: schema.default } : {}),
  };

  const options = enumOptions(schema);
  if (options) {
    const kind = options.length <= SEGMENTED_MAX_OPTIONS ? "segmented" : "select";
    return {
      ...base,
      kind,
      ...(kind === "select" && schema.default === undefined
        ? { placeholder: required ? `Select ${base.label}` : "Use tool default" }
        : {}),
      options,
    };
  }

  if (schema.type === "boolean") {
    return {
      ...base,
      kind: "segmented",
      options: [
        { value: true, label: "Yes" },
        { value: false, label: "No" },
      ],
    };
  }

  if (schema.type === "number" || schema.type === "integer") {
    if (isDecimalRateField(name, schema)) {
      return {
        ...base,
        kind: "percent",
        step: 0.5,
      };
    }
    return {
      ...base,
      kind: "number-chips",
      min: schema.minimum,
      max: schema.maximum,
      step: schema.type === "integer" ? 1 : undefined,
    };
  }

  if (schema.type === "array") {
    if (/symbol/i.test(name)) {
      return { ...base, kind: "symbols", min: schema.minItems, max: schema.maxItems };
    }
    const itemOptions = enumOptions(schema.items || {});
    if (itemOptions) {
      return { ...base, kind: "multi-chips", options: itemOptions };
    }
    if (schema.items?.type === "object") {
      return {
        ...base,
        kind: "text",
        parse: "json",
        helper: base.helper || "JSON array",
        placeholder: base.placeholder ?? "[]",
      };
    }
    return {
      ...base,
      kind: "text",
      parse: "csv",
      helper: base.helper || "Comma-separated values",
    };
  }

  if (schema.type === "object") {
    return {
      ...base,
      kind: "text",
      parse: "json",
      helper: base.helper || "JSON object",
      placeholder: base.placeholder ?? "{}",
    };
  }

  if (name === "symbol" && (schema.type === "string" || schema.type == null)) {
    return { ...base, kind: "symbol", placeholder: base.placeholder ?? "AAPL" };
  }

  return { ...base, kind: "text" };
}

function unwrapNullableSchema(schema) {
  const variants = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : null;
  if (!variants) return schema;

  const nonNullVariants = variants.filter((variant) => variant?.type !== "null");
  if (nonNullVariants.length !== 1 || nonNullVariants.length === variants.length) return schema;

  const [nonNullSchema] = nonNullVariants;
  return {
    ...nonNullSchema,
    description: schema.description ?? nonNullSchema.description,
    examples: schema.examples ?? nonNullSchema.examples,
    default: schema.default ?? nonNullSchema.default,
  };
}

// Typebox Type.Union of literals emits `anyOf: [{const, type}]`; plain JSON
// schema enums emit `enum: [...]`. Both become {value, label} option lists.
function enumOptions(schema) {
  const values = Array.isArray(schema.enum)
    ? schema.enum
    : Array.isArray(schema.anyOf) && schema.anyOf.every((entry) => "const" in entry)
      ? schema.anyOf.map((entry) => entry.const)
      : null;
  if (!values || values.length === 0) return null;
  return values.map((value) => ({ value, label: optionLabel(value) }));
}

function optionLabel(value) {
  return String(value).replace(/_/g, " ");
}

function isDecimalRateField(name, schema) {
  const description = String(schema.description || "");
  return /rate|growth/i.test(name) && /decimal|0\.\d+\s+for\s+\d+%/i.test(description);
}

function friendlyLabel(name) {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function truncateHelper(description) {
  const text = String(description || "");
  if (!text) return undefined;
  return text.length > HELPER_MAX_LENGTH ? `${text.slice(0, HELPER_MAX_LENGTH)}…` : text;
}
