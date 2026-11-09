import { normalizeCurrencyUnit } from "./currency-unit.js";

export interface FxLeg {
  provider: string;
  requestedSymbol: string;
  returnedSymbol: string;
  rawUnit: string;
  source: string;
  target: string;
  rate: number;
  observedAt: number;
  fetchedAt: number;
  cacheStatus: "fresh" | "cached" | "stale";
  marketState: string | null;
}
export type FxResult =
  | { status: "unavailable"; source: string; target: string; provider?: string; reason: string }
  | {
      status: "ok";
      source: string;
      target: string;
      rate: number;
      method: "identity" | "direct" | "inverse" | "usd_cross";
      legs: readonly FxLeg[];
      observedAt: number | null;
      lastSession: boolean;
    };

/** Canonical USD legs, with conservative observation eligibility. */
export function resolveFx(
  source: string,
  target: string,
  observations: FxLeg | readonly FxLeg[] | null,
  now: number,
): FxResult {
  const unavailable = (reason: string): FxResult => ({
    status: "unavailable",
    source,
    target,
    reason,
  });
  if (!Number.isFinite(now)) return unavailable("invalid_clock");
  if (source === target && normalizeCurrencyUnit(source)?.scale === 1) {
    return {
      status: "ok",
      source,
      target,
      rate: 1,
      method: "identity",
      legs: [],
      observedAt: null,
      lastSession: false,
    };
  }
  if (!["USD", "EUR", "GBP"].includes(source) || !["USD", "EUR", "GBP"].includes(target))
    return unavailable("unsupported_currency");
  const supplied =
    observations === null
      ? []
      : Array.isArray(observations)
        ? observations
        : [observations as FxLeg];
  const required = [source, target].filter((currency) => currency !== "USD");
  const legs: FxLeg[] = [];
  for (const currency of required) {
    const leg = supplied.find((item) => item.source === currency);
    if (!leg) return unavailable("missing_fx");
    const symbol = `${currency}USD=X`;
    if (
      leg.provider !== "yahoo" ||
      leg.requestedSymbol !== symbol ||
      leg.returnedSymbol !== symbol ||
      leg.rawUnit !== "USD" ||
      leg.target !== "USD"
    )
      return unavailable("invalid_fx_metadata");
    if (!Number.isFinite(leg.rate) || leg.rate <= 0) return unavailable("invalid_fx_rate");
    if (leg.cacheStatus === "stale") return unavailable("stale_fx_cache");
    if (!Number.isFinite(leg.observedAt) || !Number.isFinite(leg.fetchedAt))
      return unavailable("missing_fx_timestamp");
    const maxAge = leg.marketState === "CLOSED" ? 72 * 3600000 : 15 * 60000;
    if (leg.observedAt - now > 60000 || now - leg.observedAt > maxAge)
      return unavailable("stale_fx_observation");
    legs.push(leg);
  }
  if (legs.length === 2) {
    if (Math.abs(legs[0]!.observedAt - legs[1]!.observedAt) > 300000)
      return unavailable("inconsistent_fx_times");
    if ((legs[0]!.marketState === "CLOSED") !== (legs[1]!.marketState === "CLOSED"))
      return unavailable("inconsistent_fx_sessions");
  }
  const usdRate = (currency: string) =>
    currency === "USD" ? 1 : legs.find((leg) => leg.source === currency)!.rate;
  const rate = usdRate(source) / usdRate(target);
  if (!Number.isFinite(rate) || rate <= 0) return unavailable("invalid_fx_rate");
  return {
    status: "ok",
    source,
    target,
    rate,
    method: legs.length === 2 ? "usd_cross" : source === "USD" ? "inverse" : "direct",
    legs,
    observedAt: Math.min(...legs.map((leg) => leg.observedAt)),
    lastSession: legs.every((leg) => leg.marketState === "CLOSED"),
  };
}
