import {
  ALERT_CONDITION_VERSION,
  percentMove,
  priceCrossesAbove,
  priceCrossesBelow,
  priceCrossesSma,
  rsiThreshold,
  smaCross,
  volumeSpike,
} from "../../../src/market-state/alert-conditions.js";
import { nextDailyReportRunAt } from "../../../src/market-state/daily-report.js";
import {
  resolveInstrumentForMutation,
  type MutationInstrumentResolution,
} from "../../../src/market-state/resolve-for-mutation.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import {
  buildPortfolioView,
  type PortfolioPriceResolver,
  renderPortfolioView,
} from "../../../src/tools/portfolio/portfolio-view.js";
import { getCurrentPrice } from "../../../src/tools/portfolio/tracker.js";

export interface HostedToolInvokeResult {
  toolCallId: string;
  result: {
    content: Array<{ type: "text"; text: string }>;
    details: unknown;
  };
  isError: false;
}

export interface HostedMarketStateDependencies {
  resolveInstrument?: (symbol: string) => Promise<MutationInstrumentResolution>;
  getCurrentPrice?: PortfolioPriceResolver;
}

export async function invokeHostedMarketStateTool(
  service: MarketStateService,
  toolName: string,
  args: Record<string, unknown>,
  toolCallId = `hosted-ui-${crypto.randomUUID()}`,
  dependencies: HostedMarketStateDependencies = {},
): Promise<HostedToolInvokeResult> {
  const output =
    toolName === "manage_watchlist"
      ? manageWatchlist(service, args)
      : toolName === "track_portfolio"
        ? await trackPortfolio(service, args, dependencies)
        : toolName === "manage_alerts"
          ? manageAlerts(service, args)
          : toolName === "manage_notifications"
            ? manageNotifications(service, args)
            : toolName === "daily_watchlist_report"
              ? manageReport(service, args)
              : null;
  if (output === null) {
    throw new Error(
      `${toolName || "This action"} is unavailable in hosted OpenCandle. Use the local GUI or TUI for the full tool set.`,
    );
  }
  return {
    toolCallId,
    result: {
      content: [{ type: "text", text: output.text }],
      details: output.details,
    },
    isError: false,
  };
}

function manageWatchlist(service: MarketStateService, args: Record<string, unknown>) {
  const action = stringArg(args, "action");
  if (action === "create") {
    const value = service.createWatchlist(requiredString(args, "watchlist_name"));
    return result(`Created watchlist ${value.name}.`, value);
  }
  if (action === "rename") {
    const current = resolveWatchlist(service, optionalString(args, "watchlist_name"));
    const value = service.renameWatchlist(current.name, requiredString(args, "new_watchlist_name"));
    return result(`Renamed ${current.name} to ${value.name}.`, value);
  }
  if (action === "delete") {
    const current = resolveWatchlist(service, optionalString(args, "watchlist_name"));
    const value = service.deleteWatchlist(current.name);
    return result(`Deleted ${current.name}.`, value);
  }
  const watchlist = resolveWatchlist(service, optionalString(args, "watchlist_name"), true);
  if (action === "add") {
    const symbol = normalizedSymbol(args.symbol);
    const value = service.addWatchlistItem({
      watchlistId: watchlist.id,
      instrument: hostedInstrument(symbol, optionalString(args, "currency")),
      source: "hosted-user",
    });
    return result(`Added ${symbol} to ${watchlist.name}.`, value);
  }
  if (action === "remove") {
    if (args.item_id != null) {
      const id = positiveInteger(args.item_id, "item_id");
      const item = service.listWatchlistItems(watchlist.id).find((candidate) => candidate.id === id);
      const removed = item ? service.removeWatchlistItem(id, watchlist.id) : false;
      return result(
        removed ? `Removed ${item?.symbol} from ${watchlist.name}.` : `Watchlist item ${id} was not found.`,
        null,
      );
    }
    throw new Error(
      "item_id is required for remove action. Use check to find the stable watchlist item id.",
    );
  }
  if (action === "check") {
    const items = service.listWatchlistItems(watchlist.id);
    if (items.length === 0) {
      return result(`${watchlist.name} is empty. Use add action to add symbols.`, {
        watchlist,
        items,
      });
    }
    const rows = items.map((item) => `  ${item.symbol} [item ${item.id}]`);
    return result(
      [`${watchlist.name} has ${items.length} symbol${items.length === 1 ? "" : "s"}.`, ...rows].join(
        "\n",
      ),
      { watchlist, items },
    );
  }
  throw new Error("Unsupported watchlist action.");
}

