import { describe, expect, it } from "vitest";
import {
  resolveOptionsScreenerSlots,
  resolvePortfolioSlots,
} from "../../../src/routing/slot-resolver.js";
import type { ExtractedEntities } from "../../../src/routing/types.js";

describe("resolvePortfolioSlots", () => {
  it("uses user-provided position count and concentration cap", () => {
    const result = resolvePortfolioSlots({
      symbols: [],
      budget: 100_000,
      assetScope: "stocks_only",
      positionCount: 8,
      maxSinglePositionPct: 15,
    });

    expect(result.resolved.positionCount).toBe(8);
    expect(result.resolved.maxSinglePositionPct).toBe(15);
    expect(result.sources.positionCount).toBe("user");
    expect(result.sources.maxSinglePositionPct).toBe("user");
  });
  it("uses budget from entities and defaults for the rest", () => {
    const entities: ExtractedEntities = {
      symbols: [],
      budget: 10_000,
    };
    const result = resolvePortfolioSlots(entities);

    expect(result.resolved.budget).toBe(10_000);
    expect(result.sources.budget).toBe("user");
    expect(result.resolved.riskProfile).toBe("balanced");
    expect(result.sources.riskProfile).toBe("default");
    expect(result.resolved.timeHorizon).toBe("1y_plus");
    expect(result.sources.timeHorizon).toBe("default");
    expect(result.resolved.positionCount).toBe(6);
    expect(result.sources.positionCount).toBe("default");
    expect(result.resolved.maxSinglePositionPct).toBe(20);
    expect(result.sources.maxSinglePositionPct).toBe("default");
  });

  it("uses risk profile from entities when provided", () => {
    const entities: ExtractedEntities = {
      symbols: [],
      budget: 5_000,
      riskProfile: "conservative",
    };
    const result = resolvePortfolioSlots(entities);

    expect(result.resolved.riskProfile).toBe("conservative");
    expect(result.sources.riskProfile).toBe("user");
  });

  it("uses risk profile from preferences over default", () => {
    const entities: ExtractedEntities = {
      symbols: [],
      budget: 5_000,
    };
    const preferences = { riskProfile: "aggressive" };
    const result = resolvePortfolioSlots(entities, preferences);

    expect(result.resolved.riskProfile).toBe("aggressive");
    expect(result.sources.riskProfile).toBe("preference");
  });

  it("user input takes priority over preferences", () => {
    const entities: ExtractedEntities = {
      symbols: [],
      budget: 5_000,
      riskProfile: "conservative",
    };
    const preferences = { riskProfile: "aggressive" };
    const result = resolvePortfolioSlots(entities, preferences);

    expect(result.resolved.riskProfile).toBe("conservative");
    expect(result.sources.riskProfile).toBe("user");
  });

  it("flags missing required slot when no budget", () => {
    const entities: ExtractedEntities = { symbols: [] };
    const result = resolvePortfolioSlots(entities);

    expect(result.missingRequired).toContain("budget");
  });

  it("tracks which defaults were used", () => {
    const entities: ExtractedEntities = {
      symbols: [],
      budget: 10_000,
    };
    const result = resolvePortfolioSlots(entities);

    expect(result.defaultsUsed).toContain("riskProfile");
    expect(result.defaultsUsed).toContain("timeHorizon");
    expect(result.defaultsUsed).toContain("assetScope");
    expect(result.defaultsUsed).toContain("positionCount");
    expect(result.defaultsUsed).toContain("maxSinglePositionPct");
    expect(result.defaultsUsed).not.toContain("budget");
  });

  it("uses time horizon from entities", () => {
    const entities: ExtractedEntities = {
      symbols: [],
      budget: 10_000,
      timeHorizon: "short",
    };
    const result = resolvePortfolioSlots(entities);

    expect(result.resolved.timeHorizon).toBe("short");
    expect(result.sources.timeHorizon).toBe("user");
    expect(result.defaultsUsed).not.toContain("timeHorizon");
  });

  it("uses asset scope from entities", () => {
    const entities: ExtractedEntities = {
      symbols: [],
      budget: 25_000,
      assetScope: "etf_focused",
    };
    const result = resolvePortfolioSlots(entities);

    expect(result.resolved.assetScope).toBe("etf_focused");
    expect(result.sources.assetScope).toBe("user");
    expect(result.defaultsUsed).not.toContain("assetScope");
  });
});

