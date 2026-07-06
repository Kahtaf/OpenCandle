import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import { clearCrumbCache } from "../../../src/providers/yahoo-finance.js";
import { optionChainTool } from "../../../src/tools/options/option-chain.js";
import optionsFixture from "../../fixtures/yahoo/options-AAPL.json";

function mockCrumbAndOptions(fixture: typeof optionsFixture = optionsFixture) {
  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("fc.yahoo.com")) {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ "set-cookie": "A3=d=testcookie; Path=/" }),
        text: () => Promise.resolve(""),
      });
    }
    if (typeof url === "string" && url.includes("getcrumb")) {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve("testCrumb"),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(fixture),
    });
  });
}

describe("get_option_chain tool", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
    clearCrumbCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("has correct tool metadata", () => {
    expect(optionChainTool.name).toBe("get_option_chain");
    expect(optionChainTool.label).toBe("Options Chain");
    expect(optionChainTool.description).toBeTruthy();
  });

  it("returns formatted text with strikes, Greeks, and summary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T16:00:00.000Z"));
    rateLimiter.configure("yahoo", 1000, 1000);
    mockCrumbAndOptions();
    const result = await optionChainTool.execute("call-1", { symbol: "AAPL" });
    const text = (result.content[0] as any).text;
    expect(text).toContain("AAPL");
    expect(text).toContain("Delta");
    expect(text).toContain("Gamma");
    expect(text).toContain("Vega");
    expect(text).toContain("Rho");
    expect(text).toContain("IV");
    expect(text).toContain("Put/Call");
    expect(text.split("\n").at(-1)).toMatch(
      /^Last available price as of 2024-03-22(?: \(market closed — .+\))?\. This is not a live quote\.$/,
    );
  });

  it("labels option premiums as per-share quotes with standard-contract total math", async () => {
    mockCrumbAndOptions();
    const result = await optionChainTool.execute("call-premium-units", { symbol: "AAPL" });
    const text = (result.content[0] as any).text;

    expect(text).toContain("Option bid/ask and last prices are quoted per share");
    expect(text).toContain("multiply by 100 for one standard contract");
    expect(text).toContain("Bid/Ask (per share)");
  });

  it("returns typed OptionsChain in details", async () => {
    mockCrumbAndOptions();
    const result = await optionChainTool.execute("call-2", { symbol: "AAPL" });
    expect(result.details.symbol).toBe("AAPL");
    expect(result.details.calls.length).toBeGreaterThan(0);
    expect(result.details.puts.length).toBeGreaterThan(0);
    expect(result.details.underlyingPrice).toBe(248.8);
    expect(result.details.freshness.providerDataAt).toBe("2024-03-22T20:00:00.000Z");
  });

  it("uppercases the symbol", async () => {
    mockCrumbAndOptions();
    await optionChainTool.execute("call-3", { symbol: "aapl" });
    const optionsCalls = (fetch as any).mock.calls.filter(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("/v7/finance/options/"),
    );
    expect(optionsCalls[0][0]).toContain("AAPL");
  });

  it("accepts uppercase CALL filter values", async () => {
    mockCrumbAndOptions();
    const result = await optionChainTool.execute("call-4", { symbol: "AAPL", type: "CALL" });
    const text = (result.content[0] as any).text;
    expect(text).toContain("**CALLS**");
    expect(text).not.toContain("**PUTS**");
  });

  it("rejects semantically invalid expiration dates before fetching Yahoo", async () => {
    globalThis.fetch = vi.fn();

    await expect(
      optionChainTool.execute("call-invalid-expiration", {
        symbol: "AAPL",
        expiration: "2026-99-99",
      }),
    ).rejects.toThrow("expiration must be a valid YYYY-MM-DD date");

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("shows long-dated available expirations instead of hiding them behind a count", async () => {
    const fixture = structuredClone(optionsFixture);
    fixture.optionChain.result[0].expirationDates = [
      1778803200, // 2026-05-15
      1779408000, // 2026-05-22
      1780012800, // 2026-05-29
      1780617600, // 2026-06-05
      1781222400, // 2026-06-12
      1781740800, // 2026-06-18
      1782432000, // 2026-06-26
      1797552000, // 2026-12-18
      1800057600, // 2027-01-15
      1813190400, // 2027-06-17
      1832025600, // 2028-01-21
    ];
    mockCrumbAndOptions(fixture);

    const result = await optionChainTool.execute("call-5", { symbol: "AAPL" });
    const text = (result.content[0] as any).text;

    expect(text).toContain("2027-06-17");
    expect(text).toContain("2028-01-21");
    expect(text).not.toContain("+5 more");
  });

  it("warns that all-zero bid/ask quotes are stale before options market open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:26:00Z")); // 8:26 AM EDT
    rateLimiter.configure("yahoo", 5, 5);
    const fixture = structuredClone(optionsFixture);
    for (const contract of fixture.optionChain.result[0].options[0].calls) {
      contract.bid = 0;
      contract.ask = 0;
    }
    for (const contract of fixture.optionChain.result[0].options[0].puts) {
      contract.bid = 0;
      contract.ask = 0;
    }
    mockCrumbAndOptions(fixture);

    const result = await optionChainTool.execute("call-6", { symbol: "AAPL" });
    const text = (result.content[0] as any).text;

    expect(text).toContain("Quote status: pre_market");
    expect(text).toContain("closed_market_or_stale_quotes");
    expect(text).toContain("do not treat zero bid/ask as confirmed live illiquidity");
    expect(text).toContain("do not stop at the stale quote caveat");
    expect(text).toContain("finish the strategy explanation");
    expect(text).toContain("Last available price as of 2024-03-22");
  });
});
