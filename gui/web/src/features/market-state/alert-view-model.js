import { formatMoney } from "../../lib/financial-format.js";
import { relativeTime } from "./format.js";

export function buildAlertSentenceRows(
  alerts = [],
  alertEvents = [],
  instruments = [],
  nowMs = Date.now(),
) {
  // The instrument, not just its symbol: a price rule is stated in the currency
  // its listing trades in, and the rule itself does not record one.
  const instrumentsById = new Map(instruments.map((instrument) => [instrument.id, instrument]));
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
    const tone = rowTone(rule, enabled, event);
    const instrument = rule.instrumentId ? instrumentsById.get(rule.instrumentId) : null;
    const currency = instrument?.currency ?? null;
    return {
      id: rule.id,
      symbol: rule.instrumentId ? (instrument?.symbol ?? "Unknown") : scopeLabel(rule),
      sentence: conditionSentence(rule.conditionType, rule.conditionJson, false, currency),
      detail: detailLine(rule, enabled, nowMs, currency),
      // The row shows the short status; the chain of observed values moves
      // behind the row's disclosure so an armed rule that has not fired can
      // still explain itself.
      status: rowStatusLabel(tone, rule, nowMs),
      explanation: explanationLine(rule, enabled, tone, nowMs, currency),
      tone,
      retriggerMode: rule.retriggerMode ?? "recurring",
      cadence: rule.retriggerMode === "once" ? "Once" : "Repeats",
      enabled,
      rule,
    };
  });
}

function conditionSentence(conditionType, condition = {}, placeholders = false, currency = null) {
  const c = condition && typeof condition === "object" ? condition : {};
  const price = (value) =>
    typeof value === "number"
      ? moneyLabel(value, currency)
      : placeholders
        ? "a price you set"
        : "N/A";
  const level = (value) =>
    value == null || value === "" ? (placeholders ? "a level you set" : "N/A") : value;
  const percent = (value) =>
    value == null || value === "" ? (placeholders ? "a percentage you set" : "N/A%") : `${value}%`;
  const days = (value) =>
    value == null || value === "" ? (placeholders ? "chosen" : "N/A") : `${value}-day`;

  switch (conditionType) {
    case "price_crosses_above":
      return `Price crosses above ${price(c.threshold)}`;
    case "price_crosses_below":
      return `Price drops below ${price(c.threshold)}`;
    case "rsi_threshold":
      return `RSI (${c.period ?? 14}-day) ${c.direction === "below" ? "falls below" : "rises above"} ${level(c.threshold)}`;
    case "percent_move":
      return `${c.direction === "down" ? "Falls" : "Rises"} more than ${percent(c.percent)} in a day`;
    case "price_crosses_sma":
      return `Price ${c.direction === "below" ? "drops below" : "crosses above"} the ${days(c.period)} average`;
    case "sma_cross":
      return `${days(c.fast_period)} average crosses ${c.direction === "below" ? "below" : "above"} the ${days(c.slow_period)} average`;
    case "volume_spike":
      return `Volume spikes to ${level(c.multiplier)}× the ${days(c.lookback_period)} average`;
    default:
      return conditionType.replaceAll("_", " ");
  }
}

function detailLine(rule, enabled, nowMs, currency = null) {
  if (!enabled) return "Paused";
  if (!rule.lastCheckedAt) return "Armed · not checked yet";
  const observedValue = formatAlertObservedValue(
    rule.conditionType,
    rule.conditionJson,
    rule.lastObservedJson,
    currency,
  );
  return `Armed · last checked ${relativeTime(rule.lastCheckedAt, nowMs)}${
    observedValue ? ` · ${observedValue}` : ""
  }`;
}

function rowStatusLabel(tone, rule, nowMs) {
  if (tone === "paused") return "Paused";
  if (tone === "degraded") return "Waiting for data";
  if (!rule.lastCheckedAt) return "Not checked yet";
  return `Armed · checked ${relativeTime(rule.lastCheckedAt, nowMs)}`;
}

