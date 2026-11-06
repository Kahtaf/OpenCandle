import { buildFreshnessStamp, type FreshnessStamp } from "../infra/freshness.js";
import { normalizeCurrencyUnit } from "./currency-unit.js";
import { type FxResult, resolveFx } from "./fx.js";
import { type ValuationLot, type ValuationQuote, valuePortfolio } from "./valuation.js";

/** Raw price units must be preserved by the caller; never infer units from saved costs. */
export type SecurityObservation =
  | {
      status: "unavailable";
      reason: string;
      provider?: string;
      asOf?: string;
      fetchedAt?: string;
      dataAsOf?: string;
    }
  | {
      status: "ok";
      price: number;
      currency: string | null;
      asOf?: string;
      fetchedAt: string;
      cached?: boolean;
      stale?: boolean;
    };

export interface EligibleSecurity extends ValuationQuote {
  reason: string | null;
  freshness: FreshnessStamp | null;
  fetchedAt: string | null;
  observation: SecurityObservation;
}

/** Structural mapping for tracker/provider results, before provenance is discarded. */
export function securityFromProvider(
  result:
    | {
        status: "unavailable";
        reason: string;
        provider?: string;
        asOf?: string;
        fetchedAt?: string;
        dataAsOf?: string;
      }
    | {
        status: "ok";
        data: { price: number; currency?: string | null; asOf?: string };
        timestamp: string;
        cached?: boolean;
        stale?: boolean;
      },
): SecurityObservation {
  if (result.status === "unavailable") return { ...result, asOf: result.asOf ?? result.dataAsOf };
  return {
    status: "ok",
    price: result.data.price,
    currency: result.data.currency ?? null,
    asOf: result.data.asOf,
    fetchedAt: result.timestamp,
    cached: result.cached,
    stale: result.stale,
  };
}

/** Structural mapping for local/hosted snapshots. Fetch time is never observation time. */
export function securityFromSnapshot(
  result:
    | {
        status: "unavailable";
        reason: string;
        provider?: string;
        asOf?: string;
        fetchedAt?: string;
        dataAsOf?: string;
      }
    | {
        status: "ok";
        price: number;
        currency: string | null;
        dataAsOf?: string;
        fetchedAt: string;
        cached?: boolean;
        stale?: boolean;
      },
): SecurityObservation {
  if (result.status === "unavailable") return { ...result, asOf: result.asOf ?? result.dataAsOf };
  return {
    status: "ok",
    price: result.price,
    currency: result.currency,
    asOf: result.dataAsOf,
    fetchedAt: result.fetchedAt,
    cached: result.cached,
    stale: result.stale,
  };
}

export function assessSecurity(observation: SecurityObservation, now: number): EligibleSecurity {
  if (observation.status === "unavailable")
    return {
      price: NaN,
      currency: "",
      observedAt:
        observation.asOf && Number.isFinite(Date.parse(observation.asOf))
          ? Date.parse(observation.asOf)
          : null,
      fetchedAt: observation.fetchedAt ?? null,
      eligible: false,
      reason: observation.reason,
      freshness: null,
      observation,
    };
  const freshness = buildFreshnessStamp({
    asOf: observation.asOf,
    cached: observation.cached,
    stale: observation.stale,
    cachedAt: observation.fetchedAt,
    now: new Date(now),
  });
  const observedAt = freshness.providerDataAt ? Date.parse(freshness.providerDataAt) : null;
  const reason = observation.stale
    ? "stale_security_cache"
    : observedAt === null
      ? "missing_security_timestamp"
      : freshness.isStaleForSession
        ? "stale_security_observation"
        : !Number.isFinite(observation.price) || observation.price <= 0
          ? "invalid_security_price"
          : !normalizeCurrencyUnit(observation.currency)
            ? "missing_quote_currency"
            : null;
  return {
    price: observation.price,
    currency: observation.currency ?? "",
    observedAt,
    fetchedAt: observation.fetchedAt,
    eligible: reason === null,
    reason,
    freshness,
    observation,
  };
}

type MaybePromise<T> = T | Promise<T>;

/**
 * Shared integration boundary. Callers supply explicit cost units.
 * Resolvers return typed unavailable results; unexpected errors/cancellation propagate.
 */
export async function acquirePortfolioValuation(input: {
  lots: readonly ValuationLot[];
  reportingCurrency: string;
  now: number;
  resolveSecurity: (symbol: string) => MaybePromise<SecurityObservation>;
  resolveFx: (source: string, target: string) => MaybePromise<FxResult>;
}) {
  if (!Number.isFinite(input.now)) throw new RangeError("invalid_clock");
  const securities: Record<string, EligibleSecurity> = Object.create(null);
  await Promise.all(
    [...new Set(input.lots.map((lot) => lot.symbol))].map(async (symbol) => {
      securities[symbol] = assessSecurity(await input.resolveSecurity(symbol), input.now);
    }),
  );
  const currencies = new Set(
    Object.values(securities)
      .filter((quote) => quote.eligible)
      .map((quote) => normalizeCurrencyUnit(quote.currency)!.currency),
  );
  const rates = await Promise.all(
    [...currencies].map(async (source): Promise<FxResult> => {
      const preliminary = resolveFx(source, input.reportingCurrency, null, input.now);
      if (preliminary.status === "ok" || preliminary.reason !== "missing_fx") return preliminary;
      const result = await input.resolveFx(source, input.reportingCurrency);
      if (result.source !== source || result.target !== input.reportingCurrency)
        return {
          status: "unavailable",
          source,
          target: input.reportingCurrency,
          reason: "invalid_fx_pair",
        };
      return result;
    }),
  );
  return { securities, valuation: valuePortfolio({ ...input, quotes: securities, rates }) };
}
