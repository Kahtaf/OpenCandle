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
