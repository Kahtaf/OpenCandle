import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import { stockHistoryTool } from "../../../src/tools/market/stock-history.js";

vi.mock("../../../src/config.js", () => ({
  getConfig: () => ({ alphaVantageApiKey: "av-test-key", lseApiKey: "lse-test-key" }),
}));

vi.mock("../../../src/infra/lse-byte-budget.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/infra/lse-byte-budget.js")>();
  return {
    ...actual,
    isOverSoftThreshold: () => false,
    markExhausted: vi.fn(),
    recordBytes: vi.fn(),
  };
});

describe("stock history provider failures", () => {
  beforeEach(() => {
    cache.clear();
    rateLimiter.configure("yahoo", 100, 100);
    rateLimiter.configure("alphavantage", 100, 100);
    rateLimiter.configure("lse", 100, 100);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    cache.clear();
  });

  it("returns unavailable when the optional LSE fallback rejects its credential", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const host = new URL(input instanceof Request ? input.url : String(input)).hostname;
        if (host.includes("yahoo")) {
          return Promise.resolve(new Response("{}", { status: 404 }));
        }
        if (host === "www.alphavantage.co") {
          return Promise.resolve(Response.json({}));
        }
        if (host === "api.londonstrategicedge.com") {
          return Promise.resolve(Response.json({ detail: "Invalid API key" }, { status: 401 }));
        }
        throw new Error(`Unexpected provider host: ${host}`);
      }),
    );

    const result = await stockHistoryTool.execute("call-lse-401", {
      symbol: "AAPL",
      range: "6mo",
      interval: "1d",
    });

    expect(result.details).toEqual([]);
    expect(result.content[0]).toMatchObject({ type: "text" });
    if (result.content[0].type !== "text") throw new Error("expected text content");
    expect(result.content[0].text).toContain("⚠ Stock history unavailable for AAPL");
    expect(result.content[0].text).toContain("lse:");
  });
});
