import { describe, expect, it } from "vitest";
import type { CompareAssetsSlots, SlotResolution } from "../../../src/routing/types.js";
import { buildCompareAssetsWorkflowDefinition } from "../../../src/workflows/compare-assets.js";

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
      ...(overrides.timeHorizon ? { timeHorizon: "user" as const } : {}),
      ...(overrides.budget !== undefined ? { budget: "user" as const } : {}),
      ...(overrides.assetScope ? { assetScope: "user" as const } : {}),
      ...(overrides.metrics ? { metrics: "user" as const } : {}),
    },
    defaultsUsed: [],
    missingRequired: [],
  };
}

function initialPrompt(resolution = makeResolution()): string {
  return buildCompareAssetsWorkflowDefinition(resolution).steps[0].prompt;
}

function followUpPrompt(resolution = makeResolution()): string {
  return buildCompareAssetsWorkflowDefinition(resolution).steps[1].prompt;
}

describe("buildCompareAssetsWorkflowDefinition", () => {
  it("includes compare tool instructions in the initial prompt", () => {
    const prompt = initialPrompt();
    expect(prompt).toContain("compare_companies");
    expect(prompt).toContain("AAPL");
    expect(prompt).toContain("MSFT");
  });

  it("includes fallback guidance for unavailable fundamentals", () => {
    expect(buildCompareAssetsWorkflowDefinition(makeResolution()).steps).toHaveLength(2);
    expect(followUpPrompt()).toContain("unavailable fundamentals");
    expect(followUpPrompt()).toContain("price, technical, and risk data");
  });

  it("adds sentiment tool instructions when the comparison asks for sentiment", () => {
    const resolution = makeResolution({ metrics: ["sentiment"] });
    expect(initialPrompt(resolution)).toContain("get_sentiment_summary");
    expect(initialPrompt(resolution)).toContain("sentiment");
    expect(followUpPrompt(resolution)).toContain("sentiment");
  });

  it("adds macro hedge synthesis guidance when the comparison asks for hedging", () => {
    const resolution = makeResolution({
      symbols: ["BTC", "GLD"],
      timeHorizon: "6mo",
      metrics: ["macro_hedge"],
    });

    expect(initialPrompt(resolution)).toContain("macro hedge");
    expect(initialPrompt(resolution)).toContain("real yields");
    expect(followUpPrompt(resolution)).toContain("hedge role");
    expect(followUpPrompt(resolution)).toContain("conditions under which");
  });

  it("keeps macro hedge follow-up guidance generic across symbols", () => {
    const followUp = followUpPrompt(
      makeResolution({
        symbols: ["TLT", "IEF"],
        timeHorizon: "6mo",
        metrics: ["macro_hedge"],
      }),
    );

    expect(followUp).toContain("each asset");
    expect(followUp).not.toContain("BTC");
    expect(followUp).not.toContain("GLD");
  });

  it("adds rate-scenario synthesis guidance for interest-rate comparisons", () => {
    const resolution = makeResolution({
      symbols: ["SPY", "QQQ"],
      timeHorizon: "12mo",
      metrics: ["interest_rates"],
    });

    expect(initialPrompt(resolution)).toContain("interest-rate comparison guidance");
    expect(initialPrompt(resolution)).toContain("Fed funds backdrop");
    expect(followUpPrompt(resolution)).toContain("benign falling rates");
    expect(followUpPrompt(resolution)).toContain("recessionary cuts");
    expect(followUpPrompt(resolution)).toContain("sector-exposure risk");
    expect(followUpPrompt(resolution)).toContain("historical/current data");
  });

  it("keeps ETF overlap synthesis focused on holdings evidence instead of generic risk ranking", () => {
    const resolution = makeResolution({
      symbols: ["VOO", "QQQ", "SCHD"],
      metrics: ["overlap"],
    });

    expect(initialPrompt(resolution)).toContain("analyze_holdings_overlap");
    expect(followUpPrompt(resolution)).toContain("holdings-overlap");
    expect(followUpPrompt(resolution)).toContain("diversification implication");
    expect(followUpPrompt(resolution)).not.toContain("price, technical, and risk data");
    expect(followUpPrompt(resolution)).not.toContain("which asset looks strongest right now");
  });

  it("prompts long-horizon fund allocation comparisons to check holdings overlap", () => {
    const resolution = makeResolution({
      symbols: ["VYM", "SCHD", "VOO", "QQQ"],
      timeHorizon: "long",
      budget: 5000,
    });

    expect(initialPrompt(resolution)).toContain("Budget: $5,000");
    expect(initialPrompt(resolution)).toContain("analyze_holdings_overlap");
    expect(initialPrompt(resolution)).toContain("ETFs, funds, or index products");
    expect(initialPrompt(resolution)).toContain("expense ratios");
    expect(initialPrompt(resolution)).toContain("dividend yields");
    expect(initialPrompt(resolution)).toContain("taxable account");
    expect(initialPrompt(resolution)).toContain("fund role");
    expect(initialPrompt(resolution)).toContain("long-horizon fund comparison table");
    expect(initialPrompt(resolution)).toContain("do not let RSI or short-term momentum dominate");
    expect(followUpPrompt(resolution)).toContain("holdings-overlap");
    expect(followUpPrompt(resolution)).toContain("long horizon");
    expect(followUpPrompt(resolution)).not.toContain("right now");
  });

  it("does not apply fund-overlap guidance to long-horizon stock baskets", () => {
    const resolution = makeResolution({
      symbols: ["AAPL", "MSFT", "NVDA"],
      timeHorizon: "long",
    });

    expect(initialPrompt(resolution)).not.toContain("analyze_holdings_overlap");
    expect(initialPrompt(resolution)).not.toContain("ETF/fund overlap check");
    expect(followUpPrompt(resolution)).not.toContain("holdings-overlap");
    expect(followUpPrompt(resolution)).toContain("long horizon");
  });

  it("does not apply long-horizon fund guidance to short-horizon ETF comparisons", () => {
    const resolution = makeResolution({
      symbols: ["SPY", "QQQ"],
      timeHorizon: "6mo",
    });

    expect(initialPrompt(resolution)).not.toContain("long-horizon fund comparison table");
    expect(initialPrompt(resolution)).not.toContain("analyze_holdings_overlap");
    expect(followUpPrompt(resolution)).not.toContain("holdings-overlap");
    expect(followUpPrompt(resolution)).toContain("6mo horizon");
  });

  it("ends short-horizon comparisons with a cautious action plan", () => {
    const resolution = makeResolution({
      symbols: ["NVDA", "AMD"],
      timeHorizon: "6mo",
    });

    expect(followUpPrompt(resolution)).toContain("Cautious action plan");
    expect(initialPrompt(resolution)).toContain("Cautious action plan");
    expect(initialPrompt(resolution)).toContain("Use these response headings in this order");
    expect(initialPrompt(resolution)).toContain("REQUIRED ACTION SECTION");
    expect(followUpPrompt(resolution)).toContain("entry conditions");
    expect(followUpPrompt(resolution)).toContain("invalidation");
    expect(followUpPrompt(resolution)).toContain("before caveats");
    expect(followUpPrompt(resolution)).not.toContain("after any Caveats section");
    expect(followUpPrompt(resolution)).toContain("Do not end at Caveats");
  });

  it("uses explicit ETF scope for long-horizon funds outside the common-symbol classifier", () => {
    const resolution = makeResolution({
      symbols: ["VGT", "VOO"],
      timeHorizon: "5_years",
      assetScope: "etf_focused",
    });

    expect(initialPrompt(resolution)).toContain("analyze_holdings_overlap");
    expect(initialPrompt(resolution)).toContain("asset scope (etf_focused)");
    expect(followUpPrompt(resolution)).toContain("holdings-overlap");
  });
});
