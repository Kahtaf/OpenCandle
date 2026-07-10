import { canUseTradingViewQuote, getQuotes } from "../providers/tradingview.js";
import { wrapProvider } from "../providers/wrap-provider.js";
import { getHistory, getQuote } from "../providers/yahoo-finance.js";
import { computeRSI, computeSMA } from "../tools/technical/indicators.js";
import type { OHLCV } from "../types/market.js";
import { ALERT_CONDITION_VERSION } from "./alert-conditions.js";
import { isZeroFilledQuote } from "./resolve.js";
import type { AlertRuleRecord, InstrumentRecord, MarketStateService } from "./service.js";

export interface AlertQuoteObservation {
  symbol: string;
  value: number;
  observationDetails?: Record<string, number>;
  sourceProvider: string;
  observedAt: string;
  providerDataAt?: string | null;
  cacheStatus: "live" | "cached" | "stale";
  dataDelayMs?: number | null;
  caveat?: string;
}

export interface AlertRunnerProviders {
  getTradingViewQuotes(symbols: string[]): Promise<AlertQuoteObservation[]>;
  getYahooQuote(symbol: string): Promise<AlertQuoteObservation>;
  getHistory(symbol: string, range: string, interval: string): Promise<OHLCV[]>;
}

export interface AlertRunnerOptions {
  ownerId?: string | null;
  triggerType: "heartbeat" | "manual" | "scheduled" | "resume";
  now?: string;
  providers: AlertRunnerProviders;
  providerBudget?: AlertProviderBudget;
}

export interface AlertRunnerResult {
  checked: number;
  triggered: number;
  unavailable: number;
  runId: number;
  lines: string[];
}

export interface AlertProviderBudgetOptions {
  failureThreshold?: number;
  backoffMs?: number;
}

export interface AlertProviderBudgetSnapshotEntry {
  state: "available" | "open";
  failureCount: number;
  openUntil?: string;
  reason?: string;
}

interface ProviderBudgetState {
  failureCount: number;
  openUntilMs: number;
  reason?: string;
}

export class AlertProviderBudget {
  private readonly state = new Map<string, ProviderBudgetState>();
  private readonly failureThreshold: number;
  private readonly backoffMs: number;

  constructor(options: AlertProviderBudgetOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 2;
    this.backoffMs = options.backoffMs ?? 5 * 60_000;
  }

  unavailableReason(provider: string, now: string): string | null {
    const current = this.state.get(provider);
    if (current == null || current.openUntilMs <= new Date(now).getTime()) return null;
    return `${provider} provider_budget_exhausted until ${new Date(current.openUntilMs).toISOString()}${current.reason ? ` (${current.reason})` : ""}`;
  }

  recordSuccess(provider: string): void {
    this.state.delete(provider);
  }

  recordFailure(provider: string, reason: string, now: string): void {
    const current = this.state.get(provider) ?? { failureCount: 0, openUntilMs: 0 };
    const nextFailureCount = current.failureCount + 1;
    this.state.set(provider, {
      failureCount: nextFailureCount,
      openUntilMs:
        nextFailureCount >= this.failureThreshold ? new Date(now).getTime() + this.backoffMs : 0,
      reason,
    });
  }

  reset(): void {
    this.state.clear();
  }

  snapshot(now: string): Record<string, AlertProviderBudgetSnapshotEntry> {
    const nowMs = new Date(now).getTime();
    return Object.fromEntries(
      [...this.state.entries()].map(([provider, state]) => [
        provider,
        {
          state: state.openUntilMs > nowMs ? "open" : "available",
          failureCount: state.failureCount,
          ...(state.openUntilMs > nowMs
            ? { openUntil: new Date(state.openUntilMs).toISOString() }
            : {}),
          ...(state.reason ? { reason: state.reason } : {}),
        },
      ]),
    );
  }
}

export const defaultAlertProviderBudget = new AlertProviderBudget();