describe("resolveOptionsScreenerSlots", () => {
  it("uses symbol and direction from entities, defaults for the rest", () => {
    const entities: ExtractedEntities = {
      symbols: ["MSFT"],
      direction: "bullish",
      dteHint: "month",
    };
    const result = resolveOptionsScreenerSlots(entities);

    expect(result.resolved.symbol).toBe("MSFT");
    expect(result.sources.symbol).toBe("user");
    expect(result.resolved.direction).toBe("bullish");
    expect(result.sources.direction).toBe("user");
    expect(result.resolved.dteTarget).toBe("25_to_45_days");
    expect(result.sources.dteTarget).toBe("user");
    expect(result.resolved.objective).toBe("balanced_leverage_and_probability");
  });

  it("flags missing required slot when no symbol", () => {
    const entities: ExtractedEntities = {
      symbols: [],
      direction: "bullish",
    };
    const result = resolveOptionsScreenerSlots(entities);

    expect(result.missingRequired).toContain("symbol");
  });

  it("defaults direction to bullish when not specified", () => {
    const entities: ExtractedEntities = {
      symbols: ["AAPL"],
    };
    const result = resolveOptionsScreenerSlots(entities);

    expect(result.resolved.direction).toBe("bullish");
    expect(result.sources.direction).toBe("default");
  });

  it("tracks defaults used", () => {
    const entities: ExtractedEntities = {
      symbols: ["MSFT"],
      direction: "bullish",
    };
    const result = resolveOptionsScreenerSlots(entities);

    expect(result.defaultsUsed).toContain("dteTarget");
    expect(result.defaultsUsed).toContain("objective");
    expect(result.defaultsUsed).not.toContain("symbol");
    expect(result.defaultsUsed).not.toContain("direction");
  });

  it("uses DTE preference when no user hint is present", () => {
    const entities: ExtractedEntities = {
      symbols: ["MSFT"],
      direction: "bullish",
    };
    const preferences = { dteTarget: "180_plus_days" };
    const result = resolveOptionsScreenerSlots(entities, preferences);

    expect(result.resolved.dteTarget).toBe("180_plus_days");
    expect(result.sources.dteTarget).toBe("preference");
  });

  it("maps natural short-dated router hints to 7_to_14_days", () => {
    for (const dteHint of ["1-2 weeks", "one to two weeks", "1 or 2 weeks out", "one-two weeks"]) {
      const result = resolveOptionsScreenerSlots({
        symbols: ["MSFT"],
        direction: "bullish",
        dteHint,
      });

      expect(result.resolved.dteTarget).toBe("7_to_14_days");
      expect(result.sources.dteTarget).toBe("user");
    }
  });

  it("preserves an explicit maximum DTE window", () => {
    const result = resolveOptionsScreenerSlots({
      symbols: ["AAPL"],
      direction: "bullish",
      dteHint: "0-60 days",
    });

    expect(result.resolved.dteTarget).toBe("0_to_60_days");
    expect(result.sources.dteTarget).toBe("user");
  });

  it("passes through covered-call strategy and cost basis", () => {
    const result = resolveOptionsScreenerSlots({
      symbols: ["MSFT"],
      direction: "bullish",
      optionStrategy: "covered_call",
      costBasis: 123.45,
    });

    expect(result.resolved.optionStrategy).toBe("covered_call");
    expect(result.sources.optionStrategy).toBe("user");
    expect(result.resolved.costBasis).toBe(123.45);
    expect(result.sources.costBasis).toBe("user");
  });

  it("infers bearish direction and share quantity for protective-put hedges", () => {
    const result = resolveOptionsScreenerSlots({
      symbols: ["NVDA"],
      optionStrategy: "protective_put",
      shareQuantity: 200,
      dteHint: "30-45 days",
    });

    expect(result.resolved.direction).toBe("bearish");
    expect(result.sources.direction).toBe("user");
    expect(result.resolved.optionStrategy).toBe("protective_put");
    expect(result.sources.optionStrategy).toBe("user");
    expect(result.resolved.shareQuantity).toBe(200);
    expect(result.sources.shareQuantity).toBe("user");
    expect(result.resolved.dteTarget).toBe("30_to_45_days");
  });

  it("passes through extracted premium cap", () => {
    const entities: ExtractedEntities = {
      symbols: ["NVDA"],
      direction: "bullish",
      maxPremium: 500,
    };
    const result = resolveOptionsScreenerSlots(entities);

    expect(result.resolved.maxPremium).toBe(500);
  });

  it("preserves covered-call cost basis, catalyst context, and event-week DTE", () => {
    const entities: ExtractedEntities = {
      symbols: ["DRAM", "NVDA"],
      heldSymbol: "DRAM",
      catalystSymbols: ["NVDA"],
      direction: "bullish",
      dteHint: "event_week",
      costBasis: 51,
    };
    const result = resolveOptionsScreenerSlots(entities);

    expect(result.resolved.symbol).toBe("DRAM");
    expect(result.resolved.costBasis).toBe(51);
    expect(result.resolved.catalystSymbols).toEqual(["NVDA"]);
    expect(result.resolved.dteTarget).toBe("0_to_7_days");
    expect(result.sources.costBasis).toBe("user");
    expect(result.sources.catalystSymbols).toBe("user");
  });

  it("uses the held symbol as the options underlying when catalyst tickers appear first", () => {
    const entities: ExtractedEntities = {
      symbols: ["NVDA", "AMD"],
      heldSymbol: "AMD",
      catalystSymbols: ["NVDA"],
      optionStrategy: "protective_put",
      shareQuantity: 200,
      direction: "bearish",
      dteHint: "month",
    };
    const result = resolveOptionsScreenerSlots(entities);

    expect(result.resolved.symbol).toBe("AMD");
    expect(result.resolved.catalystSymbols).toEqual(["NVDA"]);
    expect(result.resolved.optionStrategy).toBe("protective_put");
    expect(result.resolved.shareQuantity).toBe(200);
    expect(result.resolved.dteTarget).toBe("25_to_45_days");
  });
});
