import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import { searchFilings } from "../../../src/providers/sec-edgar.js";
import submissions from "../../fixtures/sec/aapl-submissions.json";
import tickers from "../../fixtures/sec/company-tickers.json";

const document = `<html><body>Table of Contents Item 1A. Risk Factors Item 7. Management's Discussion ${"filler ".repeat(80)} Risk Factors include regulatory uncertainty and litigation exposure.</body></html>`;

describe("sec-edgar provider", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    cache.clear();
    vi.spyOn(rateLimiter, "acquire").mockResolvedValue(undefined);
    globalThis.fetch = vi.fn().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("company_tickers.json")) return { ok: true, json: async () => tickers };
      if (url.includes("/submissions/")) return { ok: true, json: async () => submissions };
      return { ok: true, text: async () => document };
    });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("selects requested company submissions, with metadata and accession-specific URLs", async () => {
    const filings = await searchFilings("aapl", ["10-K", "10-Q"]);
    expect(filings).toHaveLength(2);
    expect(filings[0]).toMatchObject({
      formType: "10-K",
      entityName: "APPLE INC",
      filedDate: "2024-10-31",
      periodOfReport: "2024-09-28",
      accessionNumber: "0000320193-24-000123",
      url: "https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/0000320193-24-000123-index.htm",
      primaryDocumentUrl:
        "https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm",
    });
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe(
      "https://data.sec.gov/submissions/CIK0000320193.json",
    );
  });

  it("sorts all recent records before limiting, breaks date ties by accession, and deduplicates", async () => {
    const filings = await searchFilings("AAPL", undefined, 2);
    expect(filings.map((f) => f.accessionNumber)).toEqual([
      "0000320193-24-000124",
      "0000320193-24-000123",
    ]);
    expect(filings[0].items).toEqual(["2.02", "9.01"]);
    expect((await searchFilings("AAPL")).map((f) => f.formType)).toEqual(["8-K", "10-K", "10-Q"]);
  });

  it("enriches the same selection without mutating cached metadata", async () => {
    const metadata = await searchFilings("AAPL", ["10-K"], 1);
    const enriched = await searchFilings("AAPL", ["10-K"], 1, { includeSnippets: true });
    expect(enriched[0].accessionNumber).toBe(metadata[0].accessionNumber);
    expect(enriched[0].evidenceSnippets?.[0]).toContain("regulatory uncertainty");
    expect(enriched[0].evidenceSnippets?.[0]).not.toContain("Table of Contents");
    expect(metadata[0].evidenceSnippets).toBeUndefined();
    expect((await searchFilings("AAPL", ["10-K"], 1))[0].evidenceSnippets).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(rateLimiter.acquire).toHaveBeenCalledTimes(3);
  });

  it("records document failures visibly while retaining filing metadata", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("company_tickers.json"))
        return { ok: true, json: async () => tickers } as Response;
      if (url.includes("/submissions/"))
        return { ok: true, json: async () => submissions } as Response;
      return { ok: false, status: 429, statusText: "Too Many Requests" } as Response;
    });
    const filings = await searchFilings("AAPL", ["10-K"], 1, { includeSnippets: true });
    expect(filings[0].evidenceSnippets).toEqual([]);
    expect(filings[0].evidenceWarning).toContain("HTTP 429");
    expect(vi.mocked(fetch).mock.calls[2][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("caches metadata requests", async () => {
    await searchFilings("AAPL");
    await searchFilings("AAPL");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not select a text-search decoy for an unknown ticker", async () => {
    expect(await searchFilings("UNKNOWN")).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("propagates selection transport failures instead of returning empty success", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    await expect(searchFilings("AAPL")).rejects.toThrow("offline");
  });
});