export const defaultAlertRunnerProviders: AlertRunnerProviders = {
  async getTradingViewQuotes(symbols) {
    const result = await wrapProvider("tradingview", () => getQuotes(symbols));
    if (result.status === "unavailable") throw new Error(result.reason);
    if (result.stale) throw new Error("provider returned stale market data");
    return result.data.map((quote) => ({
      symbol: quote.requestedSymbol,
      value: quote.price,
      sourceProvider: "tradingview",
      observedAt: result.timestamp,
      providerDataAt: null,
      cacheStatus: result.stale ? "stale" : "live",
      dataDelayMs: 15 * 60_000,
      caveat: quote.dataCaveat,
    }));
  },
  async getYahooQuote(symbol) {
    const result = await wrapProvider("yahoo", () => getQuote(symbol));
    if (result.status === "unavailable") throw new Error(result.reason);
    if (result.stale) throw new Error("provider returned stale market data");
    if (isZeroFilledQuote(result.data)) throw new Error("Yahoo returned no valid market data.");
    return {
      symbol,
      value: result.data.price,
      sourceProvider: "yahoo",
      observedAt: result.timestamp,
      providerDataAt: new Date(result.data.timestamp).toISOString(),
      cacheStatus: "live",
    };
  },
  async getHistory(symbol, range, interval) {
    const result = await wrapProvider("yahoo", () => getHistory(symbol, range, interval));
    if (result.status === "unavailable") throw new Error(result.reason);
    if (result.stale) throw new Error("provider returned stale market data");
    return result.data;
  },
};

interface ObservationSet {
  observations: Map<string, AlertQuoteObservation>;
  unavailableReasons: Map<string, string>;
}

interface RunnableRule {
  rule: AlertRuleRecord;
  instrument: InstrumentRecord;
}

