import { describe, it, expect } from "vitest";
import {
  buildPortfolioPrompt,
  buildOptionsScreenerPrompt,
  buildCompareAssetsPrompt,
  buildDisclosureBlock,
} from "../../../src/prompts/workflow-prompts.js";
import type { PortfolioSlots, OptionsScreenerSlots, SlotResolution, CompareAssetsSlots } from "../../../src/routing/types.js";

function makePortfolioResolution(
  overrides: Partial<PortfolioSlots> = {},
  sourceOverrides: Partial<Record<keyof PortfolioSlots, "user" | "preference" | "default">> = {},
): SlotResolution<PortfolioSlots> {
  const resolved: PortfolioSlots = {
    budget: 10_000,
    riskProfile: "balanced",
    timeHorizon: "1y_plus",
    assetScope: "mixed_etf_and_large_cap_equities",
    positionCount: 4,
    maxSinglePositionPct: 35,
    ...overrides,
  };
  const sources: Record<keyof PortfolioSlots, "user" | "preference" | "default"> = {
    budget: "user",
    riskProfile: "default",
    timeHorizon: "default",
    assetScope: "default",
    positionCount: "default",
    maxSinglePositionPct: "default",
    ...sourceOverrides,
  };
  const defaultsUsed = (Object.keys(sources) as (keyof PortfolioSlots)[]).filter(
    (k) => sources[k] === "default",
  );
  return { resolved, sources, defaultsUsed, missingRequired: [] };
}

function makeOptionsResolution(
  overrides: Partial<OptionsScreenerSlots> = {},
  sourceOverrides: Partial<Record<keyof OptionsScreenerSlots, "user" | "preference" | "default">> = {},
): SlotResolution<OptionsScreenerSlots> {
  const resolved: OptionsScreenerSlots = {
    symbol: "MSFT",
    direction: "bullish",
    dteTarget: "25_to_45_days",
    objective: "balanced_leverage_and_probability",
    moneynessPreference: "atm_to_slightly_otm",
    liquidityMinimum: "high_open_interest_and_tight_spread",
    ...overrides,
  };
  const sources: Record<keyof OptionsScreenerSlots, "user" | "preference" | "default"> = {
    symbol: "user",
    direction: "user",
    dteTarget: "default",
    objective: "default",
    moneynessPreference: "default",
    liquidityMinimum: "default",
    ...sourceOverrides,
  };
  const defaultsUsed = (Object.keys(sources) as (keyof OptionsScreenerSlots)[]).filter(
    (k) => sources[k] === "default",
  );
  return { resolved, sources, defaultsUsed, missingRequired: [] };
}

