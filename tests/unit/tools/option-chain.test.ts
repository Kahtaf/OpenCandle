import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import { clearCrumbCache } from "../../../src/providers/yahoo-finance.js";
import { optionChainTool } from "../../../src/tools/options/option-chain.js";
import optionsFixture from "../../fixtures/yahoo/options-AAPL.json";
import afterHoursFixture from "../../fixtures/yahoo/options-AAPL-after-hours.json";
import holidayClosedFixture from "../../fixtures/yahoo/options-AAPL-holiday-closed.json";
import regularFixture from "../../fixtures/yahoo/options-AAPL-regular.json";

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

// Stable Wednesday 11:00 AM ET — a weekday inside the NY regular options
// session. Freezing "now" here keeps quote-status branches independent of the
// wall clock. Tests that need a different session override the time explicitly.
const REGULAR_SESSION = new Date("2026-05-20T15:00:00.000Z");

describe("get_option_chain tool", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
    clearCrumbCache();
    // Fake only the clock; keep timers real so the rate limiter and fetch
    // scheduling behave like production.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(REGULAR_SESSION);
    // Re-anchor the shared bucket to the frozen clock; otherwise its
    // module-load "last refill" stays on the real wall clock and a negative
    // elapsed time makes acquire() wait for an absurd duration.
    rateLimiter.configure("yahoo", 5, 5);
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
    expect(result.details.quoteStatus.marketSession).toBe("regular");
    expect(result.details.quoteStatus.warning).toBeUndefined();
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
    // Intentional pre-market case: pin the pre-market clock explicitly so the
    // warning path is exercised regardless of when the suite runs.
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
    expect(text).toContain("not evidence of live illiquidity");
    expect(text).toContain("Bid/Ask (per share, not executable)");
    expect(text).toContain("Last available price as of 2024-03-22");
  });

  it("states quote facts without answer-writing instructions", async () => {
    vi.setSystemTime(new Date("2026-05-21T02:05:00.000Z")); // 10:05 PM EDT
    rateLimiter.configure("yahoo", 5, 5);
    mockCrumbAndOptions(structuredClone(afterHoursFixture) as typeof optionsFixture);

    const result = await optionChainTool.execute("call-no-imperatives", { symbol: "AAPL" });
    const text = (result.content[0] as any).text as string;

    expect(text).not.toMatch(/do not stop at/i);
    expect(text).not.toMatch(/finish the strategy explanation/i);
    expect(text).not.toMatch(/labeled hypothetical/i);
    expect(text).not.toMatch(/assignment outcomes/i);
    expect(text).not.toMatch(/avoid naming/i);
  });

  it("labels after-hours nonzero bid/ask as last-session and not executable", async () => {
    vi.setSystemTime(new Date("2026-05-21T02:05:00.000Z")); // 10:05 PM EDT
    rateLimiter.configure("yahoo", 5, 5);
    mockCrumbAndOptions(structuredClone(afterHoursFixture) as typeof optionsFixture);

    const result = await optionChainTool.execute("call-after-hours", { symbol: "AAPL" });
    const text = (result.content[0] as any).text as string;

    expect(text).toContain("Quote status: after_hours / last_session_quotes");
    expect(text).not.toContain("live_quotes");
    expect(text).toContain("Last-session bid/ask (per share, not executable)");
    expect(text).not.toContain("| Bid/Ask (per share) |");
    expect(text).toContain("No bid/ask midpoint is a live premium");
    expect(text).toContain("Session source: Yahoo marketState POST");
    expect(text).toContain("Latest contract trade: 2026-05-20 15:59 ET");
    expect(result.details?.quoteStatus.bidAskState).toBe("last_session_quotes");
    expect(result.details?.quoteStatus.latestContractTradeAt).toBe("2026-05-20T19:59:00.000Z");
  });

  it("shows each contract's last trade time in ET", async () => {
    vi.setSystemTime(new Date("2026-05-21T02:05:00.000Z"));
    rateLimiter.configure("yahoo", 5, 5);
    mockCrumbAndOptions(structuredClone(afterHoursFixture) as typeof optionsFixture);

    const result = await optionChainTool.execute("call-last-trade", {
      symbol: "AAPL",
      type: "call",
    });
    const text = (result.content[0] as any).text as string;
    const header = text.split("\n").find((line) => line.startsWith("Strike |"));
    const rows = text.split("\n").filter((line) => /^[* ]\$\d/.test(line));

    expect(header).toContain("| Last trade (ET) |");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.includes("| 2026-05-20 15:59 |"))).toBe(true);
    expect(rows.some((row) => row.includes("| 2026-05-20 15:52 |"))).toBe(true);
  });

  it("keeps the live bid/ask header during a REGULAR session", async () => {
    mockCrumbAndOptions(structuredClone(regularFixture) as typeof optionsFixture);

    const result = await optionChainTool.execute("call-regular", { symbol: "AAPL" });
    const text = (result.content[0] as any).text as string;

    expect(text).toContain("Quote status: regular / live_quotes");
    expect(text).toContain("| Bid/Ask (per share) |");
    expect(text).not.toContain("not executable");
    expect(text).not.toContain("⚠");
  });

  it("names the calendar fallback and an unrecognized Yahoo marketState", async () => {
    const fixture = structuredClone(regularFixture);
    fixture.optionChain.result[0].quote.marketState = "SOMETHING_NEW";
    mockCrumbAndOptions(fixture as unknown as typeof optionsFixture);

    const result = await optionChainTool.execute("call-unknown-state", { symbol: "AAPL" });
    const text = (result.content[0] as any).text as string;

    expect(text).toContain(
      "Session source: local US market calendar (unrecognized Yahoo marketState SOMETHING_NEW)",
    );
  });

  it("relabels a cached regular-session chain as not executable after the close", async () => {
    vi.setSystemTime(new Date("2026-05-20T19:59:00.000Z"));
    mockCrumbAndOptions(structuredClone(regularFixture) as typeof optionsFixture);
    await optionChainTool.execute("call-before-close", { symbol: "AAPL" });

    vi.setSystemTime(new Date("2026-05-20T20:01:00.000Z"));
    const result = await optionChainTool.execute("call-after-close", { symbol: "AAPL" });
    const text = (result.content[0] as any).text as string;

    expect(text).toContain("Quote status: after_hours / last_session_quotes");
    expect(text).toContain(
      "Session source: local US market calendar (cached Yahoo marketState REGULAR was reported before the regular session ended)",
    );
    expect(text).toContain("Last-session bid/ask (per share, not executable)");
  });

  it("notes when Yahoo reports no marketState", async () => {
    mockCrumbAndOptions();

    const result = await optionChainTool.execute("call-no-state", { symbol: "AAPL" });
    const text = (result.content[0] as any).text as string;

    expect(text).toContain(
      "Session source: local US market calendar (Yahoo did not report marketState)",
    );
  });

  it("shows n/a for contracts without a last trade time and omits the latest-trade line", async () => {
    const fixture = structuredClone(regularFixture) as Record<string, any>;
    const option = fixture.optionChain.result[0].options[0];
    for (const contract of [...option.calls, ...option.puts]) delete contract.lastTradeDate;
    mockCrumbAndOptions(fixture as typeof optionsFixture);

    const result = await optionChainTool.execute("call-no-trade-date", { symbol: "AAPL" });
    const text = (result.content[0] as any).text as string;
    const rows = text.split("\n").filter((line) => /^[* ]\$\d/.test(line));

    expect(text).not.toContain("Latest contract trade:");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.includes("| n/a |"))).toBe(true);
  });

  it("keeps the live bid/ask header for all-zero quotes during the regular session", async () => {
    const fixture = structuredClone(regularFixture);
    const option = fixture.optionChain.result[0].options[0];
    for (const contract of [...option.calls, ...option.puts]) {
      contract.bid = 0;
      contract.ask = 0;
    }
    mockCrumbAndOptions(fixture as unknown as typeof optionsFixture);

    const result = await optionChainTool.execute("call-live-zero", { symbol: "AAPL" });
    const text = (result.content[0] as any).text as string;

    expect(text).toContain("Quote status: regular / live_zero_bid_ask");
    expect(text).toContain("| Bid/Ask (per share) |");
    expect(text).toContain("unconfirmed without a broker quote");
  });

  it("reports a closed session on a weekday exchange holiday", async () => {
    vi.setSystemTime(new Date("2026-05-25T14:00:00.000Z")); // Monday 10:00 AM EDT
    rateLimiter.configure("yahoo", 5, 5);
    mockCrumbAndOptions(structuredClone(holidayClosedFixture) as typeof optionsFixture);

    const result = await optionChainTool.execute("call-holiday", { symbol: "AAPL" });
    const text = (result.content[0] as any).text as string;

    expect(text).toContain("Quote status: closed / last_session_quotes");
    expect(text).toContain("Last-session bid/ask (per share, not executable)");
    expect(text).toContain("Latest contract trade: 2026-05-22 15:59 ET");
  });
});
