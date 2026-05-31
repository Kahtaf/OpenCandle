import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getHistory, getQuote } from "../../providers/yahoo-finance.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { initDefaultDatabase } from "../../memory/sqlite.js";
import { MarketStateService, type AlertRuleRecord } from "../../market-state/service.js";
import { isZeroFilledQuote } from "../../market-state/resolve.js";
import { resolveInstrumentForMutation } from "../../market-state/resolve-for-mutation.js";
import { computeRSI, computeSMA } from "../technical/indicators.js";
import {
  ALERT_CONDITION_VERSION,
  priceCrossesAbove,
  priceCrossesBelow,
  priceCrossesSma,
  rsiThreshold,
  volumeSpike,
} from "../../market-state/alert-conditions.js";

const ACTION_DESCRIPTION = [
  "One of: create_price_above, create_price_below, create_price_above_sma,",
  "create_price_below_sma, create_rsi_above, create_rsi_below,",
  "create_volume_spike, set_enabled, list, check.",
  "Use create_price_above/create_price_below for price alerts,",
  "create_price_above_sma/create_price_below_sma for SMA crossing alerts,",
  "create_rsi_above/create_rsi_below for RSI alerts,",
  "create_volume_spike for volume alerts, and set_enabled to enable or disable an alert.",
].join(" ");

const params = Type.Object({
  action: Type.Union(
    [
      Type.Literal("create_price_above"),
      Type.Literal("create_price_below"),
      Type.Literal("create_price_above_sma"),
      Type.Literal("create_price_below_sma"),
      Type.Literal("create_rsi_above"),
      Type.Literal("create_rsi_below"),
      Type.Literal("create_volume_spike"),
      Type.Literal("set_enabled"),
      Type.Literal("list"),
      Type.Literal("check"),
    ],
    { description: ACTION_DESCRIPTION },
  ),
  symbol: Type.Optional(Type.String({ description: "Ticker symbol for create actions" })),
  threshold: Type.Optional(Type.Number({ description: "Price or indicator threshold for create actions" })),
  period: Type.Optional(Type.Number({ description: "Indicator lookback period for SMA/RSI alerts" })),
  cooldown_seconds: Type.Optional(
    Type.Number({ description: "Cooldown between repeated trigger events. Default: 3600" }),
  ),
  id: Type.Optional(Type.Number({ description: "Alert rule id for update actions" })),
  enabled: Type.Optional(Type.Boolean({ description: "Whether an alert rule is enabled" })),
});

