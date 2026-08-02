import { describe, expect, it } from "vitest";
import {
  buildCompareAssetsPrompt,
  buildDisclosureBlock,
  buildOptionsScreenerPrompt,
  buildPortfolioPrompt,
} from "../../../src/prompts/workflow-prompts.js";
import type {
  CompareAssetsSlots,
  OptionsScreenerSlots,
  PortfolioSlots,
  SlotResolution,
} from "../../../src/routing/types.js";

function makePortfolioResolution(
  overrides: Partial<PortfolioSlots> = {},
  sourceOverrides: Partial<Record<keyof PortfolioSlots, "user" | "preference" | "default">> = {},
): SlotResolution<PortfolioSlots> {
  const resolved: PortfolioSlots = {
    budget: 10_000,
    riskProfile: "balanced",
    timeHorizon: "1y_plus",
    assetScope: "diversified_etf_building_blocks",
    positionCount: 6,
    maxSinglePositionPct: 20,
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
  sourceOverrides: Partial<
    Record<keyof OptionsScreenerSlots, "user" | "preference" | "default">
  > = {},
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

  it("includes tool call instructions for default fund-building-block scope", () => {
    const prompt = buildPortfolioPrompt(makePortfolioResolution());
    expect(prompt).toContain("get_stock_quote");
    expect(prompt).not.toContain("get_company_overview");
    expect(prompt).toContain("analyze_risk");
    expect(prompt).toContain("analyze_correlation");
  });

  it("includes response format instructions", () => {
    const prompt = buildPortfolioPrompt(makePortfolioResolution());
    expect(prompt).toContain("assumption");
  });

  it("requires a direct bottom-line portfolio commitment after assumptions", () => {
    const prompt = buildPortfolioPrompt(makePortfolioResolution());
    expect(prompt).toContain('Then start the analysis with "Bottom line:"');
    expect(prompt).toContain("directly say what portfolio you would build");
    expect(prompt).toContain("horizon-specific risks");
    expect(prompt).not.toContain("beginning exactly");
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

  it("uses crypto-capable tools for a stocks-and-crypto portfolio", () => {
    const prompt = buildPortfolioPrompt(
      makePortfolioResolution({ assetScope: "stocks_and_crypto" }, { assetScope: "user" }),
    );

    expect(prompt).toContain("get_crypto_price");
    expect(prompt).toContain("get_crypto_history");
    expect(prompt).toContain("canonical CoinGecko id");
    expect(prompt).toContain("Do not send cryptocurrencies to stock-only");
    expect(prompt).toContain("Use analyze_correlation only across the stock candidates");
  });

  it("does not include get_company_overview for diversified fund building-block scope", () => {
    const prompt = buildPortfolioPrompt(makePortfolioResolution());
    expect(prompt).not.toContain("get_company_overview");
    expect(prompt).toContain("diversified fund/ETF building-block candidates");
  });

  it("includes generic balanced portfolio guardrails", () => {
    const prompt = buildPortfolioPrompt(
      makePortfolioResolution({ timeHorizon: "3y" }, { timeHorizon: "user" }),
    );
    expect(prompt).toContain(
      "prefer diversified building blocks over individual-company concentration",
    );
    expect(prompt).toContain("core domestic equity");
    expect(prompt).toContain("international equity");
    expect(prompt).toContain("short-duration or cash-like stability");
    expect(prompt).toContain("horizons under 5 years");
    expect(prompt).toContain("current price used");
    expect(prompt).toContain("role");
    expect(prompt).toContain("do not paste company descriptions");
    expect(prompt).toContain("Why this fits the horizon");
    expect(prompt).toContain("rebalance cadence");
    expect(prompt).toContain("low-cost/liquid implementation");
    expect(prompt).toContain("tax/account caveats");
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

  it("tells LEAPS workflows to fetch explicit long-dated expirations", () => {
    const prompt = buildOptionsScreenerPrompt(
      makeOptionsResolution({ dteTarget: "180_plus_days" }, { dteTarget: "user" }),
    );
    expect(prompt).toContain("For LEAPS / long-dated options");
    expect(prompt).toContain("call get_option_chain again with explicit `expiration`");
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

  it("requires full Greeks in the ranked options table", () => {
    const prompt = buildOptionsScreenerPrompt(makeOptionsResolution());
    expect(prompt).toContain("gamma");
    expect(prompt).toContain("theta");
    expect(prompt).toContain("vega");
    expect(prompt).toContain("rho");
  });

  it("preserves user max premium caps in options ranking instructions", () => {
    const prompt = buildOptionsScreenerPrompt(
      makeOptionsResolution({ maxPremium: 500 }, { maxPremium: "user" }),
    );

    expect(prompt).toContain("Max premium: $500");
    expect(prompt).toContain("Do not rank contracts above the user's max premium of $500");
  });

  it("treats covered-call catalyst tickers as context, not the option-chain underlying", () => {
    const prompt = buildOptionsScreenerPrompt(
      makeOptionsResolution(
        {
          symbol: "DRAM",
          dteTarget: "0_to_7_days",
          costBasis: 51,
          catalystSymbols: ["NVDA"],
        },
        {
          symbol: "user",
          dteTarget: "user",
          costBasis: "user",
          catalystSymbols: "user",
        },
      ),
    );

    expect(prompt).toContain("Screen and rank options contracts for DRAM");
    expect(prompt).toContain("Position cost basis: $51");
    expect(prompt).toContain("Catalyst/context tickers: NVDA");
    expect(prompt).toContain("Use get_option_chain for DRAM");
    expect(prompt).toContain(
      "Do not substitute catalyst/context tickers as the option-chain underlying",
    );
    expect(prompt).toContain(
      "Treat this as selling covered calls against an existing DRAM share position",
    );
    expect(prompt).toContain("Do not describe max loss as the option premium paid");
    expect(prompt).toContain("covered-call sale risks");
    expect(prompt).toContain("closed_market_or_stale_quotes");
    expect(prompt).toContain("recheck after regular options trading opens");
    expect(prompt).toContain("Because the user phrased DRAM as an existing holding");
    expect(prompt).toContain("briefly state that you are treating DRAM as the held ticker");
    expect(prompt).toContain("If they meant memory exposure or a different ticker");
    expect(prompt).toContain("Start with an Interpretation line");
    expect(prompt).toContain("If you meant DRAM as memory exposure or another ticker");
    expect(prompt).toContain("effective assignment sale price");
    expect(prompt).toContain("compare it with the $51 cost basis");
    expect(prompt).toContain("Verify bid/ask and open interest in the user's broker");
    expect(prompt).toContain("Best action:");
    expect(prompt).toContain("Conditional candidate:");
  });

  it("frames protective puts as hedges on existing shares", () => {
    const prompt = buildOptionsScreenerPrompt(
      makeOptionsResolution(
        {
          symbol: "NVDA",
          direction: "bearish",
          optionStrategy: "protective_put",
          shareQuantity: 200,
          dteTarget: "30_to_45_days",
        },
        {
          symbol: "user",
          direction: "user",
          optionStrategy: "user",
          shareQuantity: "user",
          dteTarget: "user",
        },
      ),
    );

    expect(prompt).toContain("Screen and rank options contracts for NVDA");
    expect(prompt).toContain("Option strategy: protective_put");
    expect(prompt).toContain("Share quantity: 200 shares");
    expect(prompt).toContain("Filter contracts matching: puts");
    expect(prompt).toContain("buying puts to hedge an existing long NVDA share position");
    expect(prompt).toContain("premium as a percent of the stock position");
    expect(prompt).toContain("1 put contract per 100 shares");
    expect(prompt).toContain("total premium for the required number of contracts");
    expect(prompt).toContain("hedge floor");
    expect(prompt).toContain("collar or put spread");
    expect(prompt).toContain("Do not discuss short-option assignment risk");
  });

  it("keeps catalyst-driven protective puts out of covered-call framing", () => {
    const prompt = buildOptionsScreenerPrompt(
      makeOptionsResolution(
        {
          symbol: "AMD",
          direction: "bearish",
          optionStrategy: "protective_put",
          shareQuantity: 200,
          catalystSymbols: ["NVDA"],
          dteTarget: "25_to_45_days",
        },
        {
          symbol: "user",
          direction: "user",
          optionStrategy: "user",
          shareQuantity: "user",
          catalystSymbols: "user",
          dteTarget: "user",
        },
      ),
    );

    expect(prompt).toContain("Screen and rank options contracts for AMD");
    expect(prompt).toContain("Catalyst/context tickers: NVDA");
    expect(prompt).toContain("Use get_option_chain for AMD");
    expect(prompt).toContain("buying puts to hedge an existing long AMD share position");
    expect(prompt).toContain(
      "Interpretation: Treating this as buying protective puts on an existing long AMD share position.",
    );
    expect(prompt).not.toContain("selling covered calls");
    expect(prompt).not.toContain("premium received");
    expect(prompt).not.toContain("assignment sale price");
    expect(prompt).not.toContain("covered-call sale risks");
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
    expect(prompt).toContain("Use get_price_comparison with symbols [SPY, QQQ]");
    expect(prompt).toContain("range that fits the resolved time horizon");
    expect(prompt).toContain("default comparison range when no time horizon is resolved");
  });

  it("tells ETF overlap comparisons to prioritize holdings and concentration over generic metrics", () => {
    const resolution: SlotResolution<CompareAssetsSlots> = {
      resolved: { symbols: ["VOO", "QQQ"], metrics: ["overlap"] },
      sources: { symbols: "user", metrics: "user" },
      defaultsUsed: [],
      missingRequired: [],
    };
    const prompt = buildCompareAssetsPrompt(resolution);

    expect(prompt).toContain("ETF overlap");
    expect(prompt).toContain("top holdings");
    expect(prompt).toContain("sector concentration");
    expect(prompt).toContain("not the same as correlation");
    expect(prompt).toContain("mega-cap technology tilt");
    expect(prompt).toContain(
      "avoid treating price, RSI, or generic risk metrics as the main answer",
    );
  });

  it("tells ETF overlap comparisons to use the holdings overlap tool before correlation fallback", () => {
    const resolution: SlotResolution<CompareAssetsSlots> = {
      resolved: { symbols: ["VOO", "QQQ", "SCHD"], metrics: ["overlap"] },
      sources: { symbols: "user", metrics: "user" },
      defaultsUsed: [],
      missingRequired: [],
    };
    const prompt = buildCompareAssetsPrompt(resolution);

    expect(prompt).toContain("Use analyze_holdings_overlap with symbols [VOO, QQQ, SCHD]");
    expect(prompt).toContain("Use analyze_correlation across [VOO, QQQ, SCHD] only as supporting");
    expect(prompt).toContain("provider top holdings");
    expect(prompt).not.toContain("If exact holdings weights are unavailable");
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

  it("adapts comparison guidance to a user-specified six-month horizon", () => {
    const resolution: SlotResolution<CompareAssetsSlots> = {
      resolved: { symbols: ["AAPL", "MSFT"], timeHorizon: "6mo" },
      sources: { symbols: "user", timeHorizon: "user" },
      defaultsUsed: [],
      missingRequired: [],
    };
    const prompt = buildCompareAssetsPrompt(resolution);

    expect(prompt).toContain("Time horizon: 6mo");
    expect(prompt).toMatch(/near-term catalysts/i);
    expect(prompt).toMatch(/earnings|guidance/i);
    expect(prompt).toMatch(/sentiment/i);
    expect(prompt).toMatch(/forward-looking/i);
    expect(prompt).toMatch(/should compare/i);
  });

  it("specializes comparison guidance for macro hedge decisions", () => {
    const resolution: SlotResolution<CompareAssetsSlots> = {
      resolved: { symbols: ["BTC", "GLD"], timeHorizon: "6mo", metrics: ["macro_hedge"] },
      sources: { symbols: "user", timeHorizon: "user", metrics: "user" },
      defaultsUsed: [],
      missingRequired: [],
    };
    const prompt = buildCompareAssetsPrompt(resolution);

    expect(prompt).toMatch(/macro hedge/i);
    expect(prompt).toMatch(/real yields/i);
    expect(prompt).toMatch(/correlation regime/i);
    expect(prompt).toMatch(/capital preservation/i);
    expect(prompt).toMatch(/scenario map/i);
    expect(prompt).toMatch(/stagflation/i);
    expect(prompt).toMatch(/liquidity crunch/i);
    expect(prompt).not.toMatch(/Highlight which asset is stronger on each metric/i);
  });

  it("specializes comparison guidance for interest-rate-sensitive allocation decisions", () => {
    const resolution: SlotResolution<CompareAssetsSlots> = {
      resolved: { symbols: ["SPY", "QQQ"], timeHorizon: "12mo", metrics: ["interest_rates"] },
      sources: { symbols: "user", timeHorizon: "user", metrics: "user" },
      defaultsUsed: [],
      missingRequired: [],
    };
    const prompt = buildCompareAssetsPrompt(resolution);

    expect(prompt).toContain("get_economic_data");
    expect(prompt).toContain("current Fed funds backdrop");
    expect(prompt).toContain("historical/current context");
    expect(prompt).toContain("why rates fall");
    expect(prompt).toContain("benign disinflation/soft landing");
    expect(prompt).toContain("sticky inflation");
    expect(prompt).toContain("duration-like sensitivity");
    expect(prompt).toContain("concentration and sector-exposure risk");
    expect(prompt).toContain("rate-futures evidence is unavailable");
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
    const block = buildDisclosureBlock({ budget: "$10,000" }, { budget: "user" }, [
      "delta >= 0.20 (balanced objective)",
    ]);
    expect(block).toContain("Workflow constraints");
    expect(block).toContain("delta >= 0.20");
  });

  it("uses human-readable display names", () => {
    const block = buildDisclosureBlock(
      { positionCount: 6, maxSinglePositionPct: "20%" },
      { positionCount: "default", maxSinglePositionPct: "default" },
    );
    expect(block).toContain("positions (6)");
    expect(block).toContain("max single position (20%)");
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

describe("workflow prompts — no disclaimer / refusal directives", () => {
  const compareResolution: SlotResolution<CompareAssetsSlots> = {
    resolved: { symbols: ["AAPL", "MSFT"] },
    sources: { symbols: "user" },
    defaultsUsed: [],
    missingRequired: [],
  };

  it("buildPortfolioPrompt contains no disclaimer directive", () => {
    const prompt = buildPortfolioPrompt(makePortfolioResolution());
    expect(prompt).not.toMatch(/standard disclaimer/i);
    expect(prompt).not.toMatch(/\bdisclaimer\b/i);
    expect(prompt).not.toMatch(/\beducational sample\b/i);
    expect(prompt).not.toMatch(/instead of refusing/i);
    expect(prompt).not.toMatch(/not financial advice/i);
  });

  it("buildOptionsScreenerPrompt contains no disclaimer directive", () => {
    const prompt = buildOptionsScreenerPrompt(makeOptionsResolution());
    expect(prompt).not.toMatch(/standard disclaimer/i);
    expect(prompt).not.toMatch(/\bdisclaimer\b/i);
    expect(prompt).not.toMatch(/not financial advice/i);
  });

  it("buildCompareAssetsPrompt contains no disclaimer directive", () => {
    const prompt = buildCompareAssetsPrompt(compareResolution);
    expect(prompt).not.toMatch(/standard disclaimer/i);
    expect(prompt).not.toMatch(/\bdisclaimer\b/i);
    expect(prompt).not.toMatch(/not financial advice/i);
  });
});

describe("buildAssumptionsBlockFromRouter", () => {
  it("renders string[] slot values as ', '-joined strings, not 'a,b'", async () => {
    const { buildAssumptionsBlockFromRouter } = await import(
      "../../../src/prompts/workflow-prompts.js"
    );
    const block = buildAssumptionsBlockFromRouter({
      symbols: { value: ["AAPL", "MSFT", "NVDA"], source: "user", confidence: "high" },
    });
    expect(block).toContain("symbols (AAPL, MSFT, NVDA)");
    expect(block).not.toContain("AAPL,MSFT");
  });

  it("renders scalar slot values unchanged", async () => {
    const { buildAssumptionsBlockFromRouter } = await import(
      "../../../src/prompts/workflow-prompts.js"
    );
    const block = buildAssumptionsBlockFromRouter({
      budget: { value: 25_000, source: "user", confidence: "high" },
      horizon: { value: "6mo", source: "preference", confidence: "medium" },
    });
    expect(block).toContain("budget (25000)");
    expect(block).toContain("horizon (6mo)");
  });

  it("renders plain-object slot values as JSON, not '[object Object]'", async () => {
    const { buildAssumptionsBlockFromRouter } = await import(
      "../../../src/prompts/workflow-prompts.js"
    );
    const block = buildAssumptionsBlockFromRouter({
      range: {
        value: { min: 60, max: 80 },
        source: "default",
        confidence: "low",
      },
    });
    expect(block).toContain('range ({"min":60,"max":80})');
    expect(block).not.toContain("[object Object]");
  });
});