async function trackPortfolio(
  service: MarketStateService,
  args: Record<string, unknown>,
  dependencies: HostedMarketStateDependencies,
) {
  const action = stringArg(args, "action");
  if (action === "create") {
    const value = service.createPortfolio(requiredString(args, "portfolio_name"));
    return result(`Created portfolio ${value.name}.`, value);
  }
  if (action === "rename") {
    const current = resolvePortfolio(service, optionalString(args, "portfolio_name"));
    const value = service.renamePortfolio(current.name, requiredString(args, "new_portfolio_name"));
    return result(`Renamed ${current.name} to ${value.name}.`, value);
  }
  const portfolio = resolvePortfolio(service, optionalString(args, "portfolio_name"), true);
  if (action === "add") {
    const symbol = normalizedSymbol(args.symbol);
    const quantity = positiveNumber(args.shares, "shares");
    const avgCost = positiveNumber(args.avg_cost, "avg_cost");
    const explicitCurrency = optionalString(args, "currency");
    const resolved = explicitCurrency
      ? { status: "resolved" as const, instrument: hostedInstrument(symbol, explicitCurrency) }
      : await (dependencies.resolveInstrument ?? resolveInstrumentForMutation)(symbol);
    if (resolved.status === "needs_selection") {
      return result(
        `Could not verify ${resolved.query}. Choose one of the returned candidates before adding it to the portfolio.`,
        resolved,
      );
    }
    const resolvedCurrency = explicitCurrency || resolved.instrument.currency?.trim();
    if (!resolvedCurrency) {
      return result(
        `Could not determine currency for ${resolved.instrument.symbol}. Supply currency explicitly before adding it to the portfolio.`,
        { status: "needs_currency", symbol: resolved.instrument.symbol },
      );
    }
    const currency = resolvedCurrency.toUpperCase();
    const value = service.addPortfolioLot({
      portfolioId: portfolio.id,
      instrument: resolved.instrument,
      quantity,
      avgCost,
      currency,
      source: "hosted-user",
    });
    return result(`Added ${quantity} ${symbol} at ${avgCost} ${currency}.`, value);
  }
  if (action === "update") {
    const id = positiveInteger(args.lot_id, "lot_id");
    const selected = service.listPortfolioLots(portfolio.id).find((lot) => lot.id === id);
    if (!selected) throw new Error(`Portfolio lot ${id} was not found in ${portfolio.name}.`);
    const value = service.updatePortfolioLot(id, {
      ...(args.shares == null ? {} : { quantity: positiveNumber(args.shares, "shares") }),
      ...(args.avg_cost == null ? {} : { avgCost: positiveNumber(args.avg_cost, "avg_cost") }),
      ...(optionalString(args, "currency")
        ? { currency: optionalString(args, "currency")?.toUpperCase() }
        : {}),
    });
    if (!value) throw new Error(`Portfolio lot ${id} was not found.`);
    return result(`Updated ${value.symbol} portfolio lot ${id}.`, value);
  }
  if (action === "remove") {
    if (args.lot_id != null) {
      const id = positiveInteger(args.lot_id, "lot_id");
      const selected = service.listPortfolioLots(portfolio.id).find((lot) => lot.id === id);
      if (!selected) {
        return result(`Portfolio lot ${id} was not found in ${portfolio.name}.`, null);
      }
      const value = service.removePortfolioLot(id);
      return result(value ? `Removed portfolio lot ${id}.` : `Portfolio lot ${id} was not found.`, value);
    }
    throw new Error(
      "lot_id is required for remove action. Use view to find the stable portfolio lot id.",
    );
  }
  if (action === "view") {
    const lots = service.listPortfolioLots(portfolio.id);
    if (lots.length === 0) {
      return result(`${portfolio.name} is empty. Use add action to add positions.`, lots);
    }
    const displayPortfolioName = portfolio.isDefault ? "Portfolio" : portfolio.name;
    const summary = await buildPortfolioView(
      lots,
      portfolio.baseCurrency ?? "USD",
      dependencies.getCurrentPrice ?? getCurrentPrice,
    );
    return result(renderPortfolioView(displayPortfolioName, summary), summary);
  }
  throw new Error("Unsupported portfolio action.");
}

