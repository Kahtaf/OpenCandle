import { canUseTradingViewQuote } from "../providers/tradingview.js";
import { getQuotes } from "../providers/tradingview.js";
import { getHistory, getQuote } from "../providers/yahoo-finance.js";
import { wrapProvider } from "../providers/wrap-provider.js";
import type { OHLCV } from "../types/market.js";
import { isZeroFilledQuote } from "./resolve.js";
import type { AlertRuleRecord, InstrumentRecord, MarketStateService } from "./service.js";
import { ALERT_CONDITION_VERSION } from "./alert-conditions.js";
import { computeRSI, computeSMA } from "../tools/technical/indicators.js";

export interface AlertQuoteObservation {
  symbol: string;
  value: number;
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
}

export interface AlertRunnerResult {
  checked: number;
  triggered: number;
  unavailable: number;
  runId: number;
  lines: string[];
}

export const defaultAlertRunnerProviders: AlertRunnerProviders = {
  async getTradingViewQuotes(symbols) {
    const result = await wrapProvider("tradingview", () => getQuotes(symbols));
    if (result.status === "unavailable") throw new Error(result.reason);
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
  const run = service.startAlertCheckRun({
    ownerId: options.ownerId,
    triggerType: options.triggerType,
    startedAt: now,
  });

  let triggered = 0;
  let unavailable = 0;
  const lines: string[] = [];

  try {
    const rules = service.listAlertRules().filter((rule) =>
      rule.enabled &&
      rule.status === "active" &&
      isDue(rule, now)
    );
    const runnable = rules.flatMap((rule): RunnableRule[] => {
      if (rule.conditionVersion !== ALERT_CONDITION_VERSION) {
        unavailable++;
        lines.push(`#${rule.id}: needs review (unsupported condition version ${rule.conditionVersion})`);
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

    const priceRules = runnable.filter(({ rule }) =>
      rule.conditionType === "price_crosses_above" || rule.conditionType === "price_crosses_below"
    );
    const quoteObservations = await loadPriceObservations(priceRules, options.providers, now);

    for (const item of runnable) {
      const observation = isPriceRule(item.rule)
        ? quoteObservations.observations.get(item.instrument.symbol)
        : await loadHistoricalObservation(item, options.providers, now);
      if (!observation) {
        const reason = quoteObservations.unavailableReasons.get(item.instrument.symbol) ??
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
        field: "last_price",
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
            message: `${item.instrument.symbol} ${item.rule.conditionType} at $${observation.value.toFixed(2)}`,
            triggeredAt: now,
            observedAt: now,
            providerDataAt: observation.providerDataAt ?? null,
            sourceProvider: observation.sourceProvider,
            cacheStatus: observation.cacheStatus,
            dataDelayMs: observation.dataDelayMs ?? null,
            triggerSource: options.triggerType,
            dedupeKey: alertDedupeKey(item.rule, observation, options.triggerType),
          }
          : undefined,
      });

      if (result.triggered) {
        triggered++;
        lines.push(`TRIGGERED: ${item.instrument.symbol}`);
      } else {
        lines.push(`${item.instrument.symbol}: ${previous == null ? "seeded" : "checked"}`);
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
  now: string,
): Promise<ObservationSet> {
  const symbols = [...new Set(rules.map(({ instrument }) => instrument.symbol))].sort();
  const tradingViewSymbols = symbols.filter(canUseTradingViewQuote);
  const yahooSymbols = new Set(symbols.filter((symbol) => !canUseTradingViewQuote(symbol)));
  const observations = new Map<string, AlertQuoteObservation>();
  const unavailableReasons = new Map<string, string>();

  if (tradingViewSymbols.length > 0) {
    try {
      for (const quote of await providers.getTradingViewQuotes(tradingViewSymbols)) {
        observations.set(quote.symbol.toUpperCase(), normalizeObservation(quote, now));
      }
    } catch (error) {
      for (const symbol of tradingViewSymbols) {
        yahooSymbols.add(symbol);
        unavailableReasons.set(symbol, error instanceof Error ? error.message : "TradingView unavailable");
      }
    }
  }

  for (const symbol of tradingViewSymbols) {
    if (!observations.has(symbol.toUpperCase())) yahooSymbols.add(symbol);
  }

  for (const symbol of yahooSymbols) {
    try {
      const quote = await providers.getYahooQuote(symbol);
      observations.set(symbol.toUpperCase(), normalizeObservation(quote, now));
      unavailableReasons.delete(symbol);
    } catch (error) {
      unavailableReasons.set(symbol, error instanceof Error ? error.message : "Yahoo unavailable");
    }
  }

  return { observations, unavailableReasons };
}

async function loadHistoricalObservation(
  item: RunnableRule,
  providers: AlertRunnerProviders,
  now: string,
): Promise<AlertQuoteObservation | null> {
  try {
    if (item.rule.conditionType === "price_crosses_sma") {
      const condition = item.rule.conditionJson as { period?: unknown };
      const period = typeof condition.period === "number" ? condition.period : 50;
      const bars = await providers.getHistory(item.instrument.symbol, "1y", "1d");
      const closes = bars.map((bar) => bar.close);
      const sma = computeSMA(closes, period);
      const latestClose = closes.at(-1);
      const latestSma = sma.at(-1);
      if (latestClose == null || latestSma == null) return null;
      return historicalObservation(item.instrument.symbol, latestClose - latestSma, bars.at(-1)?.date ?? null, now);
    }

    if (item.rule.conditionType === "rsi_threshold") {
      const condition = item.rule.conditionJson as { period?: unknown };
      const period = typeof condition.period === "number" ? condition.period : 14;
      const bars = await providers.getHistory(item.instrument.symbol, "6mo", "1d");
      const rsi = computeRSI(bars.map((bar) => bar.close), period);
      const latestRsi = rsi.at(-1);
      if (latestRsi == null) return null;
      return historicalObservation(item.instrument.symbol, latestRsi, bars.at(-1)?.date ?? null, now);
    }

    if (item.rule.conditionType === "volume_spike") {
      const condition = item.rule.conditionJson as { lookback_period?: unknown };
      const period = typeof condition.lookback_period === "number" ? condition.lookback_period : 20;
      const bars = await providers.getHistory(item.instrument.symbol, "6mo", "1d");
      const latest = bars.at(-1);
      const prior = bars.slice(Math.max(0, bars.length - 1 - period), bars.length - 1);
      if (latest == null || prior.length < period) return null;
      const averageVolume = prior.reduce((sum, bar) => sum + bar.volume, 0) / prior.length;
      if (averageVolume <= 0) return null;
      return historicalObservation(item.instrument.symbol, latest.volume / averageVolume, latest.date, now);
    }
  } catch {
    return null;
  }
  return null;
}

function historicalObservation(
  symbol: string,
  value: number,
  providerDataAt: string | null,
  now: string,
): AlertQuoteObservation {
  return {
    symbol,
    value,
    sourceProvider: "yahoo",
    observedAt: now,
    providerDataAt,
    cacheStatus: "live",
  };
}

function normalizeObservation(observation: AlertQuoteObservation, now: string): AlertQuoteObservation {
  return {
    ...observation,
    symbol: observation.symbol.toUpperCase(),
    observedAt: observation.observedAt || now,
    cacheStatus: observation.cacheStatus ?? "live",
  };
}

function isDue(rule: AlertRuleRecord, now: string): boolean {
  return rule.nextCheckAt == null || new Date(rule.nextCheckAt).getTime() <= new Date(now).getTime();
}

function isPriceRule(rule: AlertRuleRecord): boolean {
  return rule.conditionType === "price_crosses_above" || rule.conditionType === "price_crosses_below";
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
    return typeof condition.threshold === "number" && previous <= condition.threshold && current > condition.threshold;
  }
  if (rule.conditionType === "price_crosses_below") {
    return typeof condition.threshold === "number" && previous >= condition.threshold && current < condition.threshold;
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
    return typeof multiplier === "number" && previous <= multiplier && current > multiplier;
  }
  return false;
}

function outsideCooldown(rule: AlertRuleRecord, now: string): boolean {
  if (rule.lastTriggeredAt == null || rule.cooldownSeconds == null) return true;
  return new Date(now).getTime() - new Date(rule.lastTriggeredAt).getTime() >= rule.cooldownSeconds * 1000;
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
