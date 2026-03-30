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
});