function explanationLine(rule, enabled, tone, nowMs, currency = null) {
  const parts = [];
  if (rule.lastCheckedAt) parts.push(`Last checked ${relativeTime(rule.lastCheckedAt, nowMs)}`);
  if (tone === "degraded") parts.push("the last check could not read this market");
  const observedValue = formatAlertObservedValue(
    rule.conditionType,
    rule.conditionJson,
    rule.lastObservedJson,
    currency,
  );
  if (observedValue) parts.push(observedValue);
  if (!enabled) parts.push("paused rules are not checked");
  return parts.length > 0 ? parts.join(" · ") : null;
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

// A price is stated in the currency its listing trades in when the caller knows
// it. Rules that were saved without a resolvable instrument keep the plain
// dollar label rather than guessing a currency.
function moneyLabel(value, currency = null) {
  if (typeof value !== "number") return "N/A";
  return currency ? formatMoney(value, currency) : `$${value.toFixed(2)}`;
}

export function formatAlertObservedValue(conditionType, condition, observed, currency = null) {
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
        return `price ${moneyLabel(value, currency)} · ${relation} ${moneyLabel(threshold, currency)}, waiting for next ${direction} cross`;
      }
    }
    return `price ${moneyLabel(value, currency)} vs threshold ${moneyLabel(threshold, currency)}`;
  }

  if (conditionType === "price_crosses_sma") {
    const period = integerValue(c.period) ?? 50;
    const price = numberValue(observation.price);
    const sma = numberValue(observation.sma);
    if (price == null || sma == null || sma === 0) {
      return `price is ${value < 0 ? "below" : "above"} the ${period}-day SMA (exact values unavailable)`;
    }
    return `price ${moneyLabel(price, currency)} is ${formatPercent(Math.abs((price / sma - 1) * 100))} ${
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
    return `${fastPeriod}-day SMA ${moneyLabel(fastSma, currency)} is ${formatPercent(
      Math.abs((fastSma / slowSma - 1) * 100),
    )} ${fastSma < slowSma ? "below" : "above"} ${slowPeriod}-day SMA ${moneyLabel(slowSma, currency)}`;
  }

  return null;
}

// One activity feed. Every alert firing already writes a matching notification,
// so the notification is folded into its alert event as read state instead of
// being listed a second time. Notifications from other sources keep their own row.
export function buildActivityRows(
  { alertEvents = [], notifications = [], deliveryAttempts = [], instruments = [] } = {},
  limit = 15,
) {
  const symbolsById = new Map(
    (instruments ?? []).map((instrument) => [instrument.id, instrument.symbol]),
  );
  const notificationsByEvent = new Map();
  for (const notification of notifications ?? []) {
    if (notification?.sourceType !== "alert_event" || notification.sourceId == null) continue;
    notificationsByEvent.set(notification.sourceId, notification);
  }

  const rows = [];
  for (const event of alertEvents ?? []) {
    const notification = notificationsByEvent.get(event.id) ?? null;
    const symbol = symbolsById.get(event.instrumentId);
    const message = event.message || event.status || "";
    rows.push({
      key: `alert:${event.id ?? `${event.alertRuleId}:${event.observedAt ?? event.triggeredAt}`}`,
      title: [symbol, message].filter(Boolean).join(" "),
      at: event.observedAt || event.triggeredAt || notification?.createdAt || null,
      badge:
        event.status === "unavailable"
          ? "Data unavailable"
          : deliveryFailed(deliveryAttempts, notification?.id)
            ? "Delivery failed"
            : null,
      unread: Boolean(notification) && notification.status !== "acknowledged",
      notificationId: notification?.id ?? null,
    });
  }

  for (const notification of notifications ?? []) {
    if (notification?.sourceType === "alert_event") continue;
    rows.push({
      key: `notification:${notification.id}`,
      title: notification.title || notification.body || "",
      at: notification.createdAt ?? null,
      badge: deliveryFailed(deliveryAttempts, notification.id) ? "Delivery failed" : null,
      unread: notification.status !== "acknowledged",
      notificationId: notification.id,
    });
  }

  return rows
    .sort((a, b) => (Date.parse(b.at ?? "") || 0) - (Date.parse(a.at ?? "") || 0))
    .slice(0, limit);
}

function deliveryFailed(attempts = [], notificationId) {
  if (notificationId == null) return false;
  return (attempts ?? []).some(
    (attempt) => attempt?.notificationEventId === notificationId && attempt.status === "failed",
  );
}

// The create-alert sheet previews a rule with the exact words the saved rule
// row will use, so composing an alert and reading it back never disagree.
export function alertPreviewSentence({
  condition,
  threshold,
  period,
  fastPeriod,
  slowPeriod,
  currency = null,
} = {}) {
  const number = (value) => {
    if (value === "" || value == null) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const map = {
    create_price_above: ["price_crosses_above", { threshold: number(threshold) }],
    create_price_below: ["price_crosses_below", { threshold: number(threshold) }],
    create_price_above_sma: ["price_crosses_sma", { direction: "above", period: number(period) }],
    create_price_below_sma: ["price_crosses_sma", { direction: "below", period: number(period) }],
    create_rsi_above: [
      "rsi_threshold",
      { direction: "above", threshold: number(threshold), period: number(period) },
    ],
    create_rsi_below: [
      "rsi_threshold",
      { direction: "below", threshold: number(threshold), period: number(period) },
    ],
    create_volume_spike: [
      "volume_spike",
      { multiplier: number(threshold), lookback_period: number(period) },
    ],
    create_percent_move_up: ["percent_move", { direction: "up", percent: number(threshold) }],
    create_percent_move_down: ["percent_move", { direction: "down", percent: number(threshold) }],
    create_sma_cross_above: [
      "sma_cross",
      { direction: "above", fast_period: number(fastPeriod), slow_period: number(slowPeriod) },
    ],
    create_sma_cross_below: [
      "sma_cross",
      { direction: "below", fast_period: number(fastPeriod), slow_period: number(slowPeriod) },
    ],
  };
  const [conditionType, conditionJson] = map[condition] ?? map.create_price_above;
  return conditionSentence(conditionType, conditionJson, true, currency);
}

export function alertCadenceSentence(cooldownSeconds) {
  const seconds = Number(cooldownSeconds);
  const window = Number.isFinite(seconds) && seconds > 0 ? cooldownWindowLabel(seconds) : null;
  return window
    ? `Repeats at most ${window} while OpenCandle is open`
    : "Repeats on every check while OpenCandle is open";
}

// A unit is only used when the cooldown divides evenly into it. Rounding into
// the nearest unit would state a cadence the alert does not run at: a rule saved
// with a 90 minute cooldown is not an hourly rule.
function cooldownWindowLabel(seconds) {
  const whole = Math.round(seconds);
  if (whole % 86_400 === 0) return pluralWindow(whole / 86_400, "day");
  if (whole % 3600 === 0) return pluralWindow(whole / 3600, "hour");
  if (whole % 60 === 0) return pluralWindow(whole / 60, "minute");
  return pluralWindow(whole, "second");
}

function pluralWindow(count, unit) {
  if (count <= 1) return `once ${unit === "hour" ? "an hour" : `a ${unit}`}`;
  return `once every ${count} ${unit}s`;
}

// The threshold sheet keeps the live price beside the level being typed so the
// number never has to be judged in isolation.
export function thresholdDistanceHint(currentPrice, threshold, currency = "USD") {
  if (typeof currentPrice !== "number" || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return null;
  }
  const current = `Current ${formatMoney(currentPrice, currency)}`;
  const parsed = threshold === "" || threshold == null ? Number.NaN : Number(threshold);
  if (!Number.isFinite(parsed)) return current;
  const distance = (parsed / currentPrice - 1) * 100;
  if (Math.abs(distance) < 0.05) return `${current} · at the current price`;
  return `${current} · ${Math.abs(distance).toFixed(1)}% ${distance > 0 ? "above" : "below"}`;
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
