import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import {
  ALERT_CONDITION_VERSION,
  percentMove,
  priceCrossesAbove,
  priceCrossesBelow,
  priceCrossesSma,
  rsiThreshold,
  smaCross,
  volumeSpike,
} from "../../market-state/alert-conditions.js";
import { defaultAlertRunnerProviders, runAlertChecks } from "../../market-state/alert-runner.js";
import { deliverPendingNotifications } from "../../market-state/notification-delivery.js";
import {
  type MutationInstrumentResolution,
  resolveInstrumentForMutation,
} from "../../market-state/resolve-for-mutation.js";
import { type AlertRuleRecord, MarketStateService } from "../../market-state/service.js";
import { initDefaultDatabase } from "../../memory/sqlite.js";
import { resolveStatefulInstrument, type StatefulToolOptions } from "./stateful-tool-options.js";

const ACTION_DESCRIPTION = [
  "One of: create_price_above, create_price_below, create_price_above_sma,",
  "create_price_below_sma, create_rsi_above, create_rsi_below,",
  "create_volume_spike, create_percent_move_up, create_percent_move_down,",
  "create_sma_cross_above, create_sma_cross_below, set_enabled, list, status, check.",
  "Use create_price_above/create_price_below for price alerts,",
  "create_price_above_sma/create_price_below_sma for SMA crossing alerts,",
  "create_percent_move_up/create_percent_move_down for one-day percent move alerts,",
  "create_sma_cross_above/create_sma_cross_below for fast/slow SMA crossing alerts,",
  "create_rsi_above/create_rsi_below for RSI alerts,",
  "create_volume_spike for volume alerts, set_enabled to enable or disable an alert,",
  "update to replace an alert rule definition, delete to remove a rule,",
  "and status to inspect local runner/check history.",
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
      Type.Literal("create_percent_move_up"),
      Type.Literal("create_percent_move_down"),
      Type.Literal("create_sma_cross_above"),
      Type.Literal("create_sma_cross_below"),
      Type.Literal("set_enabled"),
      Type.Literal("update"),
      Type.Literal("delete"),
      Type.Literal("list"),
      Type.Literal("status"),
      Type.Literal("check"),
    ],
    { description: ACTION_DESCRIPTION },
  ),
  symbol: Type.Optional(Type.String({ description: "Ticker symbol for create actions" })),
  threshold: Type.Optional(
    Type.Number({ description: "Price or indicator threshold for create actions" }),
  ),
  period: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        "Indicator lookback period for SMA/RSI alerts. Max: 200 for price-SMA, 100 for RSI/volume alerts",
    }),
  ),
  fast_period: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "Fast SMA lookback period for SMA-cross alerts. Default: 50",
    }),
  ),
  slow_period: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 400,
      description: "Slow SMA lookback period for SMA-cross alerts. Default: 200, max: 400",
    }),
  ),
  cooldown_seconds: Type.Optional(
    Type.Integer({
      minimum: 0,
      description: "Cooldown between repeated trigger events. Default: 3600",
    }),
  ),
  id: Type.Optional(Type.Number({ description: "Alert rule id for update actions" })),
  condition_action: Type.Optional(
    Type.Union(
      [
        Type.Literal("create_price_above"),
        Type.Literal("create_price_below"),
        Type.Literal("create_price_above_sma"),
        Type.Literal("create_price_below_sma"),
        Type.Literal("create_rsi_above"),
        Type.Literal("create_rsi_below"),
        Type.Literal("create_volume_spike"),
        Type.Literal("create_percent_move_up"),
        Type.Literal("create_percent_move_down"),
        Type.Literal("create_sma_cross_above"),
        Type.Literal("create_sma_cross_below"),
      ],
      {
        description:
          "Create-style alert condition action to use when updating an existing alert rule.",
      },
    ),
  ),
  enabled: Type.Optional(Type.Boolean({ description: "Whether an alert rule is enabled" })),
  check_after_create: Type.Optional(
    Type.Boolean({
      description:
        "Set true only when the user asks to check/run alerts immediately after creating this alert in the same request.",
    }),
  ),
});

