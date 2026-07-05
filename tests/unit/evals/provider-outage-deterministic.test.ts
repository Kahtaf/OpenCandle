import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import { stockQuoteTool } from "../../../src/tools/market/stock-quote.js";
import { correlationTool } from "../../../src/tools/portfolio/correlation.js";
import type { EvalTrace } from "../../evals/types.js";
import aaplHistoryFixture from "../../fixtures/yahoo/AAPL-history-e3.json";
import aaplQuoteFixture from "../../fixtures/yahoo/AAPL-quote.json";
import msftHistoryFixture from "../../fixtures/yahoo/MSFT-history-e3.json";
import msftQuoteFixture from "../../fixtures/yahoo/MSFT-quote.json";
import weekendStaleQuoteFixture from "../../fixtures/yahoo/weekend-stale-quote.json";
import zeroQuoteFixture from "../../fixtures/yahoo/XXFAKEXX-quote.json";

function textFromToolResult(result: Awaited<ReturnType<typeof stockQuoteTool.execute>>): string {
  const item = result.content[0];
  if (item?.type !== "text") throw new Error("expected text tool content");
  return item.text;
}

function makeResponse(
  body: unknown,
  init: { ok?: boolean; status?: number; statusText?: string } = {},
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function hasOpenCandleTurnGap(trace: EvalTrace): boolean {
  return trace.customEntries?.some((entry) => entry.customType === "opencandle-turn-gap") ?? false;
}

describe("E3 deterministic provider outage cases", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
    rateLimiter.configure("yahoo", 1000, 1000);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("discloses a zero-filled Yahoo quote as unavailable without fabricating a $0.00 price", async () => {
    globalThis.fetch = vi.fn((url: string | URL | Request) => {
      const rawUrl = String(url);
      if (rawUrl.includes("/AAPL?")) return Promise.resolve(makeResponse(aaplQuoteFixture));
      if (rawUrl.includes("/MSFT?")) return Promise.resolve(makeResponse(msftQuoteFixture));
      if (rawUrl.includes("/XXFAKEXX?")) return Promise.resolve(makeResponse(zeroQuoteFixture));
      return Promise.reject(new Error(`unexpected fetch: ${rawUrl}`));
    }) as typeof fetch;

    const aapl = await stockQuoteTool.execute("quote-aapl", { symbol: "AAPL" });
    const missing = await stockQuoteTool.execute("quote-missing", { symbol: "XXFAKEXX" });
    const msft = await stockQuoteTool.execute("quote-msft", { symbol: "MSFT" });

    const answerText = [
      textFromToolResult(aapl),
      textFromToolResult(missing),
      textFromToolResult(msft),
    ].join("\n\n");

    expect(answerText).toMatch(/Stock quote unavailable for XXFAKEXX/i);
    expect(answerText).not.toMatch(/XXFAKEXX:\s*\$0\.00/i);
    expect(missing.details).toBeNull();
    expect(aapl.details.price).toBeGreaterThan(0);
    expect(msft.details.price).toBeGreaterThan(0);
  });

  it("computes a partial correlation matrix over surviving symbols and reports the dropped 429 symbol", async () => {
    globalThis.fetch = vi.fn((url: string | URL | Request) => {
      const rawUrl = String(url);
      if (rawUrl.includes("/AAPL?")) return Promise.resolve(makeResponse(aaplHistoryFixture));
      if (rawUrl.includes("/MSFT?")) return Promise.resolve(makeResponse(msftHistoryFixture));
      if (rawUrl.includes("/OUTAGE?")) {
        return Promise.resolve(
          makeResponse("rate limited", {
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${rawUrl}`));
    }) as typeof fetch;

    const result = await correlationTool.execute("corr-e3", {
      symbols: ["AAPL", "OUTAGE", "MSFT"],
      period: "1y",
    });

    const text = result.content[0];
    if (text.type !== "text") throw new Error("expected text tool content");
    expect(text.text).toContain("**Correlation Matrix**");
    expect(text.text).toContain("Symbols dropped:");
    expect(text.text).toContain("OUTAGE: HTTP 429 Too Many Requests");
    expect(result.details.matrix).toHaveProperty("AAPL");
    expect(result.details.matrix).toHaveProperty("MSFT");
    expect(result.details.matrix).not.toHaveProperty("OUTAGE");
    expect(result.details.dropped).toEqual([
      { symbol: "OUTAGE", reason: "HTTP 429 Too Many Requests" },
    ]);
  });

  // FINDING(E3-provider-outage): promoted by freshness-ledger. The fixture now
  // carries Yahoo's provider market time, so asserting Friday 2024-03-22 is a
  // strengthening over the old Saturday fetch-day placeholder.
  it("E3: stale weekend quote timestamps are disclosed and never rendered as fresh live prices", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(weekendStaleQuoteFixture));

    const result = await stockQuoteTool.execute("quote-weekend", { symbol: "WEEKEND" });
    const text = textFromToolResult(result);

    expect(text).toMatch(/stale|weekend|last available|as of/i);
    expect(text).toMatch(/2024-03-22|Mar(?:ch)? 22,? 2024/i);
    expect(text).not.toContain("$0.00");
  });

  // FINDING(E3-provider-outage): deterministic tool-level outage cases do not
  // currently produce opencandle-turn-gap entries. That entry is emitted by the
  // live Pi/OpenCandle turn interceptor, so a credentialed harness run is needed
  // to promote this assertion from known-fail to gating.
  it.skip("KNOWN-FAIL E3: provider outage eval traces include an opencandle-turn-gap entry", () => {
    const trace: EvalTrace = {
      prompt: "Compare AAPL, OUTAGE, and MSFT with correlation.",
      classification: {
        workflow: "compare_assets",
        confidence: 1,
        tier: "llm",
        entities: { symbols: ["AAPL", "OUTAGE", "MSFT"] },
      },
      toolCalls: [],
      askUserTranscript: [],
      text: "OUTAGE unavailable; comparison proceeds on AAPL and MSFT.",
      customEntries: [],
    };

    expect(hasOpenCandleTurnGap(trace)).toBe(true);
  });
});
