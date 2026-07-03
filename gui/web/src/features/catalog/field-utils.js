export function defaultValuesFor(fields) {
  const out = {};
  for (const field of fields) {
    if (field.default !== undefined) out[field.name] = field.default;
  }
  return out;
}

export function validateRequired(fields, values) {
  const issues = [];
  for (const field of fields) {
    const value = values[field.name];
    if (field.parse === "json" && typeof value === "string" && value.trim() !== "") {
      try {
        JSON.parse(value);
      } catch {
        issues.push(`${field.label} must be valid JSON.`);
      }
    }

    if (!field.required) continue;
    if (value == null || value === "") {
      issues.push(`${field.label} is required.`);
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) issues.push(`${field.label} is required.`);
      else if (field.min != null && value.length < field.min)
        issues.push(
          `${field.label} needs at least ${field.min} entr${field.min === 1 ? "y" : "ies"}.`,
        );
    }
  }
  return issues;
}