export const alertsTool: AgentTool<typeof params> = {
  name: "manage_alerts",
  label: "Alerts",
  description:
    "Create and manually check durable alerts. Actions include create_price_above, create_price_below, create_price_above_sma, create_price_below_sma, create_rsi_above, create_rsi_below, create_volume_spike, set_enabled, list, and check. V1 alerts are manually checked and do not imply continuous background monitoring.",
  parameters: params,
  async execute(_toolCallId, args) {
    const db = initDefaultDatabase();
    const service = new MarketStateService(db);

    try {
      if (args.action === "create_price_above" || args.action === "create_price_below") {
        if (!args.symbol || args.threshold == null) {
          throw new Error("symbol and threshold are required for create alert actions.");
        }
        const resolution = await resolveInstrumentForMutation(args.symbol);
        if (resolution.status === "needs_selection") return candidateResult(resolution, "alert");
        const instrument = service.upsertInstrumentRecord(resolution.instrument);
        const isAbove = args.action === "create_price_above";
        const rule = service.createAlertRule({
          scopeType: "instrument",
          instrumentId: instrument.id,
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
            text: `Created manual alert ${rule.conditionType} for ${instrument.symbol} at $${args.threshold}.`,
          }],
          details: rule,
        };
      }

      if (args.action === "create_price_above_sma" || args.action === "create_price_below_sma") {
        if (!args.symbol) {
          throw new Error("symbol is required for SMA alert actions.");
        }
        const period = args.period ?? 50;
        const resolution = await resolveInstrumentForMutation(args.symbol);
        if (resolution.status === "needs_selection") return candidateResult(resolution, "alert");
        const instrument = service.upsertInstrumentRecord(resolution.instrument);
        const direction = args.action === "create_price_above_sma" ? "above" : "below";
        const rule = service.createAlertRule({
          scopeType: "instrument",
          instrumentId: instrument.id,
          conditionType: "price_crosses_sma",
          conditionVersion: ALERT_CONDITION_VERSION,
          condition: priceCrossesSma(period, direction),
          timeframe: "1d",
          cooldownSeconds: args.cooldown_seconds ?? 3600,
        });
        return {
          content: [{
            type: "text",
            text: `Created manual alert price_crosses_sma for ${instrument.symbol} using SMA(${period}).`,
          }],
          details: rule,
        };
      }

      if (args.action === "create_rsi_above" || args.action === "create_rsi_below") {
        if (!args.symbol || args.threshold == null) {
          throw new Error("symbol and threshold are required for RSI alert actions.");
        }
        const period = args.period ?? 14;
        const resolution = await resolveInstrumentForMutation(args.symbol);
        if (resolution.status === "needs_selection") return candidateResult(resolution, "alert");
        const instrument = service.upsertInstrumentRecord(resolution.instrument);
        const direction = args.action === "create_rsi_above" ? "above" : "below";
        const rule = service.createAlertRule({
          scopeType: "instrument",
          instrumentId: instrument.id,
          conditionType: "rsi_threshold",
          conditionVersion: ALERT_CONDITION_VERSION,
          condition: rsiThreshold(period, args.threshold, direction),
          timeframe: "1d",
          cooldownSeconds: args.cooldown_seconds ?? 3600,
        });
        return {
          content: [{
            type: "text",
            text: `Created manual alert rsi_threshold for ${instrument.symbol}: RSI(${period}) ${direction} ${args.threshold}.`,
          }],
          details: rule,
        };
      }

      if (args.action === "create_volume_spike") {
        if (!args.symbol) {
          throw new Error("symbol is required for volume-spike alert actions.");
        }
        const period = args.period ?? 20;
        const multiplier = args.threshold ?? 2;
        const resolution = await resolveInstrumentForMutation(args.symbol);
        if (resolution.status === "needs_selection") return candidateResult(resolution, "alert");
        const instrument = service.upsertInstrumentRecord(resolution.instrument);
        const rule = service.createAlertRule({
          scopeType: "instrument",
          instrumentId: instrument.id,
          conditionType: "volume_spike",
          conditionVersion: ALERT_CONDITION_VERSION,
          condition: volumeSpike(period, multiplier),
          timeframe: "1d",
          cooldownSeconds: args.cooldown_seconds ?? 3600,
        });
        return {
          content: [{
            type: "text",
            text: `Created manual alert volume_spike for ${instrument.symbol}: volume > ${multiplier}x ${period}-bar average.`,
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

      if (args.action === "set_enabled") {
        if (args.id == null || args.enabled == null) {
          throw new Error("id and enabled are required for set_enabled.");
        }
        const rule = service.setAlertRuleEnabled(args.id, args.enabled);
        return {
          content: [{
            type: "text",
            text: `${rule.enabled ? "Enabled" : "Disabled"} alert #${rule.id}.`,
          }],
          details: rule,
        };
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
    if (rule.conditionVersion !== ALERT_CONDITION_VERSION) {
      lines.push(`  ${instrument.symbol}: needs review (unsupported condition version ${rule.conditionVersion})`);
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
      const message = `${instrument.symbol} ${rule.conditionType} at ${formatObserved(observation)}`;
      const result = service.recordAlertCheckResult({
        ruleId: rule.id,
        observed,
        checkedAt: observed.at,
        trigger: {
          expectedPreviousValue: previous,
          expectedLastTriggeredAt: rule.lastTriggeredAt,
          instrumentId: instrument.id,
          message,
          triggeredAt: observed.at,
        },
      });
      if (result.triggered) {
        triggered++;
        lines.push(`  TRIGGERED: ${message}`);
      } else {
        lines.push(`  ${instrument.symbol}: checked at ${formatObserved(observation)}`);
      }
    } else {
      service.recordAlertCheckResult({ ruleId: rule.id, observed, checkedAt: observed.at });
      const seeded = previous == null ? "seeded" : "checked";
      lines.push(`  ${instrument.symbol}: ${seeded} at ${formatObserved(observation)}`);
    }
  }

  return { checked: rules.length, triggered, lines };
}

function candidateResult(resolution: Extract<Awaited<ReturnType<typeof resolveInstrumentForMutation>>, { status: "needs_selection" }>, target: string) {
  return {
    content: [{
      type: "text" as const,
      text: `Could not verify ${resolution.query}. Choose one of the returned candidates before creating the ${target}.`,
    }],
    details: resolution,
  };
}

async function observeRule(rule: AlertRuleRecord, symbol: string): Promise<
  | { status: "ok"; value: number; field: string; display: string }
  | { status: "unavailable"; reason: string }
> {
  if (rule.conditionType === "price_crosses_above" || rule.conditionType === "price_crosses_below") {
    const quoteResult = await wrapProvider("yahoo", () => getQuote(symbol));
    if (quoteResult.status === "unavailable") return { status: "unavailable", reason: quoteResult.reason };
    if (quoteResult.stale) return { status: "unavailable", reason: "provider returned stale market data" };
    if (isZeroFilledQuote(quoteResult.data)) {
      return { status: "unavailable", reason: "Yahoo returned no valid market data." };
    }
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
    if (barsResult.stale) return { status: "unavailable", reason: "provider returned stale market data" };
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
    if (barsResult.stale) return { status: "unavailable", reason: "provider returned stale market data" };
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

  if (rule.conditionType === "volume_spike") {
    const condition = rule.conditionJson as { lookback_period?: unknown };
    const period = typeof condition.lookback_period === "number" ? condition.lookback_period : 20;
    const barsResult = await wrapProvider("yahoo", () => getHistory(symbol, "6mo", "1d"));
    if (barsResult.status === "unavailable") return { status: "unavailable", reason: barsResult.reason };
    if (barsResult.stale) return { status: "unavailable", reason: "provider returned stale market data" };
    const bars = barsResult.data;
    const latest = bars[bars.length - 1];
    const prior = bars.slice(Math.max(0, bars.length - 1 - period), bars.length - 1);
    if (latest == null || prior.length < period) {
      return { status: "unavailable", reason: `insufficient history for volume spike (${period})` };
    }
    const averageVolume = prior.reduce((sum, bar) => sum + bar.volume, 0) / prior.length;
    if (averageVolume <= 0) {
      return { status: "unavailable", reason: "average volume is unavailable" };
    }
    const ratio = latest.volume / averageVolume;
    return {
      status: "ok",
      value: ratio,
      field: "volume_ratio",
      display: `volume ${ratio.toFixed(2)}x ${period}-bar average`,
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
  if (rule.conditionType === "volume_spike") {
    const multiplier = (rule.conditionJson as { multiplier?: unknown }).multiplier;
    if (typeof multiplier !== "number") return false;
    return previous <= multiplier && current > multiplier;
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
