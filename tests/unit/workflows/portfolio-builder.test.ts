import { describe, expect, it } from "vitest";
import type { PortfolioSlots, SlotResolution } from "../../../src/routing/types.js";
import { buildPortfolioWorkflowDefinition } from "../../../src/workflows/portfolio-builder.js";

function makeResolution(overrides: Partial<PortfolioSlots> = {}): SlotResolution<PortfolioSlots> {
  const resolved: PortfolioSlots = {
    budget: 10_000,
    riskProfile: "balanced",
    timeHorizon: "1y_plus",
    assetScope: "diversified_etf_building_blocks",
    positionCount: 6,
    maxSinglePositionPct: 20,
    ...overrides,
  };
  return {
    resolved,
    sources: {
      budget: "user",
      riskProfile: "default",
      timeHorizon: "default",
      assetScope: "default",
      positionCount: "default",
      maxSinglePositionPct: "default",
    },
    defaultsUsed: [
      "riskProfile",
      "timeHorizon",
      "assetScope",
      "positionCount",
      "maxSinglePositionPct",
    ],
    missingRequired: [],
  };
}

function promptAt(index: number, resolution = makeResolution()): string {
  return buildPortfolioWorkflowDefinition(resolution).steps[index]?.prompt ?? "";
}

function followUpPrompts(resolution = makeResolution()): string[] {
  return buildPortfolioWorkflowDefinition(resolution)
    .steps.slice(1)
    .map((step) => step.prompt);
}

describe("buildPortfolioWorkflowDefinition", () => {
  it("returns initial prompt and follow-up messages", () => {
    const def = buildPortfolioWorkflowDefinition(makeResolution());
    expect(def.steps[0].prompt).toBeTruthy();
    expect(def.steps[0].prompt).toContain("$10,000");
    expect(def.steps.slice(1)).toBeInstanceOf(Array);
    expect(def.steps.slice(1).length).toBeGreaterThanOrEqual(1);
  });

  it("initial prompt contains tool instructions", () => {
    expect(promptAt(0)).toContain("get_stock_quote");
  });

  it("follow-up messages include risk check", () => {
    const riskFollowUp = followUpPrompts().find(
      (f) => f.toLowerCase().includes("risk") || f.toLowerCase().includes("diversif"),
    );
    expect(riskFollowUp).toBeTruthy();
  });

  it("follow-up messages include structured presentation", () => {
    const presentFollowUp = followUpPrompts().find(
      (f) => f.toLowerCase().includes("assumption") || f.toLowerCase().includes("table"),
    );
    expect(presentFollowUp).toBeTruthy();
  });

  it("follow-up prompts include length constraints", () => {
    const presentFollowUp = followUpPrompts().find((f) => f.includes("40 lines"));
    expect(presentFollowUp).toBeTruthy();
    expect(presentFollowUp).toContain("1 sentence");
    expect(presentFollowUp).toContain("3 bullet");
  });

  it("risk review asks the agent to address metrics that conflict with a holding role", () => {
    const def = buildPortfolioWorkflowDefinition(makeResolution());
    const riskReview = def.steps.find((s) => s.stepType === "risk_review");
    if (!riskReview) throw new Error("Expected risk review step");
    expect(riskReview.prompt).toContain("risk metrics undermine its intended role");
    expect(riskReview.prompt).toContain("lower its allocation");
    expect(riskReview.prompt).toContain("role-equivalent candidate");
  });

  it("synthesis table includes price, shares, role, and concise rationale guidance", () => {
    const def = buildPortfolioWorkflowDefinition(makeResolution());
    const synthesize = def.steps.find((s) => s.stepType === "synthesize");
    if (!synthesize) throw new Error("Expected synthesize step");
    expect(synthesize.prompt).toContain("current price used");
    expect(synthesize.prompt).toContain("estimated shares");
    expect(synthesize.prompt).toContain("role");
    expect(synthesize.prompt).toContain("do not paste company descriptions");
    expect(synthesize.prompt).toContain("Why this fits the horizon");
    expect(synthesize.prompt).toContain("rebalance cadence");
    expect(synthesize.prompt).toContain("tax/account caveats");
  });

  it("preserves hard portfolio constraints through every workflow step", () => {
    const def = buildPortfolioWorkflowDefinition(
      makeResolution({ assetScope: "stocks_only", positionCount: 8, maxSinglePositionPct: 15 }),
    );

    expect(def.steps[0]?.prompt).toContain("exactly 8 individual listed common-stock candidates");
    expect(def.steps[0]?.prompt).toContain("allocations sum to 100%");
    expect(def.steps[0]?.prompt).toContain("at or below 15%");
    expect(def.steps[1]?.prompt).toContain('asset scope "stocks_only"');
    expect(def.steps[1]?.prompt).toContain("exactly 8 positions");
    expect(def.steps[2]?.prompt).toContain("no position above 15%");
    expect(def.steps[2]?.prompt).toContain("allocations summing to 100%");
  });

  it("allows an incompatibility explanation when the hard allocation constraints cannot sum to 100%", () => {
    const def = buildPortfolioWorkflowDefinition(
      makeResolution({ positionCount: 8, maxSinglePositionPct: 10 }),
    );

    expect(def.steps[2]?.prompt).toContain("mathematically incompatible");
    expect(def.steps[2]?.outputValidation).toBeUndefined();
  });

  it("keeps crypto positions out of stock-only risk and correlation tools", () => {
    const def = buildPortfolioWorkflowDefinition(
      makeResolution({ assetScope: "stocks_and_crypto" }),
    );
    const riskReview = def.steps.find((step) => step.stepType === "risk_review");

    expect(riskReview?.prompt).toContain("get_crypto_history");
    expect(riskReview?.prompt).toContain("Use analyze_correlation only across the stock positions");
    expect(riskReview?.prompt).toContain("Do not send cryptocurrencies to stock-only");
  });

  it("synthesis step does not emit disclaimer directive", () => {
    const def = buildPortfolioWorkflowDefinition(makeResolution());
    const synthesize = def.steps.find((s) => s.stepType === "synthesize");
    if (!synthesize) throw new Error("Expected synthesize step");
    expect(synthesize.prompt).not.toMatch(/standard disclaimer/i);
    expect(synthesize.prompt).not.toMatch(/end with the standard/i);
    expect(synthesize.prompt).not.toMatch(/\bdisclaimer\b/i);
    expect(synthesize.prompt).not.toMatch(/not financial advice/i);
  });
});
