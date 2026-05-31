import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getHistory, getQuote } from "../../providers/yahoo-finance.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { initDefaultDatabase } from "../../memory/sqlite.js";
import { MarketStateService, type AlertRuleRecord } from "../../market-state/service.js";
import { resolveYahooInstrument } from "../../market-state/resolve.js";
import { computeRSI, computeSMA } from "../technical/indicators.js";
import {
  ALERT_CONDITION_VERSION,
  priceCrossesAbove,
  priceCrossesBelow,
  priceCrossesSma,
  rsiThreshold,
} from "../../market-state/alert-conditions.js";

const params = Type.Object({
  action: Type.Union(
    [
      Type.Literal("create_price_above"),
      Type.Literal("create_price_below"),
      Type.Literal("create_price_above_sma"),
      Type.Literal("create_price_below_sma"),
      Type.Literal("create_rsi_above"),
      Type.Literal("create_rsi_below"),
      Type.Literal("list"),
      Type.Literal("check"),
    ],
    { description: "Create, list, or manually check alert rules" },
  ),
  symbol: Type.Optional(Type.String({ description: "Ticker symbol for create actions" })),
  threshold: Type.Optional(Type.Number({ description: "Price or indicator threshold for create actions" })),
  period: Type.Optional(Type.Number({ description: "Indicator lookback period for SMA/RSI alerts" })),
  cooldown_seconds: Type.Optional(
    Type.Number({ description: "Cooldown between repeated trigger events. Default: 3600" }),
  ),
});

export const alertsTool: AgentTool<typeof params> = {
  name: "manage_alerts",
  label: "Alerts",
  description:
    "Create and manually check durable price alerts. V1 alerts are manually checked and do not imply continuous background monitoring.",
  parameters: params,
  async execute(_toolCallId, args) {
    const db = initDefaultDatabase();
    const service = new MarketStateService(db);

    try {
      if (args.action === "create_price_above" || args.action === "create_price_below") {
        if (!args.symbol || args.threshold == null) {
          throw new Error("symbol and threshold are required for create alert actions.");
        }
        const instrument = await resolveYahooInstrument(args.symbol);
        const item = service.addWatchlistItem({ instrument });
        const isAbove = args.action === "create_price_above";
        const rule = service.createAlertRule({
          scopeType: "instrument",
          instrumentId: item.instrumentId,
          conditionType: isAbove ? "price_crosses_above" : "price_crosses_below",
          conditionVersion: ALERT_CONDITION_VERSION,
          condition: isAbove
            ? priceCrossesAbove(args.threshold)
            : priceCrossesBelow(args.threshold),
          timeframe: "quote",
          cooldownSeconds: args.cooldown_seconds ?? 3600,
        });
        return {
          content: [{
            type: "text",
            text: `Created manual alert ${rule.conditionType} for ${item.symbol} at $${args.threshold}.`,
          }],
          details: rule,
        };
      }

      if (args.action === "create_price_above_sma" || args.action === "create_price_below_sma") {
        if (!args.symbol) {
          throw new Error("symbol is required for SMA alert actions.");
        }
        const period = args.period ?? 50;
        const instrument = await resolveYahooInstrument(args.symbol);
        const item = service.addWatchlistItem({ instrument });
        const direction = args.action === "create_price_above_sma" ? "above" : "below";
        const rule = service.createAlertRule({
          scopeType: "instrument",
          instrumentId: item.instrumentId,
          conditionType: "price_crosses_sma",
          conditionVersion: ALERT_CONDITION_VERSION,
          condition: priceCrossesSma(period, direction),
          timeframe: "1d",
          cooldownSeconds: args.cooldown_seconds ?? 3600,
        });
        return {
          content: [{
            type: "text",
            text: `Created manual alert price_crosses_sma for ${item.symbol} using SMA(${period}).`,
          }],
          details: rule,
        };
      }

      if (args.action === "create_rsi_above" || args.action === "create_rsi_below") {
        if (!args.symbol || args.threshold == null) {
          throw new Error("symbol and threshold are required for RSI alert actions.");
        }
        const period = args.period ?? 14;
        const instrument = await resolveYahooInstrument(args.symbol);
        const item = service.addWatchlistItem({ instrument });
        const direction = args.action === "create_rsi_above" ? "above" : "below";
        const rule = service.createAlertRule({
          scopeType: "instrument",
          instrumentId: item.instrumentId,
          conditionType: "rsi_threshold",
          conditionVersion: ALERT_CONDITION_VERSION,
          condition: rsiThreshold(period, args.threshold, direction),
          timeframe: "1d",
          cooldownSeconds: args.cooldown_seconds ?? 3600,
        });
        return {
          content: [{
            type: "text",
            text: `Created manual alert rsi_threshold for ${item.symbol}: RSI(${period}) ${direction} ${args.threshold}.`,
          }],
          details: rule,
        };
      }

      if (args.action === "list") {
        const rules = service.listAlertRules();
        if (rules.length === 0) {
          return { content: [{ type: "text", text: "No alert rules created yet." }], details: [] };
        }
        const lines = ["**Alerts** — manually checked in V1", ""];
        for (const rule of rules) {
          const instrument = rule.instrumentId == null ? null : service.getInstrument(rule.instrumentId);
          lines.push(
            `  #${rule.id} ${instrument?.symbol ?? "watchlist"} ${rule.conditionType} (${rule.enabled ? "enabled" : "disabled"})`,
          );
        }
        return { content: [{ type: "text", text: lines.join("\n") }], details: rules };
      }

      const result = await checkAlerts(service);
      return {
        content: [{ type: "text", text: result.lines.join("\n") }],
        details: result,
      };
    } finally {
      db.close();
    }
  },
};