function manageAlerts(service: MarketStateService, args: Record<string, unknown>) {
  const action = stringArg(args, "action");
  if (action === "list" || action === "status") {
    const values = service.listAlertRules();
    return result(`${values.length} hosted alert rule${values.length === 1 ? "" : "s"}.`, values);
  }
  if (action === "set_enabled") {
    const id = positiveInteger(args.id, "id");
    if (typeof args.enabled !== "boolean") throw new Error("enabled is required.");
    const value = service.setAlertRuleEnabled(id, args.enabled);
    if (!value) throw new Error(`Alert ${id} was not found.`);
    return result(`${args.enabled ? "Enabled" : "Paused"} alert ${id}.`, value);
  }
  if (action === "delete") {
    const id = positiveInteger(args.id, "id");
    const value = service.deleteAlertRule(id);
    return result(value ? `Deleted alert ${id}.` : `Alert ${id} was not found.`, value);
  }
  if (action === "check") providerUnavailable("manual alert checks");

  const conditionAction = action === "update" ? requiredString(args, "condition_action") : action;
  const symbol = normalizedSymbol(args.symbol);
  const instrument = service.upsertInstrumentRecord(hostedInstrument(symbol, "USD"));
  const condition = alertCondition(conditionAction, args);
  if (action === "update") {
    const id = positiveInteger(args.id, "id");
    const value = service.updateAlertRule(id, {
      instrumentId: instrument.id,
      conditionType: condition.type,
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: condition.value,
      timeframe: condition.timeframe,
      cooldownSeconds: optionalPositiveInteger(args.cooldown_seconds),
    });
    if (!value) throw new Error(`Alert ${id} was not found.`);
    return result(`Updated alert ${id} for ${symbol}.`, value);
  }
  const value = service.createAlertRule({
    scopeType: "instrument",
    instrumentId: instrument.id,
    conditionType: condition.type,
    conditionVersion: ALERT_CONDITION_VERSION,
    condition: condition.value,
    timeframe: condition.timeframe,
    cooldownSeconds: optionalPositiveInteger(args.cooldown_seconds),
  });
  return result(`Created alert ${value.id} for ${symbol}.`, value);
}

function manageNotifications(service: MarketStateService, args: Record<string, unknown>) {
  const action = stringArg(args, "action");
  if (action === "list") {
    const values = service.listNotificationEvents();
    return result(`${values.length} notification${values.length === 1 ? "" : "s"}.`, values);
  }
  if (action === "acknowledge") {
    const id = positiveInteger(args.id, "id");
    const value = service.acknowledgeNotificationEvent(id);
    return result(`Marked notification ${id} as read.`, value);
  }
  throw new Error("Unsupported notification action.");
}

function manageReport(service: MarketStateService, args: Record<string, unknown>) {
  const action = stringArg(args, "action");
  if (action === "history") {
    const values = service.listReportRuns();
    return result(`${values.length} report run${values.length === 1 ? "" : "s"}.`, values);
  }
  if (action === "run") providerUnavailable("live report generation");
  if (action !== "configure") throw new Error("Unsupported report action.");
  const timezone = optionalString(args, "timezone") || "UTC";
  const localTime = optionalString(args, "local_time") || "08:00";
  const params = {
    name: "Morning watchlist",
    reportType: "watchlist_daily",
    cadence: "daily",
    timezone,
    localTime,
    config: { targets: { default_watchlist: true } },
    enabled: true,
    nextRunAt: nextDailyReportRunAt(timezone, localTime),
  };
  const existing = service.listReportTemplates().find((value) => value.reportType === "watchlist_daily");
  const value = existing
    ? service.updateReportTemplate(existing.id, params)
    : service.createReportTemplate(params);
  return result(`Saved report schedule for ${localTime} ${timezone}.`, value);
}

