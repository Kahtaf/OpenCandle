import { relativeTime } from "./format.js";

export function buildAlertSentenceRows(
  alerts = [],
  alertEvents = [],
  instruments = [],
  nowMs = Date.now(),
) {
  const symbolsById = new Map(instruments.map((instrument) => [instrument.id, instrument.symbol]));
  const latestEvents = new Map();
  for (const event of alertEvents) {
    const current = latestEvents.get(event.alertRuleId);
    if (!current || compareIso(event.triggeredAt, current.triggeredAt) > 0) {
      latestEvents.set(event.alertRuleId, event);
    }
  }

  return alerts.map((rule) => {
    const enabled = rule.enabled !== false;
    const event = latestEvents.get(rule.id);
    return {
      id: rule.id,
      symbol: rule.instrumentId
        ? (symbolsById.get(rule.instrumentId) ?? "Unknown")
        : scopeLabel(rule),
      sentence: conditionSentence(rule.conditionType, rule.conditionJson),
      detail: detailLine(rule, enabled, nowMs),
      tone: rowTone(rule, enabled, event),
      retriggerMode: rule.retriggerMode ?? "recurring",
      enabled,
    };
  });
}

function conditionSentence(conditionType, condition = {}) {
  const c = condition && typeof condition === "object" ? condition : {};
  switch (conditionType) {
    case "price_crosses_above":
      return `Price crosses above ${moneyLabel(c.threshold)}`;
    case "price_crosses_below":
      return `Price drops below ${moneyLabel(c.threshold)}`;
    case "rsi_threshold":
      return `RSI (${c.period ?? 14}-day) ${c.direction === "below" ? "falls below" : "rises above"} ${c.threshold}`;
    case "percent_move":
      return `${c.direction === "down" ? "Falls" : "Rises"} more than ${c.percent}% in a day`;
    case "price_crosses_sma":
      return `Price ${c.direction === "below" ? "drops below" : "crosses above"} the ${c.period}-day average`;
    case "sma_cross":
      return `${c.fast_period}-day average crosses ${c.direction === "below" ? "below" : "above"} the ${c.slow_period}-day average`;
    case "volume_spike":
      return `Volume spikes to ${c.multiplier}× the ${c.lookback_period}-day average`;
    default:
      return conditionType.replaceAll("_", " ");
  }
}

function detailLine(rule, enabled, nowMs) {
  if (!enabled) return "Paused";
  if (!rule.lastCheckedAt) return "Armed · not checked yet";
  const observed = rule.lastObservedJson;
  const observedValue =
    observed && typeof observed === "object" && typeof observed.value === "number"
      ? ` at ${observed.field === "price" ? moneyLabel(observed.value) : formatNumber(observed.value)}`
      : "";
  return `Armed · last checked ${relativeTime(rule.lastCheckedAt, nowMs)}${observedValue}`;
}

function rowTone(rule, enabled, event) {
  if (!enabled) return "paused";
  if (event?.status === "unavailable" || rule.lastConditionState === "unavailable")
    return "degraded";
  return "armed";
}

function scopeLabel(rule) {
  return rule.scopeType === "watchlist"
    ? "Watchlist"
    : rule.scopeType === "portfolio"
      ? "Portfolio"
      : "Unknown";
}

function moneyLabel(value) {
  if (typeof value !== "number") return "N/A";
  return `$${value.toFixed(2)}`;
}

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
  return String(value)
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "Z");
}
