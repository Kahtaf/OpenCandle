import { describe, expect, it, vi } from "vitest";
import {
  acquirePortfolioValuation,
  securityFromProvider,
  securityFromSnapshot,
} from "../../../src/portfolio/acquisition.js";
import { resolveFx } from "../../../src/portfolio/fx.js";

const now = Date.parse("2026-11-09T12:00:00Z"); // Monday premarket: Friday security close is eligible.
const asOf = "2026-11-06T21:00:00Z";
const lots = [
  { id: "a", symbol: "EU", quantity: 2, avgCost: 8, costCurrency: "EUR" },
  { id: "b", symbol: "US", quantity: 1, avgCost: 5, costCurrency: "USD" },
];
const leg = {
  provider: "yahoo",
  requestedSymbol: "EURUSD=X",
  returnedSymbol: "EURUSD=X",
  rawUnit: "USD",
  source: "EUR",
  target: "USD",
  rate: 1.25,
  observedAt: now,
  fetchedAt: now,
  cacheStatus: "fresh" as const,
  marketState: "REGULAR",
};
const observation = (symbol: string) => ({
  status: "ok" as const,
  price: 10,
  currency: symbol === "EU" ? "EUR" : "USD",
  asOf,
  fetchedAt: new Date(now).toISOString(),
  cached: true,
});

describe("shared acquisition contract for tracker/local/hosted consumers", () => {
  it("maps provider and GUI observations identically without resetting security time", async () => {
    const provider = (symbol: string) =>
      securityFromProvider({
        status: "ok",
        data: { ...observation(symbol) },
        timestamp: new Date(now).toISOString(),
        cached: true,
      });
    const snapshot = (symbol: string) =>
      securityFromSnapshot({ ...observation(symbol), dataAsOf: asOf });
    const run = (resolveSecurity: typeof provider) =>
      acquirePortfolioValuation({
        lots,
        reportingCurrency: "USD",
        now,
        resolveSecurity,
        resolveFx: (source, target) => resolveFx(source, target, leg, now),
      });
    const result = await run(provider);
    expect(await run(snapshot)).toEqual(result);
    expect(result.valuation).toMatchObject({
      status: "complete",
      totalValue: { amount: 35, currency: "USD" },
      totalCost: null,
      totalPnl: null,
    });
    expect(result.valuation.rows[0]?.securityObservedAt).toBe(Date.parse(asOf));
    expect(result.securities.EU?.freshness?.isStaleForSession).toBe(false);
  });
  it("preserves pair-specific unavailable FX reasons and partial accounting", async () => {
    const result = await acquirePortfolioValuation({
      lots,
      reportingCurrency: "USD",
      now,
      resolveSecurity: observation,
      resolveFx: (source, target) => ({
        status: "unavailable",
        source,
        target,
        reason: "provider_rate_limited",
      }),
    });
    expect(result.valuation).toMatchObject({
      status: "partial",
      totalValue: null,
      valuedSubtotal: { amount: 10 },
      totalPnl: null,
      excludedLotIds: ["a"],
    });
    expect(result.valuation.rows[0]).toMatchObject({
      reason: "provider_rate_limited",
      fx: { status: "unavailable", source: "EUR", target: "USD", reason: "provider_rate_limited" },
    });
    expect(result.valuation.rows[1]?.valuedAllocationPercent).toBe(100);
  });
  it.each([
    [{ ...observation("EU"), stale: true }, "stale_security_cache"],
    [{ ...observation("EU"), asOf: "2026-11-05T21:00:00Z" }, "stale_security_observation"],
    [{ ...observation("EU"), asOf: undefined }, "missing_security_timestamp"],
    [
      { status: "unavailable" as const, reason: "security_source_offline" },
      "security_source_offline",
    ],
  ])("does not let fresh FX rescue rejected security data (%s)", async (security, reason) => {
    const fx = vi.fn();
    const result = await acquirePortfolioValuation({
      lots: [lots[0]!],
      reportingCurrency: "USD",
      now,
      resolveSecurity: () => security,
      resolveFx: fx,
    });
    expect(result.valuation).toMatchObject({
      status: "unavailable",
      totalValue: null,
      valuedSubtotal: null,
    });
    expect(result.valuation.rows[0]?.reason).toBe(reason);
    expect(fx).not.toHaveBeenCalled();
  });
  it("deduplicates securities and FX pairs across repeated lots", async () => {
    const security = vi.fn(observation);
    const fx = vi.fn((source: string, target: string) => resolveFx(source, target, leg, now));
    await acquirePortfolioValuation({
      lots: [lots[0]!, { ...lots[0]!, id: "repeat" }],
      reportingCurrency: "USD",
      now,
      resolveSecurity: security,
      resolveFx: fx,
    });
    expect(security).toHaveBeenCalledTimes(1);
    expect(fx).toHaveBeenCalledTimes(1);
  });
  it("keeps equity session eligibility separate from FX age", async () => {
    const result = await acquirePortfolioValuation({
      lots: [lots[0]!],
      reportingCurrency: "USD",
      now,
      resolveSecurity: observation,
      resolveFx: (source, target) =>
        resolveFx(source, target, { ...leg, observedAt: Date.parse(asOf) }, now),
    });
    expect(result.securities.EU?.eligible).toBe(true);
    expect(result.valuation.rows[0]?.reason).toBe("stale_fx_observation");
  });
});

it("retains unavailable provider identity through security mapping", async () => {
  const source = {
    status: "unavailable" as const,
    reason: "provider_circuit_open",
    provider: "yahoo",
  };
  const result = await acquirePortfolioValuation({
    lots,
    reportingCurrency: "USD",
    now,
    resolveSecurity: () => securityFromProvider(source),
    resolveFx: vi.fn(),
  });
  expect(result.securities.EU?.observation).toEqual(source);
});
