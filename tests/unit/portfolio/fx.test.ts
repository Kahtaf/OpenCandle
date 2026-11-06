import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithAbortSignal } from "../../../src/infra/abort-context.js";
import { cache } from "../../../src/infra/cache.js";
import { resolveFx } from "../../../src/portfolio/fx.js";
import { createFxResolver } from "../../../src/providers/yahoo-fx.js";
import fixture from "../../fixtures/yahoo/EURUSD-fx.json";
import gbpFixture from "../../fixtures/yahoo/GBPUSD-fx.json";

const now = 1793966400000;
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
describe("bounded USD/EUR FX observations", () => {
  beforeEach(() => cache.clear());
  afterEach(() => vi.unstubAllGlobals());
  it("uses identity, direct and reciprocal orientation with provenance", () => {
    expect(resolveFx("CAD", "CAD", null, now)).toMatchObject({
      status: "ok",
      rate: 1,
      method: "identity",
      legs: [],
    });
    expect(resolveFx("EUR", "USD", leg, now)).toMatchObject({
      status: "ok",
      rate: 1.25,
      method: "direct",
      legs: [leg],
    });
    expect(resolveFx("USD", "EUR", leg, now)).toMatchObject({
      status: "ok",
      rate: 0.8,
      method: "inverse",
    });
    expect(resolveFx("GBP", "USD", leg, now).status).toBe("unavailable");
  });
  it.each([
    { rate: 0 },
    { rate: -1 },
    { rate: Infinity },
    { rate: NaN },
    { rate: Number.MIN_VALUE },
    { returnedSymbol: "EUR=X" },
    { rawUnit: "EUR" },
    { source: "USD" },
    { observedAt: NaN },
    { observedAt: now + 60001 },
    { observedAt: now - 900001 },
    { cacheStatus: "stale" },
    { fetchedAt: NaN },
  ])("rejects invalid metadata or freshness %j", (change) => {
    expect(resolveFx("USD", "EUR", { ...leg, ...change } as typeof leg, now).status).toBe(
      "unavailable",
    );
  });
  it("uses inclusive age/skew limits and only explicit CLOSED for last session", () => {
    for (const observedAt of [now - 900000, now + 60000])
      expect(resolveFx("EUR", "USD", { ...leg, observedAt }, now).status).toBe("ok");
    expect(
      resolveFx(
        "EUR",
        "USD",
        { ...leg, marketState: "CLOSED", observedAt: now - 72 * 3600000 },
        now,
      ),
    ).toMatchObject({ status: "ok", lastSession: true });
    expect(
      resolveFx(
        "EUR",
        "USD",
        { ...leg, marketState: "CLOSED", observedAt: now - 72 * 3600000 - 1 },
        now,
      ).status,
    ).toBe("unavailable");
  });
  it("single-flights canonical observations across snapshots, preserves TTL observation time", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture)));
    vi.stubGlobal("fetch", fetch);
    const first = createFxResolver(now);
    const second = createFxResolver(now);
    const results = await Promise.all([
      first("EUR", "USD"),
      first("USD", "EUR"),
      second("EUR", "USD"),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(results.map((result) => (result.status === "ok" ? result.rate : null))).toEqual([
      1.25, 0.8, 1.25,
    ]);
    expect(await createFxResolver(now)("EUR", "USD")).toMatchObject({
      status: "ok",
      legs: [{ cacheStatus: "cached", observedAt: now }],
    });
  });
  it("memoizes failures only for the snapshot and never cascades after 429", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fetch);
    const resolver = createFxResolver(now);
    expect((await resolver("EUR", "USD")).status).toBe("unavailable");
    expect((await resolver("USD", "EUR")).status).toBe("unavailable");
    expect(fetch).toHaveBeenCalledTimes(1);
    await createFxResolver(now)("EUR", "USD");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not persist malformed provider observations in the TTL cache", async () => {
    const malformed = structuredClone(fixture);
    malformed.chart.result[0]!.meta.currency = "EUR";
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(malformed)));
    vi.stubGlobal("fetch", fetch);
    expect((await createFxResolver(now)("EUR", "USD")).status).toBe("unavailable");
    await createFxResolver(now)("EUR", "USD");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("cancels one subscriber without poisoning another shared request", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const controller = new AbortController();
    const first = runWithAbortSignal(controller.signal, () => createFxResolver(now)("EUR", "USD"));
    const rejected = expect(first).rejects.toThrow("cancelled");
    const second = createFxResolver(now)("USD", "EUR");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    controller.abort(new Error("cancelled"));
    finish(new Response(JSON.stringify(fixture)));
    await rejected;
    expect(await second).toMatchObject({ status: "ok", rate: 0.8 });
  });
  it("retains domestic holdings when the shared FX acquisition deadline expires", async () => {
    const { buildPortfolioView } = await import("../../../src/tools/portfolio/portfolio-view.js");
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    let started!: () => void;
    const fetching = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = options.signal!;
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            started();
          }),
      ),
    );
    try {
      const result = buildPortfolioView(
        ["EUR", "USD"].map((currency, index) => ({
          id: index + 1,
          portfolioId: 1,
          instrumentId: index + 1,
          symbol: currency,
          assetType: "equity",
          quantity: 2,
          avgCost: 8,
          currency,
          createdAt: "2026-01-01",
        })),
        "USD",
        async (currency) => ({
          status: "ok",
          price: 10,
          currency,
          asOf: new Date(now).toISOString(),
          fetchedAt: new Date(now).toISOString(),
        }),
        { now: () => now },
      );
      const retained = expect(result).resolves.toMatchObject({
        totalsStatus: "partial",
        totalValue: null,
        valuedSubtotal: 20,
        positions: [
          {
            includedInTotals: false,
            fx: { status: "unavailable", provider: "yahoo", reason: "fx_timeout" },
          },
          { includedInTotals: true, marketValue: 20 },
        ],
      });
      await fetching;
      deadline.abort(new DOMException("The operation timed out", "TimeoutError"));
      await retained;
    } finally {
      timeout.mockRestore();
    }
  });
  it("makes no requests for identity or unsupported pairs", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await createFxResolver(now)("USD", "USD");
    await createFxResolver(now)("CAD", "EUR");
    expect(fetch).not.toHaveBeenCalled();
  });
});

