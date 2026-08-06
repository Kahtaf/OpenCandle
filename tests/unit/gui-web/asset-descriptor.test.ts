import { describe, expect, it } from "vitest";
import {
  ASSET_TYPES,
  assetDescriptor,
  descriptorHasSection,
  resolveAssetDescriptor,
  resolveAssetType,
} from "../../../gui/web/src/features/symbol/asset-descriptor.js";

describe("resolveAssetType", () => {
  it("maps provider quote types onto the page's own vocabulary", () => {
    expect(resolveAssetType({ quoteType: "EQUITY" })).toBe("stock");
    expect(resolveAssetType({ quoteType: "ETF" })).toBe("etf");
    expect(resolveAssetType({ quoteType: "MUTUALFUND" })).toBe("etf");
    expect(resolveAssetType({ quoteType: "CRYPTOCURRENCY" })).toBe("crypto");
    expect(resolveAssetType({ quoteType: "CURRENCY" })).toBe("fx");
    expect(resolveAssetType({ quoteType: "INDEX" })).toBe("index");
    expect(resolveAssetType({ quoteType: "FUTURE" })).toBe("commodity");
  });

  it("maps saved instrument asset types too", () => {
    expect(resolveAssetType({ assetType: "equity" })).toBe("stock");
    expect(resolveAssetType({ assetType: "crypto" })).toBe("crypto");
    expect(resolveAssetType({ assetType: "index" })).toBe("index");
    expect(resolveAssetType({ assetType: "fund" })).toBe("etf");
  });

  it("returns unknown for anything it cannot place", () => {
    expect(resolveAssetType({ quoteType: "OPTION" })).toBe("unknown");
    expect(resolveAssetType({})).toBe("unknown");
    expect(resolveAssetType()).toBe("unknown");
  });
});

describe("assetDescriptor", () => {
  it("declares a descriptor for every supported type", () => {
    expect(ASSET_TYPES).toEqual(["stock", "etf", "crypto", "fx", "index", "commodity", "unknown"]);
    for (const type of ASSET_TYPES) {
      const descriptor = assetDescriptor(type);
      expect(descriptor.type).toBe(type);
      expect(descriptor.sections).toContain("hero");
      expect(descriptor.sections).toContain("chart");
      // Saved context belongs to every instrument, whatever it turns out to be.
      expect(descriptor.sections).toEqual(
        expect.arrayContaining(["position", "alerts", "watchlist"]),
      );
      for (const stat of descriptor.stats) expect(descriptor.statLabels[stat]).toBeTruthy();
    }
  });

  it("gives equities fundamentals and the equity stat vocabulary", () => {
    const descriptor = assetDescriptor("stock");
    expect(descriptor.stats).toEqual([
      "week",
      "month",
      "ytd",
      "year",
      "fromHigh52w",
      "dayRange",
      "volume",
    ]);
    expect(descriptor.statLabels.week).toBe("5D");
    expect(descriptor.statLabels.dayRange).toBe("Day range");
    expect(descriptorHasSection(descriptor, "keyStats")).toBe(true);
    expect(descriptor.availabilityNote).toBeNull();
    expect(descriptor.continuousTrading).toBe(false);
  });

  it("swaps crypto vocabulary and drops the fundamentals sections", () => {
    const descriptor = assetDescriptor("crypto");
    expect(descriptor.statLabels.week).toBe("1W");
    expect(descriptor.statLabels.dayRange).toBe("24h range");
    expect(descriptor.stats).toContain("volume");
    expect(descriptorHasSection(descriptor, "keyStats")).toBe(false);
    expect(descriptorHasSection(descriptor, "about")).toBe(false);
    expect(descriptorHasSection(descriptor, "keyLevels")).toBe(true);
    expect(descriptor.availabilityNote).toBe(
      "Fundamental stats are not available for crypto assets.",
    );
    expect(descriptor.continuousTrading).toBe(true);
  });

  it("drops volume for instruments that do not report one", () => {
    expect(assetDescriptor("fx").stats).not.toContain("volume");
    expect(assetDescriptor("index").stats).not.toContain("volume");
    expect(assetDescriptor("commodity").stats).toContain("volume");
    expect(assetDescriptor("fx").availabilityNote).toBe(
      "Fundamental stats are not available for currency pairs.",
    );
    expect(assetDescriptor("index").availabilityNote).toBe(
      "Fundamental stats are not available for market indices.",
    );
    expect(assetDescriptor("commodity").availabilityNote).toBe(
      "Fundamental stats are not available for commodity futures.",
    );
  });

  it("keeps the unknown type to quote, chart and saved context", () => {
    const descriptor = assetDescriptor("unknown");
    expect(descriptor.sections).toEqual(["hero", "chart", "position", "alerts", "watchlist"]);
    expect(descriptor.stats).toEqual([]);
    expect(descriptor.availabilityNote).toBe(
      "Further detail is not available for this instrument.",
    );
  });

  it("falls back to the unknown descriptor for an unrecognised type", () => {
    expect(assetDescriptor("penny-stock").type).toBe("unknown");
    expect(assetDescriptor().type).toBe("unknown");
  });

  it("writes no em dash in any descriptor copy", () => {
    for (const type of ASSET_TYPES) {
      const descriptor = assetDescriptor(type);
      const copy = [
        descriptor.typeLabel,
        descriptor.availabilityNote,
        descriptor.sessionLabel,
        ...Object.values(descriptor.statLabels),
      ];
      for (const line of copy) expect(String(line ?? "")).not.toContain("—");
    }
  });
});

