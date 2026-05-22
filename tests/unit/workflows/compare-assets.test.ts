import { describe, expect, it } from "vitest";
import { buildCompareAssetsWorkflow } from "../../../src/workflows/compare-assets.js";
import type { CompareAssetsSlots, SlotResolution } from "../../../src/routing/types.js";

function makeResolution(
  overrides: Partial<CompareAssetsSlots> = {},
): SlotResolution<CompareAssetsSlots> {
  return {
    resolved: {
      symbols: ["AAPL", "MSFT"],
      ...overrides,
    },
    sources: {
      symbols: "user",
    },
    defaultsUsed: [],
    missingRequired: [],
  };
}

describe("buildCompareAssetsWorkflow", () => {
  it("includes compare tool instructions in the initial prompt", () => {
    const workflow = buildCompareAssetsWorkflow(makeResolution());
    expect(workflow.initialPrompt).toContain("compare_companies");
    expect(workflow.initialPrompt).toContain("AAPL");
    expect(workflow.initialPrompt).toContain("MSFT");
  });

  it("includes fallback guidance for unavailable fundamentals", () => {
    const workflow = buildCompareAssetsWorkflow(makeResolution());
    expect(workflow.followUps[0]).toContain("unavailable fundamentals");
    expect(workflow.followUps[0]).toContain("price, technical, and risk data");
  });

  it("adds sentiment tool instructions when the comparison asks for sentiment", () => {
    const workflow = buildCompareAssetsWorkflow(makeResolution({ metrics: ["sentiment"] }));
    expect(workflow.initialPrompt).toContain("get_sentiment_summary");
    expect(workflow.initialPrompt).toContain("sentiment");
    expect(workflow.followUps[0]).toContain("sentiment");
  });

  it("adds macro hedge synthesis guidance when the comparison asks for hedging", () => {
    const workflow = buildCompareAssetsWorkflow(makeResolution({
      symbols: ["BTC", "GLD"],
      timeHorizon: "6mo",
      metrics: ["macro_hedge"],
    }));

    expect(workflow.initialPrompt).toContain("macro hedge");
    expect(workflow.initialPrompt).toContain("real yields");
    expect(workflow.followUps[0]).toContain("hedge role");
    expect(workflow.followUps[0]).toContain("conditions under which");
  });

  it("adds rate-scenario synthesis guidance for interest-rate comparisons", () => {
    const workflow = buildCompareAssetsWorkflow(makeResolution({
      symbols: ["SPY", "QQQ"],
      timeHorizon: "12mo",
      metrics: ["interest_rates"],
    }));

    expect(workflow.initialPrompt).toContain("interest-rate comparison guidance");
    expect(workflow.initialPrompt).toContain("Fed funds backdrop");
    expect(workflow.followUps[0]).toContain("benign falling rates");
    expect(workflow.followUps[0]).toContain("recessionary cuts");
    expect(workflow.followUps[0]).toContain("sector-exposure risk");
    expect(workflow.followUps[0]).toContain("historical/current data");
  });
});