export async function runAlertChecks(
  service: MarketStateService,
  options: AlertRunnerOptions,
): Promise<AlertRunnerResult> {
  const now = options.now ?? new Date().toISOString();
  const providerBudget = options.providerBudget ?? defaultAlertProviderBudget;
  const historyCache = new Map<string, Promise<OHLCV[]>>();
  const run = service.startAlertCheckRun({
    ownerId: options.ownerId,
    triggerType: options.triggerType,
    startedAt: now,
  });

  let triggered = 0;
  let unavailable = 0;
  const lines: string[] = [];

  try {
    const rules = service
      .listAlertRules()
      .filter((rule) => rule.enabled && rule.status === "active" && isDue(rule, now));
    const runnable = rules.flatMap((rule): RunnableRule[] => {
      if (rule.conditionVersion !== ALERT_CONDITION_VERSION) {
        unavailable++;
        lines.push(
          `#${rule.id}: needs review (unsupported condition version ${rule.conditionVersion})`,
        );
        return [];
      }
      if (rule.instrumentId == null) {
        unavailable++;
        lines.push(`#${rule.id}: unavailable instrument`);
        return [];
      }
      const instrument = service.getInstrument(rule.instrumentId);
      if (instrument == null) {
        unavailable++;
        lines.push(`#${rule.id}: unavailable instrument`);
        return [];
      }
      return [{ rule, instrument }];
    });

    const priceRules = runnable.filter(
      ({ rule }) =>
        rule.conditionType === "price_crosses_above" ||
        rule.conditionType === "price_crosses_below",
    );
    const quoteObservations = await loadPriceObservations(
      priceRules,
      options.providers,
      providerBudget,
      now,
    );

    for (const item of runnable) {
      const observationKey = isPriceRule(item.rule)
        ? quoteObservationKey(item.instrument.symbol, allowsDelayedObservation(item.rule))
        : item.instrument.symbol;
      const observation = isPriceRule(item.rule)
        ? quoteObservations.observations.get(observationKey)
        : await loadHistoricalObservation(
            item,
            options.providers,
            providerBudget,
            historyCache,
            now,
          );
      if (!observation) {
        const reason =
          quoteObservations.unavailableReasons.get(observationKey) ??
          quoteObservations.unavailableReasons.get(item.instrument.symbol) ??
          `no provider observation for ${item.instrument.symbol}`;
        unavailable++;
        service.recordAlertUnavailable({
          ruleId: item.rule.id,
          instrumentId: item.instrument.id,
          reason,
          checkedAt: now,
        });
        lines.push(`${item.instrument.symbol}: unavailable (${reason})`);
        continue;
      }

      const previous = lastObservedValue(item.rule);
      const conditionState = conditionIsTrue(item.rule, observation.value) ? "true" : "false";
      const shouldTrigger =
        conditionState === "true" &&
        previous != null &&
        crosses(item.rule, previous, observation.value) &&
        outsideCooldown(item.rule, now);
      const observed = {
        value: observation.value,
        field: observationField(item.rule),
        ...observation.observationDetails,
        at: now,
        observedAt: now,
        providerDataAt: observation.providerDataAt ?? null,
        sourceProvider: observation.sourceProvider,
        cacheStatus: observation.cacheStatus,
        dataDelayMs: observation.dataDelayMs ?? null,
        caveat: observation.caveat ?? null,
      };

      const result = service.recordAlertEvaluationResult({
        ruleId: item.rule.id,
        observed,
        checkedAt: now,
        conditionState,
        trigger: shouldTrigger
          ? {
              instrumentId: item.instrument.id,
              title: `${item.instrument.symbol} alert triggered`,
              message: alertTriggerMessage(item.instrument.symbol, item.rule, observation.value),
              triggeredAt: now,
              observedAt: now,
              providerDataAt: observation.providerDataAt ?? null,
              sourceProvider: observation.sourceProvider,
              cacheStatus: observation.cacheStatus,
              dataDelayMs: observation.dataDelayMs ?? null,
              triggerSource: options.triggerType,
              dedupeKey: alertDedupeKey(item.rule, observation, options.triggerType),
              status: options.triggerType === "resume" ? "triggered_late" : "triggered",
            }
          : undefined,
      });

      if (result.triggered) {
        triggered++;
        lines.push(
          `TRIGGERED: ${item.instrument.symbol} — ${alertTriggerMessage(item.instrument.symbol, item.rule, observation.value)}${observationSourceSuffix(observation)}`,
        );
      } else {
        lines.push(
          `${item.instrument.symbol}: ${previous == null ? "seeded" : "checked"} — observed ${observation.value.toFixed(2)} vs ${conditionTargetLabel(item.rule)} (condition ${conditionState})${observationSourceSuffix(observation)}`,
        );
      }
    }

    service.completeAlertCheckRun(run.id, {
      completedAt: now,
      status: "completed",
      checkedCount: rules.length,
      triggeredCount: triggered,
      unavailableCount: unavailable,
      providerStatus: {
        checkedSymbols: runnable.map((item) => item.instrument.symbol),
        unavailableReasons: Object.fromEntries(quoteObservations.unavailableReasons),
        providerBudget: providerBudget.snapshot(now),
      },
    });

    return { checked: rules.length, triggered, unavailable, runId: run.id, lines };
  } catch (error) {
    service.completeAlertCheckRun(run.id, {
      completedAt: now,
      status: "failed",
      checkedCount: 0,
      triggeredCount: triggered,
      unavailableCount: unavailable,
      error: { message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

async function loadPriceObservations(
  rules: RunnableRule[],
  providers: AlertRunnerProviders,
  providerBudget: AlertProviderBudget,
  now: string,
): Promise<ObservationSet> {
  const symbols = [...new Set(rules.map(({ instrument }) => instrument.symbol))].sort();
  const tradingViewSymbols = symbols.filter(
    (symbol) =>
      canUseTradingViewQuote(symbol) &&
      rules.some(
        ({ rule, instrument }) => instrument.symbol === symbol && allowsDelayedObservation(rule),
      ),
  );
  const yahooSymbols = new Set(
    symbols.filter(
      (symbol) =>
        !canUseTradingViewQuote(symbol) ||
        rules.some(
          ({ rule, instrument }) => instrument.symbol === symbol && !allowsDelayedObservation(rule),
        ),
    ),
  );
  const observations = new Map<string, AlertQuoteObservation>();
  const unavailableReasons = new Map<string, string>();

  if (tradingViewSymbols.length > 0) {
    const budgetReason = providerBudget.unavailableReason("tradingview", now);
    if (budgetReason) {
      for (const symbol of tradingViewSymbols) {
        yahooSymbols.add(symbol);
        unavailableReasons.set(symbol, budgetReason);
        unavailableReasons.set(quoteObservationKey(symbol, true), budgetReason);
      }
    } else {
      try {
        for (const quote of await providers.getTradingViewQuotes(tradingViewSymbols)) {
          if (quote.cacheStatus === "stale") {
            unavailableReasons.set(
              quoteObservationKey(quote.symbol, true),
              "TradingView returned stale market data",
            );
            continue;
          }
          observations.set(
            quoteObservationKey(quote.symbol, true),
            normalizeObservation(quote, now),
          );
        }
        providerBudget.recordSuccess("tradingview");
      } catch (error) {
        const reason = error instanceof Error ? error.message : "TradingView unavailable";
        providerBudget.recordFailure("tradingview", reason, now);
        for (const symbol of tradingViewSymbols) {
          yahooSymbols.add(symbol);
          unavailableReasons.set(symbol, reason);
          unavailableReasons.set(quoteObservationKey(symbol, true), reason);
        }
      }
    }
  }

  for (const symbol of tradingViewSymbols) {
    if (!observations.has(quoteObservationKey(symbol, true))) yahooSymbols.add(symbol);
  }

  const yahooSymbolList = [...yahooSymbols];
  const yahooBudgetReason = providerBudget.unavailableReason("yahoo", now);
  if (yahooBudgetReason) {
    for (const symbol of yahooSymbolList) {
      const prior = unavailableReasons.get(symbol);
      unavailableReasons.set(symbol, prior ? `${prior}; ${yahooBudgetReason}` : yahooBudgetReason);
      unavailableReasons.set(quoteObservationKey(symbol, false), yahooBudgetReason);
    }
  } else {
    const yahooResults = await Promise.allSettled(
      yahooSymbolList.map((symbol) => providers.getYahooQuote(symbol)),
    );

    for (const [index, result] of yahooResults.entries()) {
      const symbol = yahooSymbolList[index];
      if (symbol == null) continue;

      if (result.status === "fulfilled") {
        const normalized = normalizeObservation(result.value, now);
        observations.set(quoteObservationKey(symbol, false), normalized);
        if (!observations.has(quoteObservationKey(symbol, true))) {
          observations.set(quoteObservationKey(symbol, true), normalized);
        }
        unavailableReasons.delete(symbol);
        unavailableReasons.delete(quoteObservationKey(symbol, false));
        unavailableReasons.delete(quoteObservationKey(symbol, true));
        providerBudget.recordSuccess("yahoo");
      } else {
        const prior = unavailableReasons.get(symbol);
        const reason = result.reason instanceof Error ? result.reason.message : "Yahoo unavailable";
        if (isProviderWideFailure(reason)) providerBudget.recordFailure("yahoo", reason, now);
        const mergedReason = prior ? `${prior}; Yahoo fallback unavailable: ${reason}` : reason;
        unavailableReasons.set(symbol, mergedReason);
        unavailableReasons.set(quoteObservationKey(symbol, false), reason);
        if (!observations.has(quoteObservationKey(symbol, true))) {
          const delayedKey = quoteObservationKey(symbol, true);
          const delayedPrior = unavailableReasons.get(delayedKey);
          unavailableReasons.set(
            delayedKey,
            delayedPrior ? `${delayedPrior}; Yahoo fallback unavailable: ${reason}` : mergedReason,
          );
        }
      }
    }
  }

  return { observations, unavailableReasons };
}

async function loadHistoricalObservation(
  item: RunnableRule,
  providers: AlertRunnerProviders,
  providerBudget: AlertProviderBudget,
  historyCache: Map<string, Promise<OHLCV[]>>,
  now: string,
): Promise<AlertQuoteObservation | null> {
  try {
    if (item.rule.conditionType === "price_crosses_sma") {
      const condition = item.rule.conditionJson as { period?: unknown };
      const period = typeof condition.period === "number" ? condition.period : 50;
      const bars = await loadHistory(
        item.instrument.symbol,
        "1y",
        "1d",
        providers,
        providerBudget,
        historyCache,
        now,
      );
      const closes = bars.map((bar) => bar.close);
      const sma = computeSMA(closes, period);
      const latestClose = closes.at(-1);
      const latestSma = sma.at(-1);
      if (latestClose == null || latestSma == null) return null;
      return historicalObservation(
        item.instrument.symbol,
        latestClose - latestSma,
        bars.at(-1)?.date ?? null,
        now,
        { price: latestClose, sma: latestSma },
      );
    }

    if (item.rule.conditionType === "percent_move") {
      const bars = await loadHistory(
        item.instrument.symbol,
        "5d",
        "1d",
        providers,
        providerBudget,
        historyCache,
        now,
      );
      const latest = bars.at(-1);
      const prior = bars.at(-2);
      if (latest == null || prior == null || prior.close === 0) return null;
      const move = (latest.close / prior.close - 1) * 100;
      return historicalObservation(
        item.instrument.symbol,
        roundObservation(move),
        latest.date,
        now,
      );
    }

    if (item.rule.conditionType === "sma_cross") {
      const condition = item.rule.conditionJson as { fast_period?: unknown; slow_period?: unknown };
      const fastPeriod = typeof condition.fast_period === "number" ? condition.fast_period : 50;
      const slowPeriod = typeof condition.slow_period === "number" ? condition.slow_period : 200;
      const bars = await loadHistory(
        item.instrument.symbol,
        "2y",
        "1d",
        providers,
        providerBudget,
        historyCache,
        now,
      );
      const closes = bars.map((bar) => bar.close);
      const fast = computeSMA(closes, fastPeriod).at(-1);
      const slow = computeSMA(closes, slowPeriod).at(-1);
      if (fast == null || slow == null) return null;
      return historicalObservation(
        item.instrument.symbol,
        roundObservation(fast - slow),
        bars.at(-1)?.date ?? null,
        now,
        { fast_sma: fast, slow_sma: slow },
      );
    }

    if (item.rule.conditionType === "rsi_threshold") {
      const condition = item.rule.conditionJson as { period?: unknown };
      const period = typeof condition.period === "number" ? condition.period : 14;
      const bars = await loadHistory(
        item.instrument.symbol,
        "6mo",
        "1d",
        providers,
        providerBudget,
        historyCache,
        now,
      );
      const rsi = computeRSI(
        bars.map((bar) => bar.close),
        period,
      );
      const latestRsi = rsi.at(-1);
      if (latestRsi == null) return null;
      return historicalObservation(
        item.instrument.symbol,
        latestRsi,
        bars.at(-1)?.date ?? null,
        now,
      );
    }

    if (item.rule.conditionType === "volume_spike") {
      const condition = item.rule.conditionJson as { lookback_period?: unknown };
      const period = typeof condition.lookback_period === "number" ? condition.lookback_period : 20;
      const bars = await loadHistory(
        item.instrument.symbol,
        "6mo",
        "1d",
        providers,
        providerBudget,
        historyCache,
        now,
      );
      const latest = bars.at(-1);
      const prior = bars.slice(Math.max(0, bars.length - 1 - period), bars.length - 1);
      if (latest == null || prior.length < period) return null;
      const averageVolume = prior.reduce((sum, bar) => sum + bar.volume, 0) / prior.length;
      if (averageVolume <= 0) return null;
      return historicalObservation(
        item.instrument.symbol,
        latest.volume / averageVolume,
        latest.date,
        now,
      );
    }
  } catch {
    return null;
  }
  return null;
}

function loadHistory(
  symbol: string,
  range: string,
  interval: string,
  providers: AlertRunnerProviders,
  providerBudget: AlertProviderBudget,
  historyCache: Map<string, Promise<OHLCV[]>>,
  now: string,
): Promise<OHLCV[]> {
  const budgetReason = providerBudget.unavailableReason("yahoo", now);
  if (budgetReason) return Promise.reject(new Error(budgetReason));
  const key = `${symbol}:${range}:${interval}`;
  const cached = historyCache.get(key);
  if (cached) return cached;
  const promise = providers
    .getHistory(symbol, range, interval)
    .then((bars) => {
      providerBudget.recordSuccess("yahoo");
      return bars;
    })
    .catch((error) => {
      const reason = error instanceof Error ? error.message : "Yahoo history unavailable";
      if (isProviderWideFailure(reason)) providerBudget.recordFailure("yahoo", reason, now);
      throw error;
    });
  historyCache.set(key, promise);
  return promise;
}

function isProviderWideFailure(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return (
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("provider_budget_exhausted") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("network") ||
    normalized.includes("fetch failed") ||
    normalized.includes("econn") ||
    normalized.includes("enotfound")
  );
}

function historicalObservation(
  symbol: string,
  value: number,
  providerDataAt: string | null,
  now: string,
  observationDetails?: Record<string, number>,
): AlertQuoteObservation {
  return {
    symbol,
    value,
    observationDetails,
    sourceProvider: "yahoo",
    observedAt: now,
    providerDataAt,
    cacheStatus: "live",
  };
}

function observationField(rule: AlertRuleRecord): string {
  if (rule.conditionType === "rsi_threshold") return "rsi";
  if (rule.conditionType === "volume_spike") return "volume_ratio";
  if (rule.conditionType === "price_crosses_sma") return "price_sma_spread";
  if (rule.conditionType === "percent_move") return "percent_move";
  if (rule.conditionType === "sma_cross") return "sma_spread";
  return "last_price";
}

function conditionTargetLabel(rule: AlertRuleRecord): string {
  const c = (rule.conditionJson ?? {}) as Record<string, unknown>;
  switch (rule.conditionType) {
    case "price_crosses_above":
      return `above ${Number(c.threshold).toFixed(2)}`;
    case "price_crosses_below":
      return `below ${Number(c.threshold).toFixed(2)}`;
    case "rsi_threshold":
      return `RSI ${c.direction === "below" ? "below" : "above"} ${c.threshold} (${c.period}-day)`;
    case "percent_move":
      return `${c.direction === "down" ? "down" : "up"} ${c.percent}% in ${c.window ?? "1d"}`;
    case "price_crosses_sma":
      return `price ${c.direction === "below" ? "below" : "above"} ${c.period}-day SMA`;
    case "sma_cross":
      return `${c.fast_period}-day SMA ${c.direction === "below" ? "below" : "above"} ${c.slow_period}-day SMA`;
    case "volume_spike":
      return `${c.multiplier}x the ${c.lookback_period}-day average volume`;
    default:
      return rule.conditionType;
  }
}

function observationSourceSuffix(observation: {
  sourceProvider: string;
  dataDelayMs?: number | null;
}): string {
  const delay =
    observation.dataDelayMs != null && observation.dataDelayMs > 0
      ? `, ~${Math.round(observation.dataDelayMs / 60_000)}m delayed`
      : "";
  return ` [${observation.sourceProvider}${delay}]`;
}

function alertTriggerMessage(symbol: string, rule: AlertRuleRecord, value: number): string {
  if (rule.conditionType === "rsi_threshold") {
    const direction = (rule.conditionJson as { direction?: unknown }).direction;
    const directionText = direction === "above" ? "above" : "below";
    return `${symbol} RSI ${directionText} threshold at ${value.toFixed(2)}`;
  }
  if (rule.conditionType === "volume_spike") {
    return `${symbol} volume spike at ${value.toFixed(2)}x average volume`;
  }
  if (rule.conditionType === "price_crosses_sma") {
    return `${symbol} price/SMA spread at ${formatSignedCurrency(value)}`;
  }
  if (rule.conditionType === "percent_move") {
    const direction =
      (rule.conditionJson as { direction?: unknown }).direction === "down" ? "down" : "up";
    return `${symbol} percent move ${direction} ${Math.abs(value).toFixed(2)}%`;
  }
  if (rule.conditionType === "sma_cross") {
    const direction =
      (rule.conditionJson as { direction?: unknown }).direction === "below" ? "below" : "above";
    return `${symbol} fast SMA crossed ${direction} slow SMA at ${formatSignedCurrency(value)}`;
  }
  return `${symbol} ${rule.conditionType} at $${value.toFixed(2)}`;
}

function formatSignedCurrency(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function roundObservation(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function normalizeObservation(
  observation: AlertQuoteObservation,
  now: string,
): AlertQuoteObservation {
  return {
    ...observation,
    symbol: observation.symbol.toUpperCase(),
    observedAt: observation.observedAt || now,
    cacheStatus: observation.cacheStatus ?? "live",
  };
}

function isDue(rule: AlertRuleRecord, now: string): boolean {
  return (
    rule.nextCheckAt == null || new Date(rule.nextCheckAt).getTime() <= new Date(now).getTime()
  );
}

function isPriceRule(rule: AlertRuleRecord): boolean {
  return (
    rule.conditionType === "price_crosses_above" || rule.conditionType === "price_crosses_below"
  );
}

function allowsDelayedObservation(rule: AlertRuleRecord): boolean {
  const condition = rule.conditionJson as { allow_delayed?: unknown; allowDelayed?: unknown };
  return condition.allow_delayed !== false && condition.allowDelayed !== false;
}

function quoteObservationKey(symbol: string, delayedAllowed: boolean): string {
  return `${symbol.toUpperCase()}:${delayedAllowed ? "delayed-ok" : "fresh-only"}`;
}

function lastObservedValue(rule: AlertRuleRecord): number | null {
  const observed = rule.lastObservedJson as { value?: unknown } | null;
  return typeof observed?.value === "number" ? observed.value : null;
}

function conditionIsTrue(rule: AlertRuleRecord, current: number): boolean {
  const condition = rule.conditionJson as { threshold?: unknown };
  if (rule.conditionType === "price_crosses_above") {
    return typeof condition.threshold === "number" && current > condition.threshold;
  }
  if (rule.conditionType === "price_crosses_below") {
    return typeof condition.threshold === "number" && current < condition.threshold;
  }
  if (rule.conditionType === "price_crosses_sma") {
    const direction = (rule.conditionJson as { direction?: unknown }).direction;
    if (direction === "above") return current > 0;
    if (direction === "below") return current < 0;
  }
  if (rule.conditionType === "percent_move") {
    const percent = (rule.conditionJson as { percent?: unknown }).percent;
    if (typeof percent !== "number") return false;
    const direction = (rule.conditionJson as { direction?: unknown }).direction;
    if (direction === "up") return current > percent;
    if (direction === "down") return current < -percent;
  }
  if (rule.conditionType === "sma_cross") {
    const direction = (rule.conditionJson as { direction?: unknown }).direction;
    if (direction === "above") return current > 0;
    if (direction === "below") return current < 0;
  }
  if (rule.conditionType === "rsi_threshold") {
    if (typeof condition.threshold !== "number") return false;
    const direction = (rule.conditionJson as { direction?: unknown }).direction;
    if (direction === "above") return current > condition.threshold;
    if (direction === "below") return current < condition.threshold;
  }
  if (rule.conditionType === "volume_spike") {
    const multiplier = (rule.conditionJson as { multiplier?: unknown }).multiplier;
    return typeof multiplier === "number" && current > multiplier;
  }
  return false;
}

function crosses(rule: AlertRuleRecord, previous: number, current: number): boolean {
  const condition = rule.conditionJson as { threshold?: unknown };
  if (rule.conditionType === "price_crosses_above") {
    return (
      typeof condition.threshold === "number" &&
      previous <= condition.threshold &&
      current > condition.threshold
    );
  }
  if (rule.conditionType === "price_crosses_below") {
    return (
      typeof condition.threshold === "number" &&
      previous >= condition.threshold &&
      current < condition.threshold
    );
  }
  if (rule.conditionType === "price_crosses_sma") {
    const direction = (rule.conditionJson as { direction?: unknown }).direction;
    if (direction === "above") return previous <= 0 && current > 0;
    if (direction === "below") return previous >= 0 && current < 0;
  }
  if (rule.conditionType === "percent_move") {
    const percent = (rule.conditionJson as { percent?: unknown }).percent;
    if (typeof percent !== "number") return false;
    const direction = (rule.conditionJson as { direction?: unknown }).direction;
    if (direction === "up") return previous <= percent && current > percent;
    if (direction === "down") return previous >= -percent && current < -percent;
  }
  if (rule.conditionType === "sma_cross") {
    const direction = (rule.conditionJson as { direction?: unknown }).direction;
    if (direction === "above") return previous <= 0 && current > 0;
    if (direction === "below") return previous >= 0 && current < 0;
  }
  if (rule.conditionType === "rsi_threshold") {
    if (typeof condition.threshold !== "number") return false;
    const direction = (rule.conditionJson as { direction?: unknown }).direction;
    if (direction === "above")
      return previous <= condition.threshold && current > condition.threshold;
    if (direction === "below")
      return previous >= condition.threshold && current < condition.threshold;
  }
  if (rule.conditionType === "volume_spike") {
    const multiplier = (rule.conditionJson as { multiplier?: unknown }).multiplier;
    return typeof multiplier === "number" && previous <= multiplier && current > multiplier;
  }
  return false;
}

function outsideCooldown(rule: AlertRuleRecord, now: string): boolean {
  if (rule.lastTriggeredAt == null || rule.cooldownSeconds == null) return true;
  return (
    new Date(now).getTime() - new Date(rule.lastTriggeredAt).getTime() >=
    rule.cooldownSeconds * 1000
  );
}

function alertDedupeKey(
  rule: AlertRuleRecord,
  observation: AlertQuoteObservation,
  triggerType: string,
): string {
  const bucket = observation.observedAt.slice(0, 16);
  return [
    "alert",
    rule.id,
    rule.ruleRevision,
    rule.armCycleId,
    triggerType,
    bucket,
    observation.value,
  ].join(":");
}
