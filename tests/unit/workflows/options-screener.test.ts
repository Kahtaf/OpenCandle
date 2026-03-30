import { describe, it, expect } from "vitest";
import { buildOptionsScreenerWorkflow } from "../../../src/workflows/options-screener.js";
import type { OptionsScreenerSlots, SlotResolution } from "../../../src/routing/types.js";

function makeResolution(overrides: Partial<OptionsScreenerSlots> = {}): SlotResolution<OptionsScreenerSlots> {
  const resolved: OptionsScreenerSlots = {
    symbol: "MSFT",
    direction: "bullish",
    dteTarget: "25_to_45_days",
    objective: "balanced_leverage_and_probability",
    moneynessPreference: "atm_to_slightly_otm",
    liquidityMinimum: "high_open_interest_and_tight_spread",
    ...overrides,
  };
  return {
    resolved,
    sources: {
      symbol: "user",
      direction: "user",
      dteTarget: "default",
      objective: "default",
      moneynessPreference: "default",
      liquidityMinimum: "default",
    },
    defaultsUsed: ["dteTarget", "objective", "moneynessPreference", "liquidityMinimum"],
    missingRequired: [],
  };
}

describe("buildOptionsScreenerWorkflow", () => {
  it("returns initial prompt with symbol", () => {
    const workflow = buildOptionsScreenerWorkflow(makeResolution());
    expect(workflow.initialPrompt).toContain("MSFT");
  });

  it("initial prompt contains get_option_chain instruction", () => {
    const workflow = buildOptionsScreenerWorkflow(makeResolution());
    expect(workflow.initialPrompt).toContain("get_option_chain");
  });

  it("returns follow-up for ranking presentation", () => {
    const workflow = buildOptionsScreenerWorkflow(makeResolution());
    expect(workflow.followUps.length).toBeGreaterThanOrEqual(1);
    const rankFollowUp = workflow.followUps.find((f) =>
      f.toLowerCase().includes("rank") || f.toLowerCase().includes("top"),
    );
    expect(rankFollowUp).toBeTruthy();
  });

  it("handles bearish direction", () => {
    const workflow = buildOptionsScreenerWorkflow(
      makeResolution({ direction: "bearish" }),
    );
    expect(workflow.initialPrompt).toContain("bearish");
  });

  it("follow-up prompt includes delta floor", () => {
    const workflow = buildOptionsScreenerWorkflow(makeResolution());
    const followUp = workflow.followUps[0];
    expect(followUp).toContain("0.20");
  });

  it("follow-up prompt includes length constraints", () => {
    const workflow = buildOptionsScreenerWorkflow(makeResolution());
    const followUp = workflow.followUps[0];
    expect(followUp).toContain("30 lines");
  });
});