export function createAlertsTool(options: StatefulToolOptions): AgentTool<typeof params> {
  return {
    name: "manage_alerts",
    label: "Alerts",
    description:
      "Create, update, delete, pause/resume, list, check, and inspect status for durable local alerts. Actions include create_price_above, create_price_below, create_price_above_sma, create_price_below_sma, create_rsi_above, create_rsi_below, create_volume_spike, create_percent_move_up, create_percent_move_down, create_sma_cross_above, create_sma_cross_below, set_enabled, update, delete, list, status, and check. Local background monitoring runs only while an OpenCandle writer/monitor process is active; manual checks are always available. If the user asks to create an alert and check it now, use the create action with check_after_create=true.",
    parameters: params,
    async execute(_toolCallId, args) {
      const db = options.stateDatabaseFactory();
      const service = new MarketStateService(db);

      try {
        const resolveInstrument: InstrumentResolver = (symbol) =>
          resolveStatefulInstrument(options, symbol, {
            unverifiedExactSymbol:
              (args as typeof args & { unverified_exact_symbol?: unknown })
                .unverified_exact_symbol === true,
          });

        if (isCreateAlertAction(args.action)) {
          const payload = await buildAlertRulePayload(
            service,
            args.action,
            args,
            undefined,
            resolveInstrument,
          );
          if (payload.status === "needs_selection") {
            return candidateResult(payload.resolution, "alert");
          }
          const rule = service.createAlertRule(payload.input);
          const instrument = service.getInstrument(payload.input.instrumentId);
          return await createResultMaybeChecked(
            service,
            rule,
            `Created local alert ${rule.conditionType} for ${instrument?.symbol ?? args.symbol}.`,
            args.check_after_create,
          );
        }

        if (args.action === "list") {
          const rules = service.listAlertRules();
          if (rules.length === 0) {
            return {
              content: [{ type: "text", text: "No alert rules created yet." }],
              details: [],
            };
          }
          const lines = ["**Alerts** — local runner eligible; manual checks available", ""];
          for (const rule of rules) {
            const instrument =
              rule.instrumentId == null ? null : service.getInstrument(rule.instrumentId);
            lines.push(
              `  #${rule.id} ${instrument?.symbol ?? "watchlist"} ${rule.conditionType} (${rule.enabled ? "enabled" : "disabled"})`,
            );
          }
          return { content: [{ type: "text", text: lines.join("\n") }], details: rules };
        }

        if (args.action === "status") {
          const runnerLease = service.getAutomationRunnerLease();
          const recentCheckRuns = service.listAlertCheckRuns().slice(0, 10);
          const stateLine = runnerLease
            ? `Running locally — ${runnerLease.ownerKind} ${runnerLease.ownerId}; heartbeat ${runnerLease.heartbeatAt}; expires ${runnerLease.expiresAt}.`
            : "Manual only — no active local runner lease. Keep the GUI/TUI writer or `opencandle monitor` open for background checks.";
          const lines = ["**Alert Automation Status**", "", stateLine];
          if (recentCheckRuns.length === 0) {
            lines.push("", "No alert check runs yet.");
          } else {
            lines.push("", "Recent checks:");
            for (const run of recentCheckRuns) {
              lines.push(
                `  #${run.id} ${run.triggerType} ${run.status} checked=${run.checkedCount} triggered=${run.triggeredCount} unavailable=${run.unavailableCount}`,
              );
            }
          }
          return {
            content: [{ type: "text", text: lines.join("\n") }],
            details: { runnerLease, recentCheckRuns },
          };
        }

        if (args.action === "set_enabled") {
          if (args.id == null || args.enabled == null) {
            throw new Error("id and enabled are required for set_enabled.");
          }
          const rule = service.setAlertRuleEnabled(args.id, args.enabled);
          if (rule == null) {
            return {
              content: [
                {
                  type: "text",
                  text: `Alert #${args.id} not found. Use the list action to see alert ids.`,
                },
              ],
              details: null,
            };
          }
          return {
            content: [
              {
                type: "text",
                text: `${rule.enabled ? "Enabled" : "Disabled"} alert #${rule.id}.`,
              },
            ],
            details: rule,
          };
        }

        if (args.action === "update") {
          if (args.id == null) {
            throw new Error("id is required for update.");
          }
          const existing = service.listAlertRules().find((rule) => rule.id === args.id);
          if (existing == null) {
            return {
              content: [
                {
                  type: "text",
                  text: `Alert #${args.id} not found. Use the list action to see alert ids.`,
                },
              ],
              details: null,
            };
          }
          const conditionAction = args.condition_action ?? createActionFromRule(existing);
          if (conditionAction == null) {
            throw new Error(
              `Alert #${args.id} uses condition ${existing.conditionType}, which cannot be updated without condition_action.`,
            );
          }
          const payload = await buildAlertRulePayload(
            service,
            conditionAction,
            args,
            existing,
            resolveInstrument,
          );
          if (payload.status === "needs_selection")
            return candidateResult(payload.resolution, "alert");
          const rule = service.updateAlertRule(args.id, {
            ...payload.input,
            enabled: args.enabled,
          });
          return {
            content: [
              {
                type: "text",
                text:
                  rule == null
                    ? `Alert #${args.id} not found. Use the list action to see alert ids.`
                    : `Updated alert #${rule.id}.`,
              },
            ],
            details: rule,
          };
        }

        if (args.action === "delete") {
          if (args.id == null) {
            throw new Error("id is required for delete.");
          }
          const rule = service.deleteAlertRule(args.id);
          return {
            content: [
              {
                type: "text",
                text:
                  rule == null
                    ? `Alert #${args.id} not found. Use the list action to see alert ids.`
                    : `Deleted alert #${rule.id}.`,
              },
            ],
            details: rule,
          };
        }

        if (args.action !== "check") {
          throw new Error(`Unsupported alert action: ${String(args.action)}`);
        }
        const result = await checkAlerts(service);
        return {
          content: [{ type: "text", text: result.lines.join("\n") }],
          details: result,
        };
      } finally {
        if (options.closeDatabaseAfterExecute !== false) db.close();
      }
    },
  };
}

