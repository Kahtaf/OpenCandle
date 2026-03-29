import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchFilings, type SECFiling } from "../../../src/providers/sec-edgar.js";
import { cache } from "../../../src/infra/cache.js";

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
    expect(url).toContain("efts.sec.gov");
    expect(url).toContain("AAPL");
    expect(url).toContain("10-K");
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
          { _id: "a:1", _source: { file_date: "2024-01-01", form: "10-K", adsh: "SAME-ACCESSION", display_names: ["TEST CO"], period_ending: "2024-01-01", ciks: ["123"] } },
          { _id: "a:2", _source: { file_date: "2024-01-01", form: "10-K", adsh: "SAME-ACCESSION", display_names: ["TEST CO"], period_ending: "2024-01-01", ciks: ["123"] } },
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
});