async function checkAlerts(service: MarketStateService): Promise<{
  checked: number;
  triggered: number;
  lines: string[];
}> {
  const rules = service.listAlertRules().filter((rule) => rule.enabled);
  if (rules.length === 0) {
    return { checked: 0, triggered: 0, lines: ["No enabled alert rules to check."] };
  }

  let triggered = 0;
  const lines = [`**Manual Alert Check** — ${rules.length} rule(s)`, ""];

  for (const rule of rules) {
    const instrument = rule.instrumentId == null ? null : service.getInstrument(rule.instrumentId);
    if (instrument == null) {
      lines.push(`  #${rule.id}: unavailable instrument`);
      continue;
    }

    const observation = await observeRule(rule, instrument.symbol);
    if (observation.status === "unavailable") {
      lines.push(`  ${instrument.symbol}: unavailable (${observation.reason})`);
      continue;
    }

    const observed = { value: observation.value, field: observation.field, at: new Date().toISOString() };
    const previous = lastObservedValue(rule);
    const didTrigger = crosses(rule, previous, observation.value) && outsideCooldown(rule);
    if (didTrigger) {
      triggered++;
      const message = `${instrument.symbol} ${rule.conditionType} at ${formatObserved(observation)}`;
      service.recordAlertEvent({
        alertRuleId: rule.id,
        instrumentId: instrument.id,
        observedValue: observed,
        status: "triggered",
        message,
        triggeredAt: observed.at,
      });
      service.updateAlertObservation({
        ruleId: rule.id,
        observed,
        checkedAt: observed.at,
        triggeredAt: observed.at,
      });
      lines.push(`  TRIGGERED: ${message}`);
    } else {
      service.updateAlertObservation({ ruleId: rule.id, observed, checkedAt: observed.at });
      const seeded = previous == null ? "seeded" : "checked";
      lines.push(`  ${instrument.symbol}: ${seeded} at ${formatObserved(observation)}`);
    }
  }

  return { checked: rules.length, triggered, lines };
}

async function observeRule(rule: AlertRuleRecord, symbol: string): Promise<
  | { status: "ok"; value: number; field: string; display: string }
  | { status: "unavailable"; reason: string }