describe("resolveAssetDescriptor", () => {
  it("resolves from an exactly matching search candidate", () => {
    const descriptor = resolveAssetDescriptor({
      symbol: "AAPL",
      searchCandidates: [
        { symbol: "AAPL", quoteType: "EQUITY", assetType: "equity" },
        { symbol: "AAPL.MX", quoteType: "CRYPTOCURRENCY", assetType: "crypto" },
      ],
    });
    expect(descriptor.type).toBe("stock");
    expect(descriptor.typeLabel).toBe("Stock");
  });

  it("does not misclassify an FX pair as an equity", () => {
    // The shared candidate `assetType` collapses currency pairs into `equity`;
    // the page reads the provider quote type instead.
    const descriptor = resolveAssetDescriptor({
      symbol: "EURUSD=X",
      searchCandidates: [{ symbol: "EURUSD=X", quoteType: "CURRENCY", assetType: "equity" }],
    });
    expect(descriptor.type).toBe("fx");
    expect(descriptor.typeLabel).toBe("FX");
    expect(descriptor.stats).not.toContain("volume");
    expect(descriptorHasSection(descriptor, "keyStats")).toBe(false);
  });

  it("resolves an index and a non-USD crypto pair from metadata, not the ticker string", () => {
    expect(
      resolveAssetDescriptor({
        symbol: "^GSPC",
        searchCandidates: [{ symbol: "^GSPC", quoteType: "INDEX" }],
      }).type,
    ).toBe("index");
    expect(
      resolveAssetDescriptor({
        symbol: "BTC-EUR",
        searchCandidates: [{ symbol: "BTC-EUR", quoteType: "CRYPTOCURRENCY" }],
      }).type,
    ).toBe("crypto");
  });

  it("falls back to the saved instrument record when search says nothing", () => {
    const descriptor = resolveAssetDescriptor({
      symbol: "BTC-USD",
      instrument: { symbol: "BTC-USD", assetType: "crypto" },
      searchCandidates: [],
    });
    expect(descriptor.type).toBe("crypto");
  });

  it("treats a company profile as an equity when no type metadata arrived", () => {
    const descriptor = resolveAssetDescriptor({
      symbol: "MSFT",
      overview: { status: "ok", sector: "Technology", industry: "Software" },
    });
    expect(descriptor.type).toBe("stock");
  });

  it("degrades to unknown rather than guessing", () => {
    expect(resolveAssetDescriptor({ symbol: "ZZZZ" }).type).toBe("unknown");
    expect(
      resolveAssetDescriptor({
        symbol: "ZZZZ",
        searchCandidates: [{ symbol: "OTHER", quoteType: "EQUITY" }],
      }).type,
    ).toBe("unknown");
    expect(
      resolveAssetDescriptor({ symbol: "ZZZZ", overview: { status: "unavailable" } }).type,
    ).toBe("unknown");
    expect(resolveAssetDescriptor().type).toBe("unknown");
  });
});