export const alertsTool = createAlertsTool({ stateDatabaseFactory: initDefaultDatabase });

const CREATE_ALERT_ACTIONS = [
  "create_price_above",
  "create_price_below",
  "create_price_above_sma",
  "create_price_below_sma",
  "create_rsi_above",
  "create_rsi_below",
  "create_volume_spike",
  "create_percent_move_up",
  "create_percent_move_down",
  "create_sma_cross_above",
  "create_sma_cross_below",
] as const;

type CreateAlertAction = (typeof CREATE_ALERT_ACTIONS)[number];
const CREATE_ALERT_ACTION_SET = new Set<string>(CREATE_ALERT_ACTIONS);

interface AlertRulePayloadArgs {
  symbol?: string;
  threshold?: number;
  period?: number;
  fast_period?: number;
  slow_period?: number;
  cooldown_seconds?: number;
}

interface AlertRulePayload {
  scopeType: "instrument";
  instrumentId: number;
  conditionType: string;
  conditionVersion: number;
  condition: unknown;
  timeframe: string;
  cooldownSeconds?: number;
}

type InstrumentResolver = (symbol: string) => Promise<MutationInstrumentResolution>;

interface AlertConditionPayload {
  conditionType: string;
  condition: unknown;
  timeframe: string;
}

async function buildAlertRulePayload(
  service: MarketStateService,
  action: CreateAlertAction,
  args: AlertRulePayloadArgs,
  existing?: AlertRuleRecord,
  resolveInstrument: InstrumentResolver = resolveInstrumentForMutation,
): Promise<
  | { status: "ok"; input: AlertRulePayload }
  | {
      status: "needs_selection";
      resolution: Extract<
        Awaited<ReturnType<typeof resolveInstrumentForMutation>>,
        { status: "needs_selection" }
      >;
    }
> {
  const condition = buildAlertConditionPayload(action, args, existing);
  const instrument = await resolveAlertInstrument(
    service,
    args.symbol,
    existing,
    resolveInstrument,
  );
  if (instrument.status === "needs_selection") return instrument;
  const cooldownSeconds =
    args.cooldown_seconds === undefined
      ? existing
        ? undefined
        : validateCooldownSeconds(undefined)
      : validateCooldownSeconds(args.cooldown_seconds);
  return {
    status: "ok",
    input: {
      scopeType: "instrument",
      instrumentId: instrument.id,
      conditionVersion: ALERT_CONDITION_VERSION,
      cooldownSeconds,
      ...condition,
    },
  };
}

