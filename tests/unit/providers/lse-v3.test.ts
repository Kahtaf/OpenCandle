import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithAbortSignal } from "../../../src/infra/abort-context.js";
import { cache, TTL } from "../../../src/infra/cache.js";
import {
  getUsage,
  isOverSoftThreshold,
  markExhausted,
} from "../../../src/infra/lse-byte-budget.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import {
  getLseCandles,
  getLseFinancialReports,
  getLseFinancials,
  getLseUsage,
} from "../../../src/providers/lse.js";
import { ProviderCredentialError } from "../../../src/providers/provider-credential-error.js";
import liveCandles from "../../fixtures/lse/v3-candles-AAPL-1d.json";
import meteredCandles from "../../fixtures/lse/v3-candles-AAPL-metered.json";
import liveReports from "../../fixtures/lse/v3-financial-reports-AAPL.json";
import { lseCsvResponse, withLseUsage } from "../../support/lse.js";

vi.mock("../../../src/config.js", () => ({ getConfig: () => ({ lseApiKey: "v3-test-key" }) }));
const bars = [
  {
    time: "2026-10-01 04:02:00",
    open: 334.18,
    high: 334.83,
    low: 325.82,
    close: 330.79,
    volume: 15666143,
    trades: 265910,
  },
  {
    time: "2026-10-02 04:00:00",
    open: 331.14,
    high: 334.54,
    low: 330.17,
    close: 333.53,
    volume: 15026716,
    trades: 228816,
  },
];
const opts = { start: "2026-10-01", end: "2026-10-02", order: "asc" as const };
beforeEach(() => {
  cache.clear();
  rateLimiter.configure("lse", 100, 100);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("LSE v3 compatibility", () => {
  it("exports adjusted CSV candles from the v3 host with explicit date bounds", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      lseCsvResponse(bars, { "x-lse3-adjusted": "1" }),
    );
    vi.stubGlobal("fetch", withLseUsage(fetch));
    const rows = await getLseCandles("AAPL", "1d", opts);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ts: "2026-10-01T04:02:00Z", symbol: "AAPL", close: 330.79 });
    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("https://download.londonstrategicedge.com/v3/export");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      market: "us_stocks",
      from: "2026-10-01",
      to: "2026-10-02",
      adjusted: "1",
      format: "csv",
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: { "x-api-key": "v3-test-key" },
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
  });
  it("normalizes an authenticated v3 candle fixture with the native extra date column", async () => {
    vi.stubGlobal(
      "fetch",
      withLseUsage(vi.fn(async () => lseCsvResponse(liveCandles.rows, { "x-lse3-adjusted": "1" }))),
    );
    const rows = await getLseCandles("AAPL", "1d", { start: "2026-11-10", end: "2026-11-13" });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ ts: "2026-11-10T09:00:00Z", close: 348.8, volume: 12797617 });
  });

  it.each([
    ["VOD.L", "uk_stocks", "VOD"],
    ["VOD.UK", "uk_stocks", "VOD"],
    ["RY.TO", "ca_stocks", "RY"],
    ["BRK-B", "us_stocks", "BRK.B"],
  ])("resolves the equity market for %s", async (symbol, market, nativeSymbol) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      lseCsvResponse(bars, { "x-lse3-adjusted": "1" }),
    );
    vi.stubGlobal("fetch", withLseUsage(fetch));
    await getLseCandles(symbol, "1d", opts);
    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.searchParams.get("market")).toBe(market);
    expect(url.searchParams.get("symbol")).toBe(nativeSymbol);
  });

  it("rejects an unsupported market instead of silently looking up a US listing", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(getLseCandles("SAP.DE", "1d", opts)).rejects.toThrow(/market/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses truncated downloads and inconsistent CSV rows", async () => {
    vi.stubGlobal(
      "fetch",
      withLseUsage(
        vi.fn(async () => lseCsvResponse(bars, { "x-lse3-adjusted": "1", "content-length": "1" })),
      ),
    );
    await expect(getLseCandles("AAPL", "1d", opts)).rejects.toThrow(/truncated/i);
    vi.stubGlobal(
      "fetch",
      withLseUsage(
        vi.fn(
          async () =>
            new Response("time,open,high,low,close,volume\n2026-10-01,1,2,1,2\n", {
              headers: { "content-type": "text/csv", "x-lse3-adjusted": "1" },
            }),
        ),
      ),
    );
    await expect(getLseCandles("AAPL", "1d", opts)).rejects.toThrow(/column count/i);
  });

  it.each([
    { ...opts, limit: 0 },
    { ...opts, start: "2026-02-31" },
    { ...opts, start: "2026-10-03", end: "2026-10-01" },
  ])("rejects invalid bounds/limits before contacting the provider: %j", async (options) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(getLseCandles("AAPL", "1d", options)).rejects.toThrow(/date|limit/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("applies descending order and a row limit to the complete export", async () => {
    vi.stubGlobal(
      "fetch",
      withLseUsage(vi.fn(async () => lseCsvResponse(bars, { "x-lse3-adjusted": "1" }))),
    );
    const rows = await getLseCandles("AAPL", "1d", { ...opts, order: "desc", limit: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ts).toBe("2026-10-02T04:00:00Z");
  });

  it("rejects financial exports for another symbol", async () => {
    vi.stubGlobal(
      "fetch",
      withLseUsage(
        vi.fn(async () =>
          lseCsvResponse(liveReports.rows.map((row) => ({ ...row, symbol: "OTHER" }))),
        ),
      ),
    );
    await expect(getLseFinancialReports("AAPL", "income")).rejects.toThrow(/invalid rows/i);
  });

  it("derives free cash flow from signed capex when the reported field is absent", async () => {
    const rows = liveReports.rows.map((row) => {
      if (row.report_type !== "cashflow") return row;
      const data = JSON.parse(row.data) as Record<string, unknown>;
      delete data.freeCashFlow;
      return { ...row, data: JSON.stringify(data) };
    });
    vi.stubGlobal("fetch", withLseUsage(vi.fn(async () => lseCsvResponse(rows))));
    const statements = await getLseFinancials("AAPL");
    expect(statements[0]?.freeCashFlow).toBe(98_767_000_000);
  });

  it("reads all annual statement types in one export and coalesces concurrent requests", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => lseCsvResponse(liveReports.rows));
    vi.stubGlobal("fetch", withLseUsage(fetch));
    const [a, b] = await Promise.all([getLseFinancials("AAPL"), getLseFinancials("AAPL")]);
    expect(a).toEqual(b);
    expect(a).toHaveLength(4);
    expect(a[0]).toMatchObject({
      fiscalDate: "2025-09-27",
      revenue: 416161000000,
      freeCashFlow: 98767000000,
    });
    expect(fetch).toHaveBeenCalledOnce();
    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/v3/reference/export");
    expect(url.searchParams.get("dataset")).toBe("financial_reports");
    expect(url.searchParams.has("report_type")).toBe(false);
  });
  it.each(["account-required", "plan-required", "history-limit"])(
    "preserves %s as an access error rather than asking for a replacement key",
    async (code) => {
      vi.stubGlobal(
        "fetch",
        withLseUsage(
          vi.fn<typeof globalThis.fetch>(async () =>
            Response.json({ code, message: "Access needs account or plan" }, { status: 403 }),
          ),
        ),
      );
      const error = await getLseCandles("AAPL", "1d", opts).catch((e) => e);
      expect(error).not.toBeInstanceOf(ProviderCredentialError);
      expect(error).toMatchObject({ status: 403, code });
      expect(error.message).toContain("Access needs account or plan");
    },
  );
  it("rejects unknown keys as credential errors", async () => {
    vi.stubGlobal(
      "fetch",
      withLseUsage(
        vi.fn<typeof globalThis.fetch>(async () =>
          Response.json({ code: "key-unknown", message: "this key is not known" }, { status: 401 }),
        ),
      ),
    );
    await expect(getLseCandles("AAPL", "1d", opts)).rejects.toMatchObject({
      provider: "lse",
      reason: "stale",
    });
  });
  it.each([202, 200])(
    "refuses a JSON job/preview instead of treating HTTP %i as a complete export",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        withLseUsage(
          vi.fn<typeof globalThis.fetch>(async () =>
            Response.json({ rows: bars, download_url: "https://evil.test/key" }, { status }),
          ),
        ),
      );
      await expect(getLseCandles("AAPL", "1d", opts)).rejects.toThrow(/export|CSV/i);
    },
  );
  it("refuses unadjusted prices and corrupt download checksums", async () => {
    vi.stubGlobal(
      "fetch",
      withLseUsage(
        vi.fn<typeof globalThis.fetch>(async () =>
          lseCsvResponse(bars, { "x-lse3-adjusted": "0" }),
        ),
      ),
    );
    await expect(getLseCandles("AAPL", "1d", opts)).rejects.toThrow(/adjust/i);
    vi.stubGlobal(
      "fetch",
      withLseUsage(
        vi.fn<typeof globalThis.fetch>(async () =>
          lseCsvResponse(bars, { "x-lse3-adjusted": "1", "x-checksum-sha256": "0".repeat(64) }),
        ),
      ),
    );
    await expect(getLseCandles("AAPL", "1d", opts)).rejects.toThrow(/checksum/i);
  });
  it("does not retry before a long Retry-After has elapsed", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        { code: "calls-exhausted", message: "wait a minute" },
        { status: 429, headers: { "retry-after": "57" } },
      ),
    );
    vi.stubGlobal("fetch", withLseUsage(fetch));
    await expect(getLseCandles("AAPL", "1d", opts)).rejects.toThrow(/wait a minute/);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("cancels a pending retry when the user stops", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        { code: "connections-exhausted", message: "busy" },
        { status: 429, headers: { "retry-after": "5" } },
      ),
    );
    vi.stubGlobal("fetch", withLseUsage(fetch));
    const pending = runWithAbortSignal(controller.signal, () =>
      getLseCandles("AAPL", "1d", opts),
    ).catch((error) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledOnce();
    const reason = new Error("user stopped");
    controller.abort(reason);
    await expect(pending).resolves.toBe(reason);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("cancels a stalled response body even when stream cancellation rejects", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream({
      cancel() {
        throw new Error("stream cancellation failed");
      },
    });
    vi.stubGlobal(
      "fetch",
      withLseUsage(
        vi.fn(
          async () =>
            new Response(stream, {
              headers: { "content-type": "text/csv", "x-lse3-adjusted": "1" },
            }),
        ),
      ),
    );
    const pending = runWithAbortSignal(controller.signal, () =>
      getLseCandles("AAPL", "1d", opts),
    ).catch((error) => error);
    await vi.waitFor(() => expect(stream.locked).toBe(true));
    const reason = new Error("user stopped");
    controller.abort(reason);
    await expect(pending).resolves.toBe(reason);
  });

  it("does not turn a user stop into a stale-cache success", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(async () => lseCsvResponse(bars, { "x-lse3-adjusted": "1" }))
      .mockImplementation(async () =>
        Response.json(
          { code: "connections-exhausted", message: "busy" },
          { status: 429, headers: { "retry-after": "5" } },
        ),
      );
    vi.stubGlobal("fetch", withLseUsage(fetch));
    await getLseCandles("AAPL", "1d", opts);
    await vi.advanceTimersByTimeAsync(TTL.CANDLES + 1);
    const pending = runWithAbortSignal(controller.signal, () =>
      getLseCandles("AAPL", "1d", opts),
    ).catch((error) => error);
    await vi.advanceTimersByTimeAsync(0);
    const reason = new Error("user stopped");
    controller.abort(reason);
    await expect(pending).resolves.toBe(reason);
  });

  it("accepts charged input-row counts that differ from returned candle records", async () => {
    vi.stubGlobal(
      "fetch",
      withLseUsage(
        vi.fn(async () =>
          lseCsvResponse(meteredCandles.rows, {
            "x-lse3-adjusted": "1",
            "x-export-rows": meteredCandles.headers["x-export-rows"],
          }),
        ),
      ),
    );
    const rows = await getLseCandles("AAPL", "1d", {
      start: "2026-11-03",
      end: "2026-11-17",
    });
    expect(rows).toHaveLength(10);
    expect(rows.at(-1)?.ts).toBe("2026-11-16T09:00:00Z");
  });

  it.each(["-1", "1.5", "not-a-count", "9007199254740992"])(
    "rejects invalid advertised charged rows: %s",
    async (count) => {
      vi.stubGlobal(
        "fetch",
        withLseUsage(
          vi.fn(async () =>
            lseCsvResponse(bars, { "x-lse3-adjusted": "1", "x-export-rows": count }),
          ),
        ),
      );
      await expect(getLseCandles("AAPL", "1d", opts)).rejects.toThrow(/row count/i);
    },
  );

  it("refreshes server usage after an early quota reset instead of reusing cached usage", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        plan: "free",
        withheld: null,
        weekly: { allowance_bytes: 13421772800, used_bytes: 0, week: "2026-W47" },
        rows: {
          per_export: 2500000,
          per_day: 12500000,
          used_today: 0,
          day: "2026-11-16",
          resets_in_seconds: 3600,
        },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await getLseUsage();
    markExhausted("allowance-exhausted", 1);
    await vi.advanceTimersByTimeAsync(1001);
    expect(isOverSoftThreshold()).toBe(false);
    await getLseUsage();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getUsage().blockedUntil).toBeUndefined();
  });

  it("lets an independent caller finish when the first caller stops", async () => {
    const firstController = new AbortController();
    const secondController = new AbortController();
    let exports = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      exports++;
      if (exports === 1)
        await new Promise<void>((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          }),
        );
      return lseCsvResponse(bars, { "x-lse3-adjusted": "1" });
    });
    vi.stubGlobal("fetch", withLseUsage(fetch));
    const first = runWithAbortSignal(firstController.signal, () =>
      getLseCandles("AAPL", "1d", opts),
    ).catch((error) => error);
    const second = runWithAbortSignal(secondController.signal, () =>
      getLseCandles("AAPL", "1d", opts),
    ).catch((error) => error);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const reason = new Error("first caller stopped");
    firstController.abort(reason);
    await expect(first).resolves.toBe(reason);
    const rows = await second;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("stops a queued independent caller immediately without cancelling the active caller", async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      await ready;
      return lseCsvResponse(bars, { "x-lse3-adjusted": "1" });
    });
    vi.stubGlobal("fetch", withLseUsage(fetch));
    const first = runWithAbortSignal(firstController.signal, () =>
      getLseCandles("AAPL", "1d", opts),
    );
    let secondOutcome: unknown;
    const second = runWithAbortSignal(secondController.signal, () =>
      getLseCandles("AAPL", "1d", opts),
    ).then(
      (value) => {
        secondOutcome = value;
      },
      (error) => {
        secondOutcome = error;
      },
    );
    const reason = new Error("second caller stopped");
    try {
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      secondController.abort(reason);
      await vi.waitFor(() => expect(secondOutcome).toBe(reason));
      expect(firstController.signal.aborted).toBe(false);
    } finally {
      release();
      await Promise.allSettled([first, second]);
    }
    await expect(first).resolves.toHaveLength(2);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("honors a stop even when a fresh candle cache is available", async () => {
    vi.stubGlobal(
      "fetch",
      withLseUsage(vi.fn(async () => lseCsvResponse(bars, { "x-lse3-adjusted": "1" }))),
    );
    await getLseCandles("AAPL", "1d", opts);
    const controller = new AbortController();
    const reason = new Error("user stopped");
    controller.abort(reason);
    await expect(
      runWithAbortSignal(controller.signal, () => getLseCandles("AAPL", "1d", opts)),
    ).rejects.toBe(reason);
  });

  it("serializes different exports until the preceding response body is consumed", async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      await ready;
      return lseCsvResponse(bars, { "x-lse3-adjusted": "1" });
    });
    vi.stubGlobal("fetch", withLseUsage(fetch));
    const a = getLseCandles("AAPL", "1d", opts);
    const b = getLseCandles("MSFT", "1d", opts);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    release();
    await Promise.all([a, b]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
