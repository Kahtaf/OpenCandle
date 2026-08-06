import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import { searchFilings } from "../../../src/providers/sec-edgar.js";

const mockSearchResponse = {
  hits: {
    hits: [
      {
        _id: "0000320193-24-000123:aapl-20240928.htm",
        _source: {
          file_date: "2024-10-31",
          form: "10-K",
          adsh: "0000320193-24-000123",
          display_names: ["APPLE INC  (AAPL)  (CIK 0000320193)"],
          period_ending: "2024-09-28",
          ciks: ["0000320193"],
        },
      },
      {
        _id: "0000320193-24-000089:aapl-20240629.htm",
        _source: {
          file_date: "2024-08-02",
          form: "10-Q",
          adsh: "0000320193-24-000089",
          display_names: ["APPLE INC  (AAPL)  (CIK 0000320193)"],
          period_ending: "2024-06-29",
          ciks: ["0000320193"],
        },
      },
    ],
  },
};

describe("sec-edgar provider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("searches EDGAR EFTS API with correct parameters", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSearchResponse),
    });

    await searchFilings("AAPL", ["10-K", "10-Q"]);

    const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
    const init = vi.mocked(globalThis.fetch).mock.calls[0][1];
    expect(url).toContain("efts.sec.gov");
    expect(url).toContain("AAPL");
    expect(url).toContain("10-K");
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
  });

  it("returns typed SECFiling objects", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSearchResponse),
    });

    const filings = await searchFilings("AAPL", ["10-K", "10-Q"]);
    expect(filings).toHaveLength(2);
    expect(filings[0].formType).toBe("10-K");
    expect(filings[0].entityName).toBe("APPLE INC");
    expect(filings[0].filedDate).toBe("2024-10-31");
    expect(filings[0].periodOfReport).toBe("2024-09-28");
    expect(filings[0]).toHaveProperty("accessionNumber");
    expect(filings[0]).toHaveProperty("url");
    expect(filings[0].primaryDocumentUrl).toContain("aapl-20240928.htm");
  });

  it("constructs accession-specific EDGAR archive URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSearchResponse),
    });

    const filings = await searchFilings("AAPL");
    // URL should contain the accession number (without dashes) and point to the filing
    expect(filings[0].url).toContain("sec.gov");
    expect(filings[0].url).toContain("000032019324000123"); // accessionNoDash
    expect(filings[0].url).toContain("0000320193-24-000123"); // full accession
    expect(filings[0].primaryDocumentUrl).toContain("000032019324000123/aapl-20240928.htm");
  });

  it("optionally fetches short filing evidence snippets from primary documents", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            "0": { cik_str: 320193, ticker: "AAPL", title: "APPLE INC" },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            name: "APPLE INC",
            tickers: ["AAPL"],
            filings: {
              recent: {
                accessionNumber: ["0000320193-24-000123", "0000320193-24-000089"],
                filingDate: ["2024-10-31", "2024-08-02"],
                reportDate: ["2024-09-28", "2024-06-29"],
                form: ["10-K", "10-Q"],
                primaryDocument: ["aapl-20240928.htm", "aapl-20240629.htm"],
                items: ["", ""],
              },
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            `<html><body>Table of Contents Page Item 1A. Risk Factors 43 Item 7. Management's Discussion 89 ${"filler ".repeat(80)} Later section: Risk Factors include regulatory uncertainty and litigation exposure from platform rules.</body></html>`,
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            "<html><body>Management's Discussion notes revenue concentration and liquidity trends.</body></html>",
          ),
      });

    const filings = await searchFilings("AAPL", ["10-K", "10-Q"], 2, { includeSnippets: true });
    expect(filings[0].evidenceSnippets?.[0]).toContain("Risk Factors");
    expect(filings[0].evidenceSnippets?.[0]).toContain("regulatory uncertainty");
    expect(filings[0].evidenceSnippets?.[0]).not.toContain("Table of Contents");
    expect(filings[1].evidenceSnippets?.[0]).toContain("Management's Discussion");
    expect(filings[0].primaryDocumentUrl).toContain("aapl-20240928.htm");
  });

  it("rate limits document fetches and records visible evidence warnings", async () => {
    const acquire = vi.spyOn(rateLimiter, "acquire").mockResolvedValue(undefined);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            "0": { cik_str: 320193, ticker: "AAPL", title: "APPLE INC" },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            name: "APPLE INC",
            filings: {
              recent: {
                accessionNumber: ["0000320193-24-000123"],
                filingDate: ["2024-10-31"],
                reportDate: ["2024-09-28"],
                form: ["10-K"],
                primaryDocument: ["aapl-20240928.htm"],
                items: [""],
              },
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: () => Promise.resolve("rate limited"),
      });

    const filings = await searchFilings("AAPL", ["10-K"], 1, { includeSnippets: true });

    expect(acquire).toHaveBeenCalledWith("sec_edgar");
    expect((fetch as any).mock.calls[2][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(filings[0].evidenceSnippets).toEqual([]);
    expect(filings[0].evidenceWarning).toContain("Evidence fetch failed");
    expect(filings[0].evidenceWarning).toContain("HTTP 429");
  });

  it("caches results", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSearchResponse),
    });

    await searchFilings("AAPL");
    await searchFilings("AAPL");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("defaults to 10-K, 10-Q, 8-K form types", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSearchResponse),
    });

    await searchFilings("AAPL");
    const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
    expect(url).toContain("10-K");
    expect(url).toContain("10-Q");
    expect(url).toContain("8-K");
  });

  it("deduplicates filings by accession number", async () => {
    const dupeResponse = {
      hits: {
        hits: [
          {
            _id: "a:1",
            _source: {
              file_date: "2024-01-01",
              form: "10-K",
              adsh: "SAME-ACCESSION",
              display_names: ["TEST CO  (TEST)  (CIK 0000000123)"],
              period_ending: "2024-01-01",
              ciks: ["123"],
            },
          },
          {
            _id: "a:2",
            _source: {
              file_date: "2024-01-01",
              form: "10-K",
              adsh: "SAME-ACCESSION",
              display_names: ["TEST CO  (TEST)  (CIK 0000000123)"],
              period_ending: "2024-01-01",
              ciks: ["123"],
            },
          },
        ],
      },
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dupeResponse),
    });

    const filings = await searchFilings("TEST", ["10-K"]);
    expect(filings).toHaveLength(1);
  });

  it("filters text-search decoys to the requested ticker", async () => {
    const response = {
      hits: {
        hits: [
          {
            _id: "decoy:1",
            _source: {
              file_date: "2026-01-01",
              form: "8-K",
              adsh: "0001682149-26-000001",
              display_names: ["Datavault AI Inc.  (DVLT)  (CIK 0001682149)"],
              period_ending: "2025-12-31",
              ciks: ["0001682149"],
            },
          },
          {
            _id: "coin:1",
            _source: {
              file_date: "2026-02-01",
              form: "10-K",
              adsh: "0001679788-26-000001",
              display_names: ["Coinbase Global, Inc.  (COIN)  (CIK 0001679788)"],
              period_ending: "2025-12-31",
              ciks: ["0001679788"],
            },
          },
        ],
      },
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(response),
    });

    const filings = await searchFilings("COIN", ["10-K", "8-K"]);
    expect(filings).toHaveLength(1);
    expect(filings[0].entityName).toBe("Coinbase Global, Inc.");
    expect(filings[0].url).toContain("0001679788");
  });
});
