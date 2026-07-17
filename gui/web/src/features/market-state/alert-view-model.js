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
      rule,
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
  const observedValue = formatAlertObservedValue(
    rule.conditionType,
    rule.conditionJson,
    rule.lastObservedJson,
  );
  return `Armed · last checked ${relativeTime(rule.lastCheckedAt, nowMs)}${
    observedValue ? ` · ${observedValue}` : ""
  }`;
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

export function formatAlertObservedValue(conditionType, condition, observed) {
  const c = record(condition);
  const observation = record(observed);
  const value = numberValue(observation.value);
  if (value == null) return null;

  if (conditionType === "price_crosses_above" || conditionType === "price_crosses_below") {
    const threshold = numberValue(c.threshold);
    if (threshold != null) {
      const isAboveTriggerSide = conditionType === "price_crosses_above" && value > threshold;
      const isBelowTriggerSide = conditionType === "price_crosses_below" && value < threshold;
      if (isAboveTriggerSide || isBelowTriggerSide) {
        const relation = isAboveTriggerSide ? "above" : "below";
        const direction = isAboveTriggerSide ? "upward" : "downward";
        return `price ${moneyLabel(value)} · ${relation} ${moneyLabel(threshold)}, waiting for next ${direction} cross`;
      }
    }
    return `price ${moneyLabel(value)} vs threshold ${moneyLabel(threshold)}`;
  }

  if (conditionType === "price_crosses_sma") {
    const period = integerValue(c.period) ?? 50;
    const price = numberValue(observation.price);
    const sma = numberValue(observation.sma);
    if (price == null || sma == null || sma === 0) {
      return `price is ${value < 0 ? "below" : "above"} the ${period}-day SMA (exact values unavailable)`;
    }
    return `price ${moneyLabel(price)} is ${formatPercent(Math.abs((price / sma - 1) * 100))} ${
      price < sma ? "below" : "above"
    } the ${period}-day SMA`;
  }

  if (conditionType === "rsi_threshold") {
    return `RSI ${formatDecimal(value)} vs threshold ${formatDecimal(numberValue(c.threshold))}`;
  }

  if (conditionType === "volume_spike") return `volume ${formatDecimal(value)}x its average`;

  if (conditionType === "percent_move") return `moved ${formatSignedPercent(value)} today`;

  if (conditionType === "sma_cross") {
    const fastPeriod = integerValue(c.fast_period) ?? 50;
    const slowPeriod = integerValue(c.slow_period) ?? 200;
    const fastSma = numberValue(observation.fast_sma);
    const slowSma = numberValue(observation.slow_sma);
    const relation = value < 0 ? "below" : "above";
    if (fastSma == null || slowSma == null || slowSma === 0) {
      return `${fastPeriod}-day SMA is ${relation} ${slowPeriod}-day SMA (exact values unavailable)`;
    }
    return `${fastPeriod}-day SMA ${moneyLabel(fastSma)} is ${formatPercent(
      Math.abs((fastSma / slowSma - 1) * 100),
    )} ${fastSma < slowSma ? "below" : "above"} ${slowPeriod}-day SMA ${moneyLabel(slowSma)}`;
  }

  return null;
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
      lastObserved: observedLabel(rule),
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

function observedLabel(rule) {
  const observed = rule.lastObservedJson;
  if (!observed || typeof observed !== "object") return "Not checked";
  const at = observed.at ? ` at ${shortDate(observed.at)}` : "";
  return (
    formatAlertObservedValue(rule.conditionType, rule.conditionJson, observed) ??
    `Observation unavailable${at}`
  );
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

function record(value) {
  return value && typeof value === "object" ? value : {};
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerValue(value) {
  return Number.isInteger(value) ? value : null;
}

function formatDecimal(value, maximumFractionDigits = 1) {
  if (value == null) return "N/A";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function formatPercent(value) {
  return `${formatDecimal(value)}%`;
}

function formatSignedPercent(value) {
  return `${value >= 0 ? "+" : "-"}${formatPercent(Math.abs(value))}`;
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
