import { describe, it, expect } from "vitest";
import { buildPortfolioWorkflowDefinition } from "../../../src/workflows/portfolio-builder.js";
import type { PortfolioSlots, SlotResolution } from "../../../src/routing/types.js";

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
    defaultsUsed: ["riskProfile", "timeHorizon", "assetScope", "positionCount", "maxSinglePositionPct"],
    missingRequired: [],
  };
}

function promptAt(index: number, resolution = makeResolution()): string {
  return buildPortfolioWorkflowDefinition(resolution).steps[index]?.prompt ?? "";
}

function followUpPrompts(resolution = makeResolution()): string[] {
  return buildPortfolioWorkflowDefinition(resolution).steps.slice(1).map((step) => step.prompt);
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
    const riskFollowUp = followUpPrompts().find((f) =>
      f.toLowerCase().includes("risk") || f.toLowerCase().includes("diversif"),
    );
    expect(riskFollowUp).toBeTruthy();
  });

  it("follow-up messages include structured presentation", () => {
    const presentFollowUp = followUpPrompts().find((f) =>
      f.toLowerCase().includes("assumption") || f.toLowerCase().includes("table"),
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
    expect(riskReview).toBeDefined();
    expect(riskReview!.prompt).toContain("risk metrics undermine its intended role");
    expect(riskReview!.prompt).toContain("lower its allocation");
    expect(riskReview!.prompt).toContain("role-equivalent candidate");
  });

  it("synthesis table includes price, shares, role, and concise rationale guidance", () => {
    const def = buildPortfolioWorkflowDefinition(makeResolution());
    const synthesize = def.steps.find((s) => s.stepType === "synthesize");
    expect(synthesize).toBeDefined();
    expect(synthesize!.prompt).toContain("current price used");
    expect(synthesize!.prompt).toContain("estimated shares");
    expect(synthesize!.prompt).toContain("role");
    expect(synthesize!.prompt).toContain("do not paste company descriptions");
    expect(synthesize!.prompt).toContain("Why this fits the horizon");
    expect(synthesize!.prompt).toContain("rebalance cadence");
    expect(synthesize!.prompt).toContain("tax/account caveats");
  });

  it("synthesis step does not emit disclaimer directive", () => {
    const def = buildPortfolioWorkflowDefinition(makeResolution());
    const synthesize = def.steps.find((s) => s.stepType === "synthesize");
    expect(synthesize).toBeDefined();
    expect(synthesize!.prompt).not.toMatch(/standard disclaimer/i);
    expect(synthesize!.prompt).not.toMatch(/end with the standard/i);
    expect(synthesize!.prompt).not.toMatch(/\bdisclaimer\b/i);
    expect(synthesize!.prompt).not.toMatch(/not financial advice/i);
  });
});