> {
  if (rule.conditionType === "price_crosses_above" || rule.conditionType === "price_crosses_below") {
    const quoteResult = await wrapProvider("yahoo", () => getQuote(symbol));
    if (quoteResult.status === "unavailable") return { status: "unavailable", reason: quoteResult.reason };
    return {
      status: "ok",
      value: quoteResult.data.price,
      field: "last_price",
      display: `$${quoteResult.data.price.toFixed(2)}`,
    };
  }

  if (rule.conditionType === "price_crosses_sma") {
    const condition = rule.conditionJson as { period?: unknown };
    const period = typeof condition.period === "number" ? condition.period : 50;
    const barsResult = await wrapProvider("yahoo", () => getHistory(symbol, "1y", "1d"));
    if (barsResult.status === "unavailable") return { status: "unavailable", reason: barsResult.reason };
    const closes = barsResult.data.map((bar) => bar.close);
    const sma = computeSMA(closes, period);
    const latestClose = closes[closes.length - 1];
    const latestSma = sma[sma.length - 1];
    if (latestClose == null || latestSma == null) {
      return { status: "unavailable", reason: `insufficient history for SMA(${period})` };
    }
    return {
      status: "ok",
      value: latestClose - latestSma,
      field: "price_minus_sma",
      display: `$${latestClose.toFixed(2)} vs SMA(${period}) $${latestSma.toFixed(2)}`,
    };
  }

  if (rule.conditionType === "rsi_threshold") {
    const condition = rule.conditionJson as { period?: unknown };
    const period = typeof condition.period === "number" ? condition.period : 14;
    const barsResult = await wrapProvider("yahoo", () => getHistory(symbol, "6mo", "1d"));
    if (barsResult.status === "unavailable") return { status: "unavailable", reason: barsResult.reason };
    const rsi = computeRSI(barsResult.data.map((bar) => bar.close), period);
    const latestRsi = rsi[rsi.length - 1];
    if (latestRsi == null) {
      return { status: "unavailable", reason: `insufficient history for RSI(${period})` };
    }
    return {
      status: "ok",
      value: latestRsi,
      field: "rsi",
      display: `RSI(${period}) ${latestRsi.toFixed(1)}`,
    };
  }

  return { status: "unavailable", reason: `unsupported condition ${rule.conditionType}` };
}

function lastObservedValue(rule: AlertRuleRecord): number | null {
  const observed = rule.lastObservedJson as { value?: unknown } | null;
  return typeof observed?.value === "number" ? observed.value : null;
}

function crosses(rule: AlertRuleRecord, previous: number | null, current: number): boolean {
  if (previous == null || rule.conditionVersion !== ALERT_CONDITION_VERSION) return false;
  const condition = rule.conditionJson as { threshold?: unknown };

  if (rule.conditionType === "price_crosses_above") {
    if (typeof condition.threshold !== "number") return false;
    return previous <= condition.threshold && current > condition.threshold;
  }
  if (rule.conditionType === "price_crosses_below") {
    if (typeof condition.threshold !== "number") return false;
    return previous >= condition.threshold && current < condition.threshold;
  }
  if (rule.conditionType === "price_crosses_sma") {
    const direction = (rule.conditionJson as { direction?: unknown }).direction;
    if (direction === "above") return previous <= 0 && current > 0;
    if (direction === "below") return previous >= 0 && current < 0;
  }
  if (rule.conditionType === "rsi_threshold") {
    if (typeof condition.threshold !== "number") return false;
    const direction = (rule.conditionJson as { direction?: unknown }).direction;
    if (direction === "above") return previous <= condition.threshold && current > condition.threshold;
    if (direction === "below") return previous >= condition.threshold && current < condition.threshold;
  }
  return false;
}

function outsideCooldown(rule: AlertRuleRecord): boolean {
  if (rule.lastTriggeredAt == null || rule.cooldownSeconds == null) return true;
  const lastTriggeredMs = new Date(rule.lastTriggeredAt).getTime();
  return Date.now() - lastTriggeredMs >= rule.cooldownSeconds * 1000;
}

function formatObserved(observation: { display: string }): string {
  return observation.display;
}
