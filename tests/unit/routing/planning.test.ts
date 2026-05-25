import { describe, expect, it } from "vitest";
import {
  CAPABILITY_GAP_REGISTRY,
  PLANNING_VERSION,
  buildPlanningEnvelope,
  validatePlanningSelection,
} from "../../../src/routing/planning.js";
import type { RouterInputContext, RouterOutput } from "../../../src/routing/router-types.js";

const input: RouterInputContext = {
  text: "If I have $5,000, should I buy VYM, SCHD, VOO, or QQQ?",
  priorTurns: [],
  profileSnapshot: {},
  recentWorkflowRuns: [],
};

const compareOutput: RouterOutput = {
  routeKind: "workflow_dispatch",
  route: "workflow",
  workflow: "compare_assets",
  entities: { symbols: ["VYM", "SCHD", "VOO", "QQQ"] },
  slots: {},
  preference_updates: [],
  missing_required: [],
  tool_bundles: ["core_market", "macro", "sentiment"],
  diagnostics: [],
  reasoning: "compare ETFs",
};

describe("planning layer", () => {
  it("selects a default task family, policy, evidence plan, contract, and checks", () => {
    const planning = buildPlanningEnvelope(input, compareOutput);

    expect(planning.version).toBe(PLANNING_VERSION);
    expect(planning.taskFamily).toBe("asset_compare");
    expect(planning.commitmentMode).toBe("compare_tradeoffs");
    expect(planning.policyCardId).toBe("asset_compare");
    expect(planning.evidencePlanId).toBe("placeholder_asset_compare");
    expect(planning.answerContractId).toBe("asset_compare_tradeoff");
    expect(planning.structuredCheckIds).toContain("capability_gap_disclosure");
    expect(planning.behaviorMode).toBe("replacement_active");
  });

  it("corrects unsupported route and task-family combinations deterministically", () => {
    const result = validatePlanningSelection(
      compareOutput,
      {
        taskFamily: "retail_finance_tradeoff",
        commitmentMode: "framework",
        policyCardId: "retail_finance_tradeoff",
        evidencePlanId: "placeholder_retail_finance_tradeoff",
        answerContractId: "retail_tradeoff_framework",
        structuredCheckIds: ["data_gap_disclosed"],
        capabilityGapIds: ["brokerage_comparison"],
      },
    );

    expect(result.selection.taskFamily).toBe("asset_compare");
    expect(result.selection.commitmentMode).toBe("compare_tradeoffs");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "planning_task_family_corrected",
    }));
  });

  it("keeps non-migrated task families observational", () => {
    const planning = buildPlanningEnvelope(input, {
      ...compareOutput,
      workflow: "portfolio_builder",
      entities: { symbols: ["NVDA"] },
      tool_bundles: ["core_market", "macro", "sentiment", "clarification"],
    });

    expect(planning.behaviorMode).toBe("observe_only");
    expect(planning.diagnostics).toContainEqual(expect.objectContaining({
      code: "planning_observe_only",
    }));
  });

  it("runs the selected ticker-disambiguation migration slice in replacement-active mode", () => {
    const planning = buildPlanningEnvelope(
      {
        ...input,
        text: "Is ARMH still the right ticker for Arm?",
      },
      {
        ...compareOutput,
        routeKind: "agent_task",
        route: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: ["ARMH"] },
        tool_bundles: ["core_market"],
      },
    );

    expect(planning.taskFamily).toBe("ticker_disambiguation");
    expect(planning.policyCardId).toBe("ticker_disambiguation");
    expect(planning.evidencePlanId).toBe("ticker_disambiguation");
    expect(planning.answerContractId).toBe("ticker_disambiguation");
    expect(planning.behaviorMode).toBe("replacement_active");
  });

  it("can activate only the current-event slice without changing unrelated task families", () => {
    const currentEvent = buildPlanningEnvelope(
      {
        ...input,
        text: "Why did Boeing move today? I want the actual catalyst.",
      },
      {
        ...compareOutput,
        routeKind: "agent_task",
        route: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: ["BA"] },
        tool_bundles: ["core_market"],
      },
      {
        migrationStatuses: {
          current_event_explanation: "dual_run",
        },
      },
    );
    const assetCompare = buildPlanningEnvelope(input, compareOutput, {
      migrationStatuses: {
        current_event_explanation: "dual_run",
      },
    });

    expect(currentEvent.taskFamily).toBe("current_event_explanation");
    expect(currentEvent.behaviorMode).toBe("dual_run");
    expect(assetCompare.taskFamily).toBe("asset_compare");
    expect(assetCompare.behaviorMode).toBe("replacement_active");
  });

  it("runs the current-event migration slice in replacement-active mode by default", () => {
    const planning = buildPlanningEnvelope(
      {
        ...input,
        text: "Why did Boeing move today? I want the actual catalyst.",
      },
      {
        ...compareOutput,
        routeKind: "agent_task",
        route: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: ["BA"] },
        tool_bundles: ["core_market"],
      },
    );

    expect(planning.taskFamily).toBe("current_event_explanation");
    expect(planning.behaviorMode).toBe("replacement_active");
  });

  it("selects valuation-metric education policy for valuation concept prompts", () => {
    const planning = buildPlanningEnvelope(
      {
        ...input,
        text: "Explain how to use P/E ratios without over relying on them.",
      },
      {
        ...compareOutput,
        routeKind: "agent_task",
        route: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: [] },
        tool_bundles: [],
        diagnostics: [{ code: "conceptual_education_no_tools", message: "no tools needed" }],
      },
    );

    expect(planning.taskFamily).toBe("concept_explainer");
    expect(planning.policyCardId).toBe("concept_valuation_metric_education");
    expect(planning.evidencePlanId).toBe("placeholder_concept_explainer");
    expect(planning.answerContractId).toBe("concept_explainer");
    expect(planning.artifactContractIds).toContain("concept_example_table");
    expect(planning.behaviorMode).toBe("replacement_active");
  });

  it("selects options education policy for no-symbol options concept prompts", () => {
    const planning = buildPlanningEnvelope(
      {
        ...input,
        text: "Explain covered calls and assignment risk for a beginner.",
      },
      {
        ...compareOutput,
        routeKind: "agent_task",
        route: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: [] },
        tool_bundles: [],
      },
    );

    expect(planning.taskFamily).toBe("concept_explainer");
    expect(planning.policyCardId).toBe("concept_options_education");
    expect(planning.evidencePlanId).toBe("placeholder_concept_explainer");
    expect(planning.answerContractId).toBe("concept_explainer");
  });

  it("selects inflation education policy without converting cash education into macro allocation", () => {
    const planning = buildPlanningEnvelope(
      {
        ...input,
        text: "How does inflation affect cash savings and purchasing power?",
      },
      {
        ...compareOutput,
        routeKind: "agent_task",
        route: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: [] },
        tool_bundles: [],
      },
    );

    expect(planning.taskFamily).toBe("concept_explainer");
    expect(planning.policyCardId).toBe("concept_inflation_cash_education");
    expect(planning.evidencePlanId).toBe("placeholder_concept_explainer");
    expect(planning.answerContractId).toBe("concept_explainer");
  });

  it("prefers specific task families over generic single-asset workflow metadata", () => {
    const singleAssetOutput: RouterOutput = {
      ...compareOutput,
      routeKind: "agent_task",
      route: "fallback",
      workflow: "single_asset_analysis",
      entities: { symbols: ["GME"] },
      tool_bundles: ["core_market", "sentiment"],
    };

    expect(buildPlanningEnvelope({
      ...input,
      text: "What's the retail mood around GME right now across Reddit, X/Twitter, and recent news?",
    }, singleAssetOutput).taskFamily).toBe("sentiment_snapshot");

    expect(buildPlanningEnvelope({
      ...input,
      text: "Look at COIN's latest 10-Q. Separate SEC filing evidence from news.",
    }, {
      ...singleAssetOutput,
      entities: { symbols: ["COIN"] },
      tool_bundles: ["core_market", "sec"],
    }).taskFamily).toBe("filing_thesis_review");

    expect(buildPlanningEnvelope({
      ...input,
      text: "Why did Boeing move today? I want the actual catalyst.",
    }, {
      ...singleAssetOutput,
      entities: { symbols: ["BA"] },
    }).taskFamily).toBe("current_event_explanation");
  });

  it("runs the sentiment snapshot migration slice in replacement-active mode by default", () => {
    const planning = buildPlanningEnvelope(
      {
        ...input,
        text: "What’s the retail mood around GME right now across Reddit, X/Twitter, and recent news, and is it diverging from price action?",
      },
      {
        ...compareOutput,
        routeKind: "agent_task",
        route: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: ["GME"] },
        tool_bundles: ["core_market", "sentiment"],
      },
    );

    expect(planning.taskFamily).toBe("sentiment_snapshot");
    expect(planning.policyCardId).toBe("sentiment_snapshot");
    expect(planning.evidencePlanId).toBe("placeholder_sentiment_snapshot");
    expect(planning.answerContractId).toBe("sentiment_snapshot");
    expect(planning.capabilityGapIds).toContain("sentiment_sample_depth");
    expect(planning.behaviorMode).toBe("replacement_active");
  });

  it("runs the filing thesis migration slice in replacement-active mode by default", () => {
    const planning = buildPlanningEnvelope(
      {
        ...input,
        text: "Look at COIN's latest 10-Q. Separate SEC filing evidence from news.",
      },
      {
        ...compareOutput,
        routeKind: "agent_task",
        route: "fallback",
        workflow: "single_asset_analysis",
        entities: { symbols: ["COIN"] },
        tool_bundles: ["core_market", "sec"],
      },
    );

    expect(planning.taskFamily).toBe("filing_thesis_review");
    expect(planning.policyCardId).toBe("filing_thesis_review");
    expect(planning.evidencePlanId).toBe("placeholder_filing_thesis_review");
    expect(planning.answerContractId).toBe("filing_thesis_review");
    expect(planning.behaviorMode).toBe("replacement_active");
  });

  it("sets prompt-specific commitment modes and capability gaps for manifest tradeoffs", () => {
    const retail = buildPlanningEnvelope({
      ...input,
      text: "Where should I keep cash I might need in 6-12 months: HYSA, money-market fund, T-bills, CDs, or a bond ETF?",
    }, {
      ...compareOutput,
      routeKind: "agent_task",
      route: "fallback",
      workflow: "general_finance_qa",
      entities: { symbols: [] },
      tool_bundles: [],
    });
    const providerDegradation = buildPlanningEnvelope({
      ...input,
      text: "Use current inflation, Fed funds, and market sentiment data to explain what matters most for a balanced U.S. portfolio right now.",
    }, {
      ...compareOutput,
      routeKind: "agent_task",
      route: "fallback",
      workflow: "general_finance_qa",
      entities: { symbols: [] },
      tool_bundles: ["core_market", "macro", "sentiment"],
    });

    expect(retail.taskFamily).toBe("retail_finance_tradeoff");
    expect(retail.commitmentMode).toBe("compare_tradeoffs");
    expect(providerDegradation.taskFamily).toBe("macro_allocation_review");
    expect(providerDegradation.commitmentMode).toBe("framework");
    expect(providerDegradation.capabilityGapIds).toEqual(expect.arrayContaining([
      "market_calendar",
      "forward_rate_probabilities",
      "sentiment_sample_depth",
    ]));
  });

  it("runs the retail finance migration slice in replacement-active mode by default", () => {
    const planning = buildPlanningEnvelope({
      ...input,
      text: "Where should I keep cash I might need in 6-12 months: HYSA, money-market fund, T-bills, CDs, or a bond ETF?",
    }, {
      ...compareOutput,
      routeKind: "agent_task",
      route: "fallback",
      workflow: "general_finance_qa",
      entities: { symbols: [] },
      tool_bundles: [],
    });

    expect(planning.taskFamily).toBe("retail_finance_tradeoff");
    expect(planning.policyCardId).toBe("retail_finance_tradeoff");
    expect(planning.evidencePlanId).toBe("placeholder_retail_finance_tradeoff");
    expect(planning.answerContractId).toBe("retail_tradeoff_framework");
    expect(planning.capabilityGapIds).toEqual(expect.arrayContaining([
      "brokerage_comparison",
      "cash_yield_products",
      "fund_tax_efficiency",
    ]));
    expect(planning.behaviorMode).toBe("replacement_active");
  });

  it("runs the asset compare migration slice in replacement-active mode by default", () => {
    const planning = buildPlanningEnvelope({
      ...input,
      text: "If I have $5,000 for 10-15 years, should I prioritize VYM or SCHD, or something more growth-oriented like VOO or QQQ?",
    }, {
      ...compareOutput,
      routeKind: "workflow_dispatch",
      route: "workflow",
      workflow: "compare_assets",
      entities: { symbols: ["VYM", "SCHD", "VOO", "QQQ"], compareMetrics: ["overlap"] },
      tool_bundles: ["core_market", "macro", "sentiment"],
    });

    expect(planning.taskFamily).toBe("asset_compare");
    expect(planning.policyCardId).toBe("asset_compare");
    expect(planning.evidencePlanId).toBe("placeholder_asset_compare");
    expect(planning.answerContractId).toBe("asset_compare_tradeoff");
    expect(planning.commitmentMode).toBe("compare_tradeoffs");
    expect(planning.capabilityGapIds).toEqual(["etf_holdings_overlap"]);
    expect(planning.behaviorMode).toBe("replacement_active");
  });

  it("runs the single-asset decision migration slice in replacement-active mode by default", () => {
    const planning = buildPlanningEnvelope({
      ...input,
      text: "Analyze NVDA and tell me whether to buy, wait, or avoid. Include the key risks and entry strategy.",
    }, {
      ...compareOutput,
      routeKind: "agent_task",
      route: "fallback",
      workflow: "single_asset_analysis",
      entities: { symbols: ["NVDA"] },
      tool_bundles: ["core_market"],
    });

    expect(planning.taskFamily).toBe("single_asset_decision");
    expect(planning.policyCardId).toBe("single_asset_decision");
    expect(planning.evidencePlanId).toBe("placeholder_single_asset_decision");
    expect(planning.answerContractId).toBe("single_asset_decision");
    expect(planning.commitmentMode).toBe("decision");
    expect(planning.behaviorMode).toBe("replacement_active");
  });

  it("runs the macro allocation migration slice in replacement-active mode by default", () => {
    const planning = buildPlanningEnvelope({
      ...input,
      text: "Use current inflation, Fed funds, and market sentiment data to explain what matters most for a balanced U.S. portfolio right now.",
    }, {
      ...compareOutput,
      routeKind: "agent_task",
      route: "fallback",
      workflow: "general_finance_qa",
      entities: { symbols: [] },
      tool_bundles: ["core_market", "macro", "sentiment"],
    });

    expect(planning.taskFamily).toBe("macro_allocation_review");
    expect(planning.policyCardId).toBe("macro_allocation_review");
    expect(planning.evidencePlanId).toBe("market_status");
    expect(planning.answerContractId).toBe("macro_allocation_review");
    expect(planning.commitmentMode).toBe("framework");
    expect(planning.capabilityGapIds).toEqual(expect.arrayContaining([
      "market_calendar",
      "forward_rate_probabilities",
      "sentiment_sample_depth",
    ]));
    expect(planning.behaviorMode).toBe("replacement_active");
  });

  it("runs the options strategy migration slice in replacement-active mode by default", () => {
    const planning = buildPlanningEnvelope({
      ...input,
      text: "I own 100 shares of NVDA at a $500 cost basis. Should I sell covered calls around earnings?",
    }, {
      ...compareOutput,
      routeKind: "workflow_dispatch",
      route: "workflow",
      workflow: "options_screener",
      entities: { symbols: ["NVDA"] },
      tool_bundles: ["core_market", "options", "sentiment", "clarification"],
    });

    expect(planning.taskFamily).toBe("options_strategy");
    expect(planning.policyCardId).toBe("options_strategy");
    expect(planning.evidencePlanId).toBe("placeholder_options_strategy");
    expect(planning.answerContractId).toBe("options_strategy");
    expect(planning.commitmentMode).toBe("decision");
    expect(planning.capabilityGapIds).toEqual([]);
    expect(planning.behaviorMode).toBe("replacement_active");
  });

  it("runs the portfolio review migration slice in replacement-active mode by default", () => {
    const planning = buildPlanningEnvelope({
      ...input,
      text: "Critically evaluate a 60/40 portfolio for the next year. Do not build a new portfolio; just review the existing allocation.",
    }, {
      ...compareOutput,
      routeKind: "agent_task",
      route: "fallback",
      workflow: "general_finance_qa",
      entities: { symbols: [] },
      tool_bundles: ["core_market", "macro", "sentiment", "sec", "clarification"],
    });

    expect(planning.taskFamily).toBe("portfolio_review");
    expect(planning.policyCardId).toBe("portfolio_review");
    expect(planning.evidencePlanId).toBe("placeholder_portfolio_review");
    expect(planning.answerContractId).toBe("portfolio_review");
    expect(planning.commitmentMode).toBe("decision");
    expect(planning.capabilityGapIds).toEqual([]);
    expect(planning.behaviorMode).toBe("replacement_active");
  });

  it("selects portfolio rebalance review policy for existing allocation rebalance prompts", () => {
    const planning = buildPlanningEnvelope({
      ...input,
      text:
        "I have a portfolio that is 55% S&P 500 index, 25% QQQ, 10% bonds, and 10% cash. " +
        "How should I rebalance to reduce concentration and set target bands?",
    }, {
      ...compareOutput,
      routeKind: "agent_task",
      route: "fallback",
      workflow: "general_finance_qa",
      entities: { symbols: [] },
      tool_bundles: ["core_market", "macro"],
    });

    expect(planning.taskFamily).toBe("portfolio_review");
    expect(planning.policyCardId).toBe("portfolio_rebalance_review");
    expect(planning.evidencePlanId).toBe("placeholder_portfolio_review");
    expect(planning.answerContractId).toBe("portfolio_review");
    expect(planning.artifactContractIds).toEqual(["portfolio_exposure_map", "rebalance_action_plan"]);
  });

  it("keeps portfolio rebalance ahead of incidental right-now wording", () => {
    const planning = buildPlanningEnvelope({
      ...input,
      text:
        "My portfolio is heavy on tech right now, about 45% tech, 25% S&P 500 ETFs, and 30% bonds. " +
        "Should I rebalance it?",
    }, {
      ...compareOutput,
      routeKind: "agent_task",
      route: "fallback",
      workflow: "general_finance_qa",
      entities: { symbols: [] },
      tool_bundles: ["core_market", "macro"],
    });

    expect(planning.taskFamily).toBe("portfolio_review");
    expect(planning.policyCardId).toBe("portfolio_rebalance_review");
  });

  it("keeps explicit portfolio construction prompts on portfolio_build", () => {
    const planning = buildPlanningEnvelope({
      ...input,
      text: "Build me a diversified $50k portfolio for a 5 year horizon.",
    }, {
      ...compareOutput,
      routeKind: "workflow_dispatch",
      route: "workflow",
      workflow: "portfolio_builder",
      entities: { symbols: [] },
      tool_bundles: ["core_market", "macro", "sentiment"],
    });

    expect(planning.taskFamily).toBe("portfolio_build");
    expect(planning.policyCardId).toBe("portfolio_build");
  });

  it("runs the backtest review migration slice in replacement-active mode by default", () => {
    const planning = buildPlanningEnvelope({
      ...input,
      text: "Backtest a simple moving average crossover on SPY over 1 year. What was the total return, max drawdown, and is the edge practical after costs?",
    }, {
      ...compareOutput,
      routeKind: "agent_task",
      route: "fallback",
      workflow: "single_asset_analysis",
      entities: { symbols: ["SPY"] },
      tool_bundles: ["core_market", "options", "sentiment", "sec", "clarification"],
    });

    expect(planning.taskFamily).toBe("backtest_review");
    expect(planning.policyCardId).toBe("backtest_review");
    expect(planning.evidencePlanId).toBe("placeholder_backtest_review");
    expect(planning.answerContractId).toBe("backtest_review");
    expect(planning.commitmentMode).toBe("framework");
    expect(planning.capabilityGapIds).toEqual([]);
    expect(planning.behaviorMode).toBe("replacement_active");
  });

  it("runs the stateful tracking migration slice in replacement-active mode by default", () => {
    const planning = buildPlanningEnvelope({
      ...input,
      text: "Record a bullish prediction on AAPL at $248 with conviction 8 for 30 days.",
    }, {
      ...compareOutput,
      routeKind: "agent_task",
      route: "fallback",
      workflow: "watchlist_or_tracking",
      entities: { symbols: ["AAPL"] },
      tool_bundles: ["core_market", "clarification"],
    });

    expect(planning.taskFamily).toBe("stateful_tracking_update");
    expect(planning.policyCardId).toBe("stateful_tracking_update");
    expect(planning.evidencePlanId).toBe("placeholder_stateful_tracking_update");
    expect(planning.answerContractId).toBe("stateful_tracking_update");
    expect(planning.commitmentMode).toBe("update_state");
    expect(planning.capabilityGapIds).toEqual([]);
    expect(planning.behaviorMode).toBe("replacement_active");
  });

  it("enriches deterministic router corrections without overriding them", () => {
    const corrected: RouterOutput = {
      ...compareOutput,
      routeKind: "agent_task",
      route: "fallback",
      workflow: "general_finance_qa",
      tool_bundles: ["core_market", "macro"],
      diagnostics: [
        {
          code: "portfolio_evaluation_corrected_to_agent_task",
          message: "existing allocation review",
        },
      ],
    };

    const planning = buildPlanningEnvelope(
      {
        ...input,
        text: "Critically evaluate a 60/40 portfolio for the next year.",
      },
      corrected,
    );

    expect(planning.taskFamily).toBe("portfolio_review");
    expect(planning.diagnostics).toContainEqual(expect.objectContaining({
      code: "planning_after_router_corrections",
    }));
    expect(corrected.routeKind).toBe("agent_task");
    expect(corrected.workflow).toBe("general_finance_qa");
  });

  it("registers V1 capability gaps with stable descriptions", () => {
    expect(Object.keys(CAPABILITY_GAP_REGISTRY).sort()).toEqual([
      "brokerage_comparison",
      "cash_yield_products",
      "earnings_event_risk",
      "etf_holdings_overlap",
      "forward_rate_probabilities",
      "fund_tax_efficiency",
      "market_calendar",
      "sentiment_sample_depth",
    ]);
    expect(CAPABILITY_GAP_REGISTRY.market_calendar.v1Status).toBe("classified_gap");
    expect(CAPABILITY_GAP_REGISTRY.cash_yield_products.specialistCompetitive).toBe(false);
  });
});