describe("buildPortfolioPrompt", () => {
  it("includes budget from user input", () => {
    const prompt = buildPortfolioPrompt(makePortfolioResolution());
    expect(prompt).toContain("$10,000");
  });

  it("marks defaults with [DEFAULT]", () => {
    const prompt = buildPortfolioPrompt(makePortfolioResolution());
    expect(prompt).toContain("balanced [DEFAULT]");
    expect(prompt).toContain("1y_plus [DEFAULT]");
  });

  it("does not mark user-provided values with [DEFAULT]", () => {
    const resolution = makePortfolioResolution(
      { riskProfile: "conservative" },
      { riskProfile: "user" },
    );
    const prompt = buildPortfolioPrompt(resolution);
    expect(prompt).not.toContain("conservative [DEFAULT]");
    expect(prompt).not.toContain("conservative [SAVED");
    expect(prompt).toContain("conservative");
  });

  it("includes tool call instructions for mixed scope", () => {
    const prompt = buildPortfolioPrompt(makePortfolioResolution());
    expect(prompt).toContain("get_stock_quote");
    expect(prompt).toContain("get_company_overview");
    expect(prompt).toContain("analyze_risk");
  });

  it("includes response format instructions", () => {
    const prompt = buildPortfolioPrompt(makePortfolioResolution());
    expect(prompt).toContain("assumption");
  });

  it("includes position count", () => {
    const prompt = buildPortfolioPrompt(makePortfolioResolution({ positionCount: 6 }));
    expect(prompt).toContain("6");
  });

  // Fix 3: Date grounding
  it("includes current date", () => {
    const prompt = buildPortfolioPrompt(makePortfolioResolution());
    expect(prompt).toMatch(/Current date: \d{4}-\d{2}-\d{2}/);
  });

  // Fix 4: Source attribution
  it("marks preference-sourced values with [SAVED PREFERENCE]", () => {
    const resolution = makePortfolioResolution(
      { riskProfile: "conservative" },
      { riskProfile: "preference" },
    );
    const prompt = buildPortfolioPrompt(resolution);
    expect(prompt).toContain("conservative [SAVED PREFERENCE]");
  });

  it("does not tag user-provided values", () => {
    const resolution = makePortfolioResolution(
      { riskProfile: "aggressive" },
      { riskProfile: "user" },
    );
    const prompt = buildPortfolioPrompt(resolution);
    expect(prompt).toContain("aggressive");
    expect(prompt).not.toMatch(/aggressive \[/);
  });

  // Fix 5: ETF tool path
  it("does not include get_company_overview for ETF-scoped portfolio", () => {
    const resolution = makePortfolioResolution(
      { assetScope: "etf_focused" },
      { assetScope: "preference" },
    );
    const prompt = buildPortfolioPrompt(resolution);
    expect(prompt).not.toContain("get_company_overview");
    expect(prompt).toContain("get_stock_quote");
    expect(prompt).toContain("analyze_risk");
    expect(prompt).toContain("analyze_correlation");
  });

  it("includes get_company_overview for stock-scoped portfolio", () => {
    const resolution = makePortfolioResolution(
      { assetScope: "large_cap_equities" },
      { assetScope: "user" },
    );
    const prompt = buildPortfolioPrompt(resolution);
    expect(prompt).toContain("get_company_overview");
  });

  it("includes get_company_overview for mixed scope (default)", () => {
    const prompt = buildPortfolioPrompt(makePortfolioResolution());
    expect(prompt).toContain("get_company_overview");
  });
});

describe("buildOptionsScreenerPrompt", () => {
  it("includes symbol", () => {
    const prompt = buildOptionsScreenerPrompt(makeOptionsResolution());
    expect(prompt).toContain("MSFT");
  });

  it("includes direction", () => {
    const prompt = buildOptionsScreenerPrompt(makeOptionsResolution());
    expect(prompt).toContain("bullish");
  });

  it("includes DTE target", () => {
    const prompt = buildOptionsScreenerPrompt(makeOptionsResolution());
    expect(prompt).toContain("25_to_45_days");
  });

  it("marks defaults with [DEFAULT]", () => {
    const prompt = buildOptionsScreenerPrompt(makeOptionsResolution());
    expect(prompt).toContain("[DEFAULT]");
  });

  it("includes tool instructions", () => {
    const prompt = buildOptionsScreenerPrompt(makeOptionsResolution());
    expect(prompt).toContain("get_option_chain");
  });

  // Fix 3: Date grounding
  it("includes current date and expiration window", () => {
    const prompt = buildOptionsScreenerPrompt(makeOptionsResolution());
    expect(prompt).toMatch(/Current date: \d{4}-\d{2}-\d{2}/);
    expect(prompt).toMatch(/Target expiration window: \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);
  });

  it("includes 'Do NOT invent' instruction", () => {
    const prompt = buildOptionsScreenerPrompt(makeOptionsResolution());
    expect(prompt).toContain("Do NOT invent or assume a different current date");
  });

  // Fix 6: Delta floor
  it("includes delta floor for balanced objective", () => {
    const prompt = buildOptionsScreenerPrompt(makeOptionsResolution());
    expect(prompt).toContain("delta");
    expect(prompt).toContain("0.20");
  });
});

describe("buildCompareAssetsPrompt", () => {
  it("includes all symbols", () => {
    const resolution: SlotResolution<CompareAssetsSlots> = {
      resolved: { symbols: ["AAPL", "MSFT", "GOOGL"] },
      sources: { symbols: "user" },
      defaultsUsed: [],
      missingRequired: [],
    };
    const prompt = buildCompareAssetsPrompt(resolution);
    expect(prompt).toContain("AAPL");
    expect(prompt).toContain("MSFT");
    expect(prompt).toContain("GOOGL");
  });

  it("includes comparison tool instructions", () => {
    const resolution: SlotResolution<CompareAssetsSlots> = {
      resolved: { symbols: ["SPY", "QQQ"] },
      sources: { symbols: "user" },
      defaultsUsed: [],
      missingRequired: [],
    };
    const prompt = buildCompareAssetsPrompt(resolution);
    expect(prompt).toContain("compare_companies");
  });

  // Fix 3: Date grounding
  it("includes current date", () => {
    const resolution: SlotResolution<CompareAssetsSlots> = {
      resolved: { symbols: ["SPY", "QQQ"] },
      sources: { symbols: "user" },
      defaultsUsed: [],
      missingRequired: [],
    };
    const prompt = buildCompareAssetsPrompt(resolution);
    expect(prompt).toMatch(/Current date: \d{4}-\d{2}-\d{2}/);
  });
});

describe("buildDisclosureBlock", () => {
  it("groups slots by source category", () => {
    const block = buildDisclosureBlock(
      {
        budget: "$10,000",
        riskProfile: "aggressive",
        timeHorizon: "1y_plus",
        assetScope: "mixed_etf_and_large_cap_equities",
      },
      {
        budget: "user",
        riskProfile: "user",
        timeHorizon: "default",
        assetScope: "preference",
      },
    );
    expect(block).toContain("User-specified");
    expect(block).toContain("budget");
    expect(block).toContain("risk profile");
    expect(block).toContain("Defaults");
    expect(block).toContain("time horizon");
    expect(block).toContain("From saved preferences");
    expect(block).toContain("asset scope");
  });

  it("omits empty categories", () => {
    const block = buildDisclosureBlock(
      { budget: "$10,000", riskProfile: "balanced" },
      { budget: "user", riskProfile: "default" },
    );
    expect(block).toContain("User-specified");
    expect(block).toContain("Defaults");
    expect(block).not.toContain("From saved preferences");
  });

  it("includes workflow constraints when provided", () => {
    const block = buildDisclosureBlock(
      { budget: "$10,000" },
      { budget: "user" },
      ["delta >= 0.20 (balanced objective)"],
    );
    expect(block).toContain("Workflow constraints");
    expect(block).toContain("delta >= 0.20");
  });

  it("uses human-readable display names", () => {
    const block = buildDisclosureBlock(
      { positionCount: 4, maxSinglePositionPct: "35%" },
      { positionCount: "default", maxSinglePositionPct: "default" },
    );
    expect(block).toContain("positions (4)");
    expect(block).toContain("max single position (35%)");
    expect(block).not.toContain("positionCount");
    expect(block).not.toContain("maxSinglePositionPct");
  });

  it("labels clarification-extracted values as User-specified", () => {
    const block = buildDisclosureBlock(
      { budget: "$15,000", riskProfile: "aggressive" },
      { budget: "user", riskProfile: "user" },
    );
    expect(block).toContain("User-specified");
    expect(block).toContain("risk profile (aggressive)");
    expect(block).not.toContain("From saved preferences");
  });

  it("portfolio prompt contains disclosure block", () => {
    const resolution = makePortfolioResolution(
      { riskProfile: "aggressive" },
      { riskProfile: "user" },
    );
    const prompt = buildPortfolioPrompt(resolution);
    expect(prompt).toContain("Assumptions (reproduce this block exactly");
    expect(prompt).toContain("User-specified");
    expect(prompt).toContain("do not relabel");
  });

  it("options prompt contains disclosure block", () => {
    const prompt = buildOptionsScreenerPrompt(makeOptionsResolution());
    expect(prompt).toContain("Assumptions (reproduce this block exactly");
  });
});