function buildAlertConditionPayload(
  action: CreateAlertAction,
  args: AlertRulePayloadArgs,
  existing?: AlertRuleRecord,
): AlertConditionPayload {
  const existingCondition = conditionRecord(existing);
  if (action === "create_price_above" || action === "create_price_below") {
    const threshold = validatePositiveAlertValue(
      numberInput(args.threshold, existingCondition, "threshold", "threshold"),
      "threshold",
    );
    const isAbove = action === "create_price_above";
    return {
      conditionType: isAbove ? "price_crosses_above" : "price_crosses_below",
      condition: isAbove ? priceCrossesAbove(threshold) : priceCrossesBelow(threshold),
      timeframe: "quote",
    };
  }

  if (action === "create_price_above_sma" || action === "create_price_below_sma") {
    const period = validateLookbackPeriod(
      numberInput(args.period, existingCondition, "period", "period", 50),
      200,
    );
    return {
      conditionType: "price_crosses_sma",
      condition: priceCrossesSma(period, action === "create_price_above_sma" ? "above" : "below"),
      timeframe: "1d",
    };
  }

  if (action === "create_rsi_above" || action === "create_rsi_below") {
    const threshold = validateRsiThreshold(
      numberInput(args.threshold, existingCondition, "threshold", "threshold"),
    );
    const period = validateLookbackPeriod(
      numberInput(args.period, existingCondition, "period", "period", 14),
      100,
    );
    return {
      conditionType: "rsi_threshold",
      condition: rsiThreshold(period, threshold, action === "create_rsi_above" ? "above" : "below"),
      timeframe: "1d",
    };
  }

  if (action === "create_volume_spike") {
    const period = validateLookbackPeriod(
      numberInput(args.period, existingCondition, "lookback_period", "period", 20),
      100,
    );
    const multiplier = validatePositiveAlertValue(
      numberInput(args.threshold, existingCondition, "multiplier", "threshold", 2),
      "multiplier",
    );
    return {
      conditionType: "volume_spike",
      condition: volumeSpike(period, multiplier),
      timeframe: "1d",
    };
  }

  if (action === "create_percent_move_up" || action === "create_percent_move_down") {
    const threshold = validatePositiveAlertValue(
      numberInput(args.threshold, existingCondition, "percent", "threshold"),
      "threshold",
    );
    return {
      conditionType: "percent_move",
      condition: percentMove(action === "create_percent_move_up" ? "up" : "down", threshold),
      timeframe: "1d",
    };
  }

  const fastPeriod = numberInput(
    args.fast_period,
    existingCondition,
    "fast_period",
    "fast_period",
    50,
  );
  const slowPeriod = numberInput(
    args.slow_period,
    existingCondition,
    "slow_period",
    "slow_period",
    200,
  );
  if (!Number.isInteger(fastPeriod) || !Number.isInteger(slowPeriod)) {
    throw new Error(
      "fast_period and slow_period must be whole-number lookback periods for SMA-cross alert actions.",
    );
  }
  if (fastPeriod <= 0 || slowPeriod <= 0) {
    throw new Error(
      "fast_period and slow_period must be greater than 0 for SMA-cross alert actions.",
    );
  }
  if (fastPeriod >= slowPeriod) {
    throw new Error("fast_period must be less than slow_period for SMA-cross alert actions.");
  }
  if (slowPeriod > 400) {
    throw new Error(
      "slow_period must be at most 400 so alert checks can evaluate it against the runner's 2y daily history window.",
    );
  }
  return {
    conditionType: "sma_cross",
    condition: smaCross(
      fastPeriod,
      slowPeriod,
      action === "create_sma_cross_above" ? "above" : "below",
    ),
    timeframe: "1d",
  };
}

async function resolveAlertInstrument(
  service: MarketStateService,
  symbol?: string,
  existing?: AlertRuleRecord,
  resolveInstrument: InstrumentResolver = resolveInstrumentForMutation,
): Promise<
  | { status: "ok"; id: number }
  | {
      status: "needs_selection";
      resolution: Extract<
        Awaited<ReturnType<typeof resolveInstrumentForMutation>>,
        { status: "needs_selection" }
      >;
    }