it("carries Yahoo failure provenance through acquisition into excluded valuation rows", async () => {
  cache.clear();
  const fetch = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
  vi.stubGlobal("fetch", fetch);
  try {
    const { acquirePortfolioValuation } = await import("../../../src/portfolio/acquisition.js");
    const result = await acquirePortfolioValuation({
      lots: [{ id: "a", symbol: "EU", quantity: 2, avgCost: 8, costCurrency: "EUR" }],
      reportingCurrency: "USD",
      now,
      resolveSecurity: () => ({
        status: "ok",
        price: 10,
        currency: "EUR",
        asOf: new Date(now).toISOString(),
        fetchedAt: new Date(now).toISOString(),
      }),
      resolveFx: createFxResolver(now),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.valuation.rows[0]?.fx).toMatchObject({
      status: "unavailable",
      provider: "yahoo",
      source: "EUR",
      target: "USD",
    });
    expect(result.valuation.rows[0]?.reason).toContain("429");
    expect(result.valuation).toMatchObject({
      status: "unavailable",
      totalValue: null,
      totalPnl: null,
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

const gbpLeg = {
  ...leg,
  source: "GBP",
  requestedSymbol: "GBPUSD=X",
  returnedSymbol: "GBPUSD=X",
  rate: 2,
};
it("resolves pounds, reciprocal and USD crosses with both observation legs", () => {
  expect(resolveFx("GBP", "USD", gbpLeg, now)).toMatchObject({ status: "ok", rate: 2 });
  expect(resolveFx("USD", "GBP", gbpLeg, now)).toMatchObject({ status: "ok", rate: 0.5 });
  expect(resolveFx("EUR", "GBP", [leg, gbpLeg], now)).toMatchObject({
    status: "ok",
    rate: 0.625,
    method: "usd_cross",
    legs: [leg, gbpLeg],
  });
  expect(resolveFx("GBP", "EUR", [leg, gbpLeg], now)).toMatchObject({ status: "ok", rate: 1.6 });
});
it("rejects cross-session mismatch and cross timestamps beyond five minutes", () => {
  expect(resolveFx("EUR", "GBP", [leg, { ...gbpLeg, observedAt: now - 300000 }], now).status).toBe(
    "ok",
  );
  expect(
    resolveFx("EUR", "GBP", [leg, { ...gbpLeg, observedAt: now - 300001 }], now),
  ).toMatchObject({ status: "unavailable", reason: "inconsistent_fx_times" });
  expect(resolveFx("EUR", "GBP", [leg, { ...gbpLeg, marketState: "CLOSED" }], now)).toMatchObject({
    status: "unavailable",
    reason: "inconsistent_fx_sessions",
  });
});

it("acquires only two canonical legs for simultaneous three-currency requests", async () => {
  cache.clear();
  const fetch = vi.fn(
    async (url: string) =>
      new Response(JSON.stringify(String(url).includes("GBPUSD") ? gbpFixture : fixture)),
  );
  vi.stubGlobal("fetch", fetch);
  try {
    const resolver = createFxResolver(now);
    const results = await Promise.all([
      resolver("EUR", "GBP"),
      resolver("GBP", "EUR"),
      resolver("GBP", "USD"),
    ]);
    expect(results.map((r) => (r.status === "ok" ? r.rate : null))).toEqual([0.625, 1.6, 2]);
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});
