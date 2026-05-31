export function buildAlertRows(alerts = [], alertEvents = []) {
  const latestEvents = new Map();
  for (const event of alertEvents) {
    const current = latestEvents.get(event.alertRuleId);
    if (!current || compareIso(event.triggeredAt, current.triggeredAt) > 0) {
      latestEvents.set(event.alertRuleId, event);
    }
  }

  return alerts.map((rule) => {
    const event = latestEvents.get(rule.id);
    return {
      id: rule.id,
      rule: `${rule.conditionType} ${describeCondition(rule.conditionJson)}`.trim(),
      scope: rule.instrumentId ? `Instrument #${rule.instrumentId}` : rule.scopeType,
      mode: modeLabel(rule),
      lastChecked: shortDate(rule.lastCheckedAt),
      lastObserved: observedLabel(rule.lastObservedJson),
      latestEvent: eventLabel(event),
      status: statusLabel(rule, event),
      enabled: rule.enabled !== false,
      toggleLabel: rule.enabled === false ? "Enable" : "Disable",
    };
  });
}

function modeLabel(rule) {
  if (rule.checkIntervalSeconds) return `Manual; ${rule.checkIntervalSeconds}s metadata`;
  return "Manual";
}

function statusLabel(rule, event) {
  if (rule.conditionVersion !== 1) return `Needs review: v${rule.conditionVersion}`;
  if (!rule.enabled) return "Disabled";
  if (event?.status) return event.status;
  if (rule.lastCheckedAt) return "Checked";
  return "Pending";
}

function observedLabel(observed) {
  if (!observed || typeof observed !== "object") return "Not checked";
  const field = typeof observed.field === "string" ? observed.field : "value";
  const value = typeof observed.value === "number" ? formatNumber(observed.value) : "N/A";
  const at = observed.at ? ` at ${shortDate(observed.at)}` : "";
  return `${field}: ${value}${at}`;
}

function eventLabel(event) {
  if (!event) return "None";
  const message = event.message ? `: ${event.message}` : "";
  return `${shortDate(event.triggeredAt)} ${event.status}${message}`;
}

function describeCondition(condition) {
  if (!condition || typeof condition !== "object") return "";
  if (typeof condition.threshold === "number") return `$${condition.threshold}`;
  return JSON.stringify(condition);
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function compareIso(a, b) {
  return (Date.parse(a ?? "") || 0) - (Date.parse(b ?? "") || 0);
}

function shortDate(value) {
  if (!value) return "N/A";
  return String(value).replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}
