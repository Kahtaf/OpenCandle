import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { initDefaultDatabase } from "../../memory/sqlite.js";
import { MarketStateService, type AlertRuleRecord } from "../../market-state/service.js";
import { resolveInstrumentForMutation } from "../../market-state/resolve-for-mutation.js";
import { defaultAlertRunnerProviders, runAlertChecks } from "../../market-state/alert-runner.js";
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
  "When the user asks to create an alert and check it now in the same request,",
  "set check_after_create to true on the create action.",
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
  check_after_create: Type.Optional(
    Type.Boolean({
      description:
        "Set true only when the user asks to check/run alerts immediately after creating this alert in the same request.",
    }),
  ),
});

export const alertsTool: AgentTool<typeof params> = {
  name: "manage_alerts",
  label: "Alerts",
  description:
    "Create and manually check durable alerts. Actions include create_price_above, create_price_below, create_price_above_sma, create_price_below_sma, create_rsi_above, create_rsi_below, create_volume_spike, set_enabled, list, and check. V1 alerts are manually checked and do not imply continuous background monitoring. If the user asks to create an alert and check it now, use the create action with check_after_create=true.",
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
        return await createResultMaybeChecked(
          service,
          rule,
          `Created manual alert ${rule.conditionType} for ${instrument.symbol} at $${args.threshold}.`,
          args.check_after_create,
        );
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
        return await createResultMaybeChecked(
          service,
          rule,
          `Created manual alert price_crosses_sma for ${instrument.symbol} using SMA(${period}).`,
          args.check_after_create,
        );
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
        return await createResultMaybeChecked(
          service,
          rule,
          `Created manual alert rsi_threshold for ${instrument.symbol}: RSI(${period}) ${direction} ${args.threshold}.`,
          args.check_after_create,
        );
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
        return await createResultMaybeChecked(
          service,
          rule,
          `Created manual alert volume_spike for ${instrument.symbol}: volume > ${multiplier}x ${period}-bar average.`,
          args.check_after_create,
        );
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
  const enabled = service.listAlertRules().filter((rule) => rule.enabled && rule.status === "active");
  if (enabled.length === 0) return { checked: 0, triggered: 0, lines: ["No enabled alert rules to check."] };

  const result = await runAlertChecks(service, {
    ownerId: "manual-tool",
    triggerType: "manual",
    providers: defaultAlertRunnerProviders,
  });
  return {
    checked: result.checked,
    triggered: result.triggered,
    lines: [`**Manual Alert Check** — ${enabled.length} rule(s)`, "", ...result.lines.map((line) => `  ${line}`)],
  };
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

async function createResultMaybeChecked(
  service: MarketStateService,
  rule: AlertRuleRecord,
  createdText: string,
  checkAfterCreate?: boolean,
) {
  if (!checkAfterCreate) {
    return {
      content: [{ type: "text" as const, text: createdText }],
      details: rule,
    };
  }

  const check = await checkAlerts(service);
  return {
    content: [{ type: "text" as const, text: `${createdText}\n\n${check.lines.join("\n")}` }],
    details: {
      created: rule,
      check,
    },
  };
}
