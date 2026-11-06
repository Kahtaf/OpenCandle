import { describe, expect, it } from "vitest";
import { resolveFx } from "../../../src/portfolio/fx.js";
import { valuePortfolio } from "../../../src/portfolio/valuation.js";

const now = Date.parse("2026-11-06T12:00:00Z");
const lot = { id: "a", symbol: "ACME", quantity: 2, avgCost: 8, costCurrency: "EUR" };
const quote = { price: 10, currency: "EUR", observedAt: now, eligible: true };
const fx = resolveFx(
  "EUR",
  "USD",
  {
    provider: "yahoo",
    requestedSymbol: "EURUSD=X",
    returnedSymbol: "EURUSD=X",
    rawUnit: "USD",
    source: "EUR",
    target: "USD",
    rate: 1.25,
    observedAt: now,
    fetchedAt: now,
    cacheStatus: "fresh",
    marketState: "REGULAR",
  },
  now,
);
const run = (lots = [lot], quotes = { ACME: quote }, reportingCurrency = "USD") =>
  valuePortfolio({ lots, quotes, reportingCurrency, rates: [fx], now });
describe("indicative portfolio valuation without historical FX", () => {
  it("separates foreign native P&L from unavailable reporting cost", () => {
    const result = run();
    expect(result.status).toBe("complete");
    expect(result.totalValue).toEqual({ amount: 25, currency: "USD" });
    expect(result.totalCost).toBeNull();
    expect(result.totalPnl).toBeNull();
    expect(result.rows[0]).toMatchObject({
      nativePnl: { amount: 4, currency: "EUR" },
      reportingCost: null,
      reportingPnl: null,
    });
  });
  it("values independently of cost currency, using only explicitly known reporting cost", () => {
    const result = run([{ ...lot, costCurrency: "USD" }]);
    expect(result.totalPnl).toEqual({ amount: 9, currency: "USD" });
    expect(result.rows[0]?.nativePnl).toBeNull();
  });
  it("recomputes without mutating lots and supports same-currency CAD", () => {
    const before = JSON.stringify(lot);
    expect(run(undefined, undefined, "EUR").totalPnl).toEqual({ amount: 4, currency: "EUR" });
    expect(JSON.stringify(lot)).toBe(before);
    expect(
      run([{ ...lot, costCurrency: "CAD" }], { ACME: { ...quote, currency: "CAD" } }, "CAD")
        .totalValue?.amount,
    ).toBe(20);
  });
  it("distinguishes partial totals and allocations from portfolio totals", () => {
    const result = run([lot, { ...lot, id: "b", symbol: "MISSING" }]);
    expect(result).toMatchObject({
      status: "partial",
      totalValue: null,
      valuedSubtotal: { amount: 25 },
      totalCost: null,
      totalPnl: null,
      includedLotIds: ["a"],
      excludedLotIds: ["b"],
    });
    expect(result.rows[0]).toMatchObject({ allocationPercent: null, valuedAllocationPercent: 100 });
    expect(run([], {}).totalValue?.amount).toBe(0);
    expect(run([lot], {})).toMatchObject({
      status: "unavailable",
      totalValue: null,
      valuedSubtotal: null,
    });
  });
  it("does not rescue rejected quotes with FX and rejects arithmetic overflow", () => {
    expect(run([lot], { ACME: { ...quote, eligible: false } }).status).toBe("unavailable");
    expect(run([{ ...lot, quantity: Number.MAX_VALUE }]).status).toBe("unavailable");
    expect(run([{ ...lot, quantity: 0 }]).rows[0]?.allocationPercent).toBeNull();
  });
  it("revalidates FX against the snapshot clock and preserves its provenance", () => {
    const result = run();
    expect(result.rows[0]?.fx).toEqual(fx);
    expect(
      valuePortfolio({
        lots: [lot],
        quotes: { ACME: quote },
        reportingCurrency: "USD",
        rates: [fx],
        now: now + 900001,
      }).status,
    ).toBe("unavailable");
  });
  it("reports unavailable aggregate arithmetic rather than complete overflow", () => {
    const result = run([
      { ...lot, quantity: 1e307 },
      { ...lot, id: "b", quantity: 1e307 },
    ]);
    expect(result.status).toBe("unavailable");
    expect(result.totalValue).toBeNull();
    expect(result.aggregateReason).toBe("invalid_aggregate");
  });
  it("groups cost by currency and leaves missing quote units unavailable", () => {
    const result = run([lot, { ...lot, id: "b", costCurrency: "USD" }]);
    expect(result.costSubtotals).toEqual([
      { amount: 16, currency: "EUR" },
      { amount: 16, currency: "USD" },
    ]);
    expect(run([lot], { ACME: { ...quote, currency: "" } }).rows[0]?.reason).toBe(
      "missing_quote_currency",
    );
  });
});

it("retains unavailable FX source diagnostics for the requested pair", () => {
  const result = valuePortfolio({
    lots: [lot],
    quotes: { ACME: quote },
    reportingCurrency: "USD",
    now,
    rates: [
      { status: "unavailable", source: "EUR", target: "USD", reason: "provider_rate_limited" },
    ],
  });
  expect(result.rows[0]?.reason).toBe("provider_rate_limited");
});