> {
  if (symbol) {
    const resolution = await resolveInstrument(symbol);
    if (resolution.status === "needs_selection") return { status: "needs_selection", resolution };
    return { status: "ok", id: service.upsertInstrumentRecord(resolution.instrument).id };
  }
  if (existing?.instrumentId != null) return { status: "ok", id: existing.instrumentId };
  throw new Error(
    "symbol is required for update when the existing alert is not instrument-scoped.",
  );
}

function conditionRecord(rule?: AlertRuleRecord): Record<string, unknown> {
  return typeof rule?.conditionJson === "object" && rule.conditionJson !== null
    ? (rule.conditionJson as Record<string, unknown>)
    : {};
}

function numberInput(
  value: number | undefined,
  existing: Record<string, unknown>,
  existingKey: string,
  label: string,
  fallback?: number,
): number {
  if (value !== undefined) return value;
  const existingValue = existing[existingKey];
  if (typeof existingValue === "number") return existingValue;
  if (fallback !== undefined) return fallback;
  throw new Error(`${label} is required for update.`);
}

function createActionFromRule(rule: AlertRuleRecord): CreateAlertAction | null {
  const condition = conditionRecord(rule);
  const direction = condition.direction;
  if (rule.conditionType === "price_crosses_above") return "create_price_above";
  if (rule.conditionType === "price_crosses_below") return "create_price_below";
  if (rule.conditionType === "price_crosses_sma") {
    return direction === "below" ? "create_price_below_sma" : "create_price_above_sma";
  }
  if (rule.conditionType === "rsi_threshold") {
    return direction === "below" ? "create_rsi_below" : "create_rsi_above";
  }
  if (rule.conditionType === "volume_spike") return "create_volume_spike";
  if (rule.conditionType === "percent_move") {
    return direction === "down" ? "create_percent_move_down" : "create_percent_move_up";
  }
  if (rule.conditionType === "sma_cross") {
    return direction === "below" ? "create_sma_cross_below" : "create_sma_cross_above";
  }
  return null;
}

function isCreateAlertAction(action: string): action is CreateAlertAction {
  return CREATE_ALERT_ACTION_SET.has(action);
}

function validatePositiveAlertValue(value: number, label: "threshold" | "multiplier"): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite number greater than 0 for this alert action.`);
  }
  return value;
}

function validateRsiThreshold(threshold: number): number {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error("threshold must be a finite RSI value between 0 and 100.");
  }
  return threshold;
}

function validateLookbackPeriod(period: number, maxPeriod: number): number {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error(
      "period must be a whole-number lookback period greater than 0 for indicator alert actions.",
    );
  }
  if (period > maxPeriod) {
    throw new Error(
      `period must be at most ${maxPeriod} so alert checks can evaluate it against the runner's daily history window.`,
    );
  }
  return period;
}

function validateCooldownSeconds(cooldownSeconds: number | undefined): number {
  const resolved = cooldownSeconds ?? 3600;
  if (!Number.isInteger(resolved) || resolved < 0) {
    throw new Error("cooldown_seconds must be a whole number greater than or equal to 0.");
  }
  return resolved;
}

async function checkAlerts(service: MarketStateService): Promise<{
  checked: number;
  triggered: number;
  lines: string[];
}> {
  const enabled = service
    .listAlertRules()
    .filter((rule) => rule.enabled && rule.status === "active");
  if (enabled.length === 0)
    return { checked: 0, triggered: 0, lines: ["No enabled alert rules to check."] };

  const result = await runAlertChecks(service, {
    ownerId: "manual-tool",
    triggerType: "manual",
    providers: defaultAlertRunnerProviders,
  });
  await deliverPendingNotifications(service);
  return {
    checked: result.checked,
    triggered: result.triggered,
    lines: [
      `**Manual Alert Check** — ${enabled.length} rule(s)`,
      "",
      ...result.lines.map((line) => `  ${line}`),
    ],
  };
}

function candidateResult(
  resolution: Extract<
    Awaited<ReturnType<typeof resolveInstrumentForMutation>>,
    { status: "needs_selection" }
  >,
  target: string,
) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Could not verify ${resolution.query}. Choose one of the returned candidates before creating the ${target}.`,
      },
    ],
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
