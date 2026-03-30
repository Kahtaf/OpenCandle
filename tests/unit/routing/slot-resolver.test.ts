import { describe, it, expect } from "vitest";
import {
  resolvePortfolioSlots,
  resolveOptionsScreenerSlots,
} from "../../../src/routing/slot-resolver.js";
import type { ExtractedEntities } from "../../../src/routing/types.js";

describe("resolvePortfolioSlots", () => {
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
    expect(result.resolved.positionCount).toBe(4);
    expect(result.sources.positionCount).toBe("default");
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

  it("passes through extracted premium cap", () => {
    const entities: ExtractedEntities = {
      symbols: ["NVDA"],
      direction: "bullish",
      maxPremium: 500,
    };
    const result = resolveOptionsScreenerSlots(entities);

    expect(result.resolved.maxPremium).toBe(500);
  });
});
