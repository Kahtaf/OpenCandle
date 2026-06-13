import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/finnhub/company-news.json";

describe("FinnhubAdapter", () => {
  describe("mapToRecords", () => {
    it("maps FinnhubArticle to SentinelRecord with source 'finnhub'", async () => {
      const { FinnhubAdapter } = await import("../../../src/sentiment/adapters/finnhub.js");
      const adapter = new FinnhubAdapter();
      const records = adapter.mapToRecords(fixture.slice(0, 1), "AAPL");

      expect(records).toHaveLength(1);
      const r = records[0];
      expect(r.source).toBe("finnhub");
      expect(r.sourceId).toBe(String(fixture[0].id));
      expect(r.title).toBe(fixture[0].headline);
      expect(r.text).toBe(fixture[0].summary);
      expect(r.author).toBe(fixture[0].source);
      expect(r.url).toBe(fixture[0].url);
    });

    it("converts UNIX datetime to ISO 8601 publishedAt", async () => {
      const { FinnhubAdapter } = await import("../../../src/sentiment/adapters/finnhub.js");
      const adapter = new FinnhubAdapter();
      const records = adapter.mapToRecords(fixture.slice(0, 1), "AAPL");

      expect(records[0].publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const parsed = new Date(records[0].publishedAt!);
      expect(parsed.getTime()).toBe(fixture[0].datetime * 1000);
    });

    it("populates sentiment.tickers from related field", async () => {
      const { FinnhubAdapter } = await import("../../../src/sentiment/adapters/finnhub.js");
      const adapter = new FinnhubAdapter();
      const records = adapter.mapToRecords(fixture.slice(0, 1), "AAPL");

      expect(records[0].sentiment.tickers).toContain("AAPL");
    });

    it("sets engagement to zeros", async () => {
      const { FinnhubAdapter } = await import("../../../src/sentiment/adapters/finnhub.js");
      const adapter = new FinnhubAdapter();
      const records = adapter.mapToRecords(fixture.slice(0, 1), "AAPL");

      expect(records[0].engagement).toEqual({
        score: 0,
        replies: null,
        shares: null,
        views: null,
      });
    });

    it("returns empty array for empty input", async () => {
      const { FinnhubAdapter } = await import("../../../src/sentiment/adapters/finnhub.js");
      const adapter = new FinnhubAdapter();
      const records = adapter.mapToRecords([], "AAPL");
      expect(records).toEqual([]);
    });

    it("includes metadata.category from article", async () => {
      const { FinnhubAdapter } = await import("../../../src/sentiment/adapters/finnhub.js");
      const adapter = new FinnhubAdapter();
      const records = adapter.mapToRecords(fixture.slice(0, 1), "AAPL");
      expect(records[0].metadata.category).toBe("company");
    });
  });

  describe("extractTickersFromQuery", () => {
    it("extracts bare ticker", async () => {
      const { extractTickersFromQuery } = await import(
        "../../../src/sentiment/adapters/finnhub.js"
      );
      expect(extractTickersFromQuery("AAPL")).toEqual(["AAPL"]);
    });

    it("extracts cashtag", async () => {
      const { extractTickersFromQuery } = await import(
        "../../../src/sentiment/adapters/finnhub.js"
      );
      expect(extractTickersFromQuery("$TSLA")).toEqual(["TSLA"]);
    });

    it("extracts ticker from phrase", async () => {
      const { extractTickersFromQuery } = await import(
        "../../../src/sentiment/adapters/finnhub.js"
      );
      const result = extractTickersFromQuery("is AAPL overvalued");
      expect(result).toContain("AAPL");
    });

    it("returns empty for non-ticker query", async () => {
      const { extractTickersFromQuery } = await import(
        "../../../src/sentiment/adapters/finnhub.js"
      );
      expect(extractTickersFromQuery("tariff impact on tech sector")).toEqual([]);
    });

    it("extracts multiple tickers", async () => {
      const { extractTickersFromQuery } = await import(
        "../../../src/sentiment/adapters/finnhub.js"
      );
      const result = extractTickersFromQuery("AAPL vs MSFT");
      expect(result).toContain("AAPL");
      expect(result).toContain("MSFT");
    });

    it("caps at 3 tickers", async () => {
      const { extractTickersFromQuery } = await import(
        "../../../src/sentiment/adapters/finnhub.js"
      );
      const result = extractTickersFromQuery("AAPL MSFT GOOGL NVDA TSLA");
      expect(result.length).toBeLessThanOrEqual(3);
    });
  });
});