function alertCondition(action: string, args: Record<string, unknown>) {
  if (action === "create_price_above" || action === "create_price_below") {
    const threshold = positiveNumber(args.threshold, "threshold");
    return {
      type: action === "create_price_above" ? "price_crosses_above" : "price_crosses_below",
      timeframe: "quote",
      value: action === "create_price_above" ? priceCrossesAbove(threshold) : priceCrossesBelow(threshold),
    };
  }
  if (action === "create_price_above_sma" || action === "create_price_below_sma") {
    const direction = action === "create_price_above_sma" ? "above" : "below";
    return { type: "price_crosses_sma", timeframe: "1d", value: priceCrossesSma(optionalPositiveInteger(args.period) ?? 50, direction) };
  }
  if (action === "create_rsi_above" || action === "create_rsi_below") {
    const direction = action === "create_rsi_above" ? "above" : "below";
    return { type: "rsi_threshold", timeframe: "1d", value: rsiThreshold(optionalPositiveInteger(args.period) ?? 14, positiveNumber(args.threshold, "threshold"), direction) };
  }
  if (action === "create_volume_spike") {
    return { type: "volume_spike", timeframe: "1d", value: volumeSpike(optionalPositiveInteger(args.period) ?? 20, positiveNumber(args.threshold ?? 2, "threshold")) };
  }
  if (action === "create_percent_move_up" || action === "create_percent_move_down") {
    const direction = action === "create_percent_move_up" ? "up" : "down";
    return { type: "percent_move", timeframe: "1d", value: percentMove(direction, positiveNumber(args.threshold, "threshold")) };
  }
  if (action === "create_sma_cross_above" || action === "create_sma_cross_below") {
    const direction = action === "create_sma_cross_above" ? "above" : "below";
    const fast = optionalPositiveInteger(args.fast_period) ?? 50;
    const slow = optionalPositiveInteger(args.slow_period) ?? 200;
    if (fast >= slow) throw new Error("fast_period must be less than slow_period.");
    return { type: "sma_cross", timeframe: "1d", value: smaCross(fast, slow, direction) };
  }
  throw new Error("Unsupported alert condition.");
}

function hostedInstrument(symbol: string, currency?: string | null) {
  return {
    symbol,
    assetType: symbol.endsWith("-USD") ? "crypto" : "equity",
    name: symbol,
    currency: currency || "USD",
    provider: "hosted-user",
    providerMetadata: { verified: false, source: "user-input" },
  };
}

function resolveWatchlist(service: MarketStateService, name?: string, create = false) {
  if (!name) return service.getDefaultWatchlist();
  const value = create ? service.getOrCreateWatchlist(name) : service.getWatchlistByName(name);
  if (!value) throw new Error(`Watchlist ${name} was not found.`);
  return value;
}

function resolvePortfolio(service: MarketStateService, name?: string, create = false) {
  if (!name) return service.getDefaultPortfolio();
  const value = create ? service.getOrCreatePortfolio(name) : service.getPortfolioByName(name);
  if (!value) throw new Error(`Portfolio ${name} was not found.`);
  return value;
}

function result(text: string, details: unknown) {
  return { text, details };
}

function providerUnavailable(capability: string): never {
  throw new Error(
    `${capability} require a provider that is unavailable in serverless browser mode. Use the local GUI or TUI for this action.`,
  );
}

function stringArg(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === "string" ? args[key].trim() : "";
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = stringArg(args, key);
  if (!value || value.length > 160) throw new Error(`${key} is required and must be 160 characters or fewer.`);
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = stringArg(args, key);
  return value || undefined;
}

function normalizedSymbol(value: unknown): string {
  const symbol = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9.^=_/-]{0,31}$/.test(symbol)) throw new Error("Enter a valid ticker symbol.");
  return symbol;
}

function positiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than 0.`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (value == null) return undefined;
  return positiveInteger(value, "value");
}
