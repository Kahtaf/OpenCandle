import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildPortfolioWorkflow } from "../../../src/workflows/portfolio-builder.js";
import type { PortfolioSlots, SlotResolution } from "../../../src/routing/types.js";

function makeResolution(overrides: Partial<PortfolioSlots> = {}): SlotResolution<PortfolioSlots> {
  const resolved: PortfolioSlots = {
    budget: 10_000,
    riskProfile: "balanced",
    timeHorizon: "1y_plus",
    assetScope: "mixed_etf_and_large_cap_equities",
    positionCount: 4,
    maxSinglePositionPct: 35,
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

describe("buildPortfolioWorkflow", () => {
  it("returns initial prompt and follow-up messages", () => {
    const workflow = buildPortfolioWorkflow(makeResolution());
    expect(workflow.initialPrompt).toBeTruthy();
    expect(workflow.initialPrompt).toContain("$10,000");
    expect(workflow.followUps).toBeInstanceOf(Array);
    expect(workflow.followUps.length).toBeGreaterThanOrEqual(1);
  });

  it("initial prompt contains tool instructions", () => {
    const workflow = buildPortfolioWorkflow(makeResolution());
    expect(workflow.initialPrompt).toContain("get_stock_quote");
  });

  it("follow-up messages include risk check", () => {
    const workflow = buildPortfolioWorkflow(makeResolution());
    const riskFollowUp = workflow.followUps.find((f) =>
      f.toLowerCase().includes("risk") || f.toLowerCase().includes("diversif"),
    );
    expect(riskFollowUp).toBeTruthy();
  });

  it("follow-up messages include structured presentation", () => {
    const workflow = buildPortfolioWorkflow(makeResolution());
    const presentFollowUp = workflow.followUps.find((f) =>
      f.toLowerCase().includes("assumption") || f.toLowerCase().includes("table"),
    );
    expect(presentFollowUp).toBeTruthy();
  });

  it("follow-up prompts include length constraints", () => {
    const workflow = buildPortfolioWorkflow(makeResolution());
    const presentFollowUp = workflow.followUps.find((f) => f.includes("40 lines"));
    expect(presentFollowUp).toBeTruthy();
    expect(presentFollowUp).toContain("1 sentence");
    expect(presentFollowUp).toContain("3 bullet");
  });
});
