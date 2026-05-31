import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getQuote } from "../../providers/yahoo-finance.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { initDefaultDatabase } from "../../memory/sqlite.js";
import { MarketStateService, type AlertRuleRecord } from "../../market-state/service.js";
import { resolveYahooInstrument } from "../../market-state/resolve.js";
import {
  ALERT_CONDITION_VERSION,
  priceCrossesAbove,
  priceCrossesBelow,
} from "../../market-state/alert-conditions.js";

const params = Type.Object({
  action: Type.Union(
    [Type.Literal("create_price_above"), Type.Literal("create_price_below"), Type.Literal("list"), Type.Literal("check")],
    { description: "Create, list, or manually check alert rules" },
  ),
  symbol: Type.Optional(Type.String({ description: "Ticker symbol for create actions" })),
  threshold: Type.Optional(Type.Number({ description: "Price threshold for create actions" })),
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

    const quoteResult = await wrapProvider("yahoo", () => getQuote(instrument.symbol));
    if (quoteResult.status === "unavailable") {
      lines.push(`  ${instrument.symbol}: unavailable (${quoteResult.reason})`);
      continue;
    }

    const price = quoteResult.data.price;
    const observed = { value: price, field: "last_price", at: new Date().toISOString() };
    const previous = lastObservedValue(rule);
    const didTrigger = crosses(rule, previous, price) && outsideCooldown(rule);
    if (didTrigger) {
      triggered++;
      const message = `${instrument.symbol} ${rule.conditionType} at $${price.toFixed(2)}`;
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
      lines.push(`  ${instrument.symbol}: ${seeded} at $${price.toFixed(2)}`);
    }
  }

  return { checked: rules.length, triggered, lines };
}

function lastObservedValue(rule: AlertRuleRecord): number | null {
  const observed = rule.lastObservedJson as { value?: unknown } | null;
  return typeof observed?.value === "number" ? observed.value : null;
}

function crosses(rule: AlertRuleRecord, previous: number | null, current: number): boolean {
  if (previous == null || rule.conditionVersion !== ALERT_CONDITION_VERSION) return false;
  const condition = rule.conditionJson as { threshold?: unknown };
  if (typeof condition.threshold !== "number") return false;

  if (rule.conditionType === "price_crosses_above") {
    return previous <= condition.threshold && current > condition.threshold;
  }
  if (rule.conditionType === "price_crosses_below") {
    return previous >= condition.threshold && current < condition.threshold;
  }
  return false;
}

function outsideCooldown(rule: AlertRuleRecord): boolean {
  if (rule.lastTriggeredAt == null || rule.cooldownSeconds == null) return true;
  const lastTriggeredMs = new Date(rule.lastTriggeredAt).getTime();
  return Date.now() - lastTriggeredMs >= rule.cooldownSeconds * 1000;
}
