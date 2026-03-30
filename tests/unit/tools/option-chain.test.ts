import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { optionChainTool } from "../../../src/tools/options/option-chain.js";
import { cache } from "../../../src/infra/cache.js";
import { clearCrumbCache } from "../../../src/providers/yahoo-finance.js";
import optionsFixture from "../../fixtures/yahoo/options-AAPL.json";

function mockCrumbAndOptions() {
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
      json: () => Promise.resolve(optionsFixture),
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
  });

  it("has correct tool metadata", () => {
    expect(optionChainTool.name).toBe("get_option_chain");
    expect(optionChainTool.label).toBe("Options Chain");
    expect(optionChainTool.description).toBeTruthy();
  });

  it("returns formatted text with strikes, Greeks, and summary", async () => {
    mockCrumbAndOptions();
    const result = await optionChainTool.execute("call-1", { symbol: "AAPL" });
    const text = (result.content[0] as any).text;
    expect(text).toContain("AAPL");
    expect(text).toContain("Delta");
    expect(text).toContain("IV");
    expect(text).toContain("Put/Call");
  });

  it("returns typed OptionsChain in details", async () => {
    mockCrumbAndOptions();
    const result = await optionChainTool.execute("call-2", { symbol: "AAPL" });
    expect(result.details.symbol).toBe("AAPL");
    expect(result.details.calls.length).toBeGreaterThan(0);
    expect(result.details.puts.length).toBeGreaterThan(0);
    expect(result.details.underlyingPrice).toBe(248.8);
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
});
