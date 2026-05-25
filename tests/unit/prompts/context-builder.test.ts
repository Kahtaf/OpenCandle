import { describe, it, expect } from "vitest";
import {
  PromptContextBuilder,
  buildFallbackPlaybook,
  buildRoutePlaybook,
} from "../../../src/prompts/context-builder.js";
import { getPolicyCard } from "../../../src/prompts/policy-cards.js";
import { truncateTobudget } from "../../../src/prompts/sections.js";
import type { ResolvedTurnContext } from "../../../src/routing/turn-context.js";

describe("truncateTobudget", () => {
  it("returns content unchanged when within budget", () => {
    expect(truncateTobudget("short", 100)).toBe("short");
  });

  it("truncates and adds marker when over budget", () => {
    const long = "a".repeat(200);
    const result = truncateTobudget(long, 50);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result).toContain("[...truncated]");
  });

  it("tries to cut at line boundary", () => {
    const content = "line1\nline2\nline3\nline4\nline5";
    const result = truncateTobudget(content, 25);
    expect(result).toContain("[...truncated]");
    // Should cut at a newline, not mid-word
    expect(result).not.toMatch(/\bline\d[^\n]/);
  });
});

describe("PromptContextBuilder", () => {
  it("assembles sections in defined order", () => {
    const builder = new PromptContextBuilder();
    builder.setSection("output-format", "Format here");
    builder.setSection("base-role", "Role here");

    const result = builder.build();
    const roleIndex = result.indexOf("Role here");
    const formatIndex = result.indexOf("Format here");
    expect(roleIndex).toBeLessThan(formatIndex);
  });

  it("skips empty sections", () => {
    const builder = new PromptContextBuilder();
    builder.setSection("base-role", "Role here");
    // memory-context is left empty

    const result = builder.build();
    expect(result).toContain("Role here");
    expect(result).not.toContain("memory-context");
  });

  it("truncates sections that exceed budget", () => {
    const builder = new PromptContextBuilder({ "base-role": 50 });
    builder.setSection("base-role", "x".repeat(200));

    const result = builder.build();
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result).toContain("[...truncated]");
  });

  it("reports section lengths and truncation markers for a built prompt", () => {
    const builder = new PromptContextBuilder({ "base-role": 50 });
    builder.setSection("base-role", "x".repeat(200));

    const { prompt, sections, truncationMarkers } = builder.buildWithReport();

    expect(prompt).toContain("[...truncated]");
    expect(truncationMarkers).toBe(1);
    expect(sections).toContainEqual({
      name: "base-role",
      originalLength: 200,
      renderedLength: 50,
      characterBudget: 50,
      truncated: true,
    });
  });

  it("populateFromOptions sets all standard sections", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      memoryContext: "risk_profile: aggressive",
    });

    const result = builder.build();
    expect(result).toContain("OpenCandle");
    expect(result).toContain("Available Tools");
    expect(result).toContain("risk_profile: aggressive");
    // Output format section still assembles (analyst stance replaces the old
    // Disclaimer block).
    expect(result).toContain("Analytical Framework");
  });

  it("includes add-on tools in tool catalog", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      addonToolDescriptions: ["my_custom_tool: Does something cool"],
    });

    const result = builder.build();
    expect(result).toContain("Add-on Tools");
    expect(result).toContain("my_custom_tool");
  });

  it("injects workflow instructions when provided", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      workflowInstructions: "Build a 5-position portfolio with these constraints...",
    });

    const result = builder.build();
    expect(result).toContain("5-position portfolio");
  });

  it("omits workflow instructions when not provided", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({});

    const result = builder.build();
    // Should still have base role and other sections
    expect(result).toContain("OpenCandle");
    // But no workflow-specific content (we can't easily test absence,
    // but we verify the builder doesn't crash)
  });

  it("includes search_web in tool catalog", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({});

    const result = builder.build();
    expect(result).toContain("search_web");
    expect(result).toContain("Web Search");
  });

  it("includes new sentiment tools in catalog", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({});

    const result = builder.build();
    expect(result).toContain("get_sentiment_trend");
    expect(result).toContain("get_sentiment_summary");
    expect(result).toContain("get_web_sentiment");
  });

  it("hides finance tool catalog when resolved route has no active tools", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput: "Explain how to use valuation ratios.",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: [] },
        slots: {},
        missingRequired: [],
        toolBundles: [],
        activeToolNames: [],
        memoryQueryPlan: {
          routeKind: "agent_task",
          workflow: "general_finance_qa",
          categories: ["investor_profile", "workflow_history"],
          symbols: [],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "agent_task",
        diagnostics: [{ code: "conceptual_education_no_tools", message: "no tools needed" }],
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("No finance tools are needed for this turn");
    expect(result).not.toContain("compare_companies");
    expect(result).not.toContain("compute_dcf");
  });

  it("injects a replacement-active policy card without migrated legacy global clauses", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput: "Is ARMH still the right ticker for Arm?",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: ["ARMH"] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market"],
        activeToolNames: ["search_ticker"],
        memoryQueryPlan: {
          routeKind: "agent_task",
          workflow: "general_finance_qa",
          categories: ["investor_profile", "workflow_history"],
          symbols: ["ARMH"],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "agent_task",
        diagnostics: [],
        planning: {
          version: "planning-v1",
          taskFamily: "ticker_disambiguation",
          commitmentMode: "framework",
          policyCardId: "ticker_disambiguation",
          evidencePlanId: "ticker_disambiguation",
          answerContractId: "ticker_disambiguation",
          structuredCheckIds: ["required_evidence_present"],
          capabilityGapIds: ["earnings_event_risk"],
          behaviorMode: "replacement_active",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: [],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Ticker Disambiguation Policy");
    expect(result).toContain("event-risk framework");
    expect(result).not.toContain("For ticker-alias or alternate-symbol prompts");
    expect(result).not.toContain("If ticker lookup fails but the user is asking an earnings, event-risk, or holdings-risk question");
    expect(result).not.toContain("Sentiment Snapshot Policy");
    expect(result).not.toContain("Asset Compare Policy");
  });

  it("uses the asset-compare policy alongside workflow dispatch context during dual run", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput: "I already own VOO and QQQ. If I add SCHD, am I actually diversifying?",
        priorTurns: [],
        routeKind: "workflow_dispatch",
        legacyRoute: "workflow",
        workflow: "compare_assets",
        entities: { symbols: ["VOO", "QQQ", "SCHD"], compareMetrics: ["overlap"] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market", "macro", "sentiment"],
        activeToolNames: ["get_stock_quote", "compare_companies", "analyze_correlation"],
        memoryQueryPlan: {
          routeKind: "workflow_dispatch",
          workflow: "compare_assets",
          categories: ["investor_profile", "workflow_history"],
          symbols: ["VOO", "QQQ", "SCHD"],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "workflow_dispatch",
        diagnostics: [],
        planning: {
          version: "planning-v1",
          taskFamily: "asset_compare",
          commitmentMode: "compare_tradeoffs",
          policyCardId: "asset_compare",
          evidencePlanId: "placeholder_asset_compare",
          answerContractId: "asset_compare_tradeoff",
          structuredCheckIds: ["required_evidence_present", "data_gap_disclosed", "capability_gap_disclosure"],
          capabilityGapIds: ["etf_holdings_overlap"],
          behaviorMode: "dual_run",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: ["artifact_comparison_table_placeholder"],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Workflow Dispatch Context");
    expect(result).toContain("Asset Compare Policy");
    expect(result).toContain("Compare the requested assets before portfolio construction");
    expect(result).toContain("exact holdings overlap by weight");
  });

  it("uses the asset-compare policy after replacement activation without deleting workflow dispatch context", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput: "Should I prioritize VYM, SCHD, VOO, or QQQ for 10-15 years?",
        priorTurns: [],
        routeKind: "workflow_dispatch",
        legacyRoute: "workflow",
        workflow: "compare_assets",
        entities: { symbols: ["VYM", "SCHD", "VOO", "QQQ"] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market", "macro", "sentiment"],
        activeToolNames: ["get_stock_quote", "compare_companies", "analyze_risk"],
        memoryQueryPlan: {
          routeKind: "workflow_dispatch",
          workflow: "compare_assets",
          categories: ["investor_profile", "workflow_history"],
          symbols: ["VYM", "SCHD", "VOO", "QQQ"],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "workflow_dispatch",
        diagnostics: [],
        planning: {
          version: "planning-v1",
          taskFamily: "asset_compare",
          commitmentMode: "compare_tradeoffs",
          policyCardId: "asset_compare",
          evidencePlanId: "placeholder_asset_compare",
          answerContractId: "asset_compare_tradeoff",
          structuredCheckIds: ["required_evidence_present", "data_gap_disclosed", "capability_gap_disclosure"],
          capabilityGapIds: ["etf_holdings_overlap"],
          behaviorMode: "replacement_active",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: ["artifact_comparison_table_placeholder"],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Workflow Dispatch Context");
    expect(result).toContain("Asset Compare Policy");
    expect(result).toContain("dividend");
    expect(result).toContain("growth");
    expect(result).toContain("tax");
  });

  it("uses the single-asset policy with the legacy single-asset clause during dual run", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput: "Analyze NVDA and tell me whether to buy, wait, or avoid.",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "single_asset_analysis",
        entities: { symbols: ["NVDA"] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market"],
        activeToolNames: ["get_stock_quote", "get_financials", "analyze_risk"],
        memoryQueryPlan: {
          routeKind: "agent_task",
          workflow: "single_asset_analysis",
          categories: ["investor_profile", "workflow_history"],
          symbols: ["NVDA"],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "agent_task",
        diagnostics: [],
        planning: {
          version: "planning-v1",
          taskFamily: "single_asset_decision",
          commitmentMode: "decision",
          policyCardId: "single_asset_decision",
          evidencePlanId: "placeholder_single_asset_decision",
          answerContractId: "single_asset_decision",
          structuredCheckIds: ["required_evidence_present", "freshness_disclosed", "data_gap_disclosed"],
          capabilityGapIds: [],
          behaviorMode: "dual_run",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: [],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Single Asset Decision Policy");
    expect(result).toContain("For single-asset recommendation prompts");
    expect(result).toContain("state the quote or tool-output date");
  });

  it("uses the single-asset policy without retaining the legacy single-asset clause after replacement activation", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput: "Analyze NVDA and tell me whether to buy, wait, or avoid.",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "single_asset_analysis",
        entities: { symbols: ["NVDA"] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market"],
        activeToolNames: ["get_stock_quote", "get_financials", "analyze_risk"],
        memoryQueryPlan: {
          routeKind: "agent_task",
          workflow: "single_asset_analysis",
          categories: ["investor_profile", "workflow_history"],
          symbols: ["NVDA"],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "agent_task",
        diagnostics: [],
        planning: {
          version: "planning-v1",
          taskFamily: "single_asset_decision",
          commitmentMode: "decision",
          policyCardId: "single_asset_decision",
          evidencePlanId: "placeholder_single_asset_decision",
          answerContractId: "single_asset_decision",
          structuredCheckIds: ["required_evidence_present", "freshness_disclosed", "data_gap_disclosed"],
          capabilityGapIds: [],
          behaviorMode: "replacement_active",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: [],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Single Asset Decision Policy");
    expect(result).not.toContain("For single-asset recommendation prompts");
    expect(result).toContain("quote or tool-output date");
    expect(result).toContain("market-closed");
    expect(result).toContain("unavailable DCF");
  });

  it("does not reference get_reddit_discussions", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({});

    const result = builder.build();
    expect(result).not.toContain("get_reddit_discussions");
  });

  it("get_reddit_sentiment description mentions cross-subreddit", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({});

    const result = builder.build();
    expect(result).toContain("get_reddit_sentiment");
  });

  it("instructs rate-cut market-pricing questions to use futures/FedWatch search", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({});

    const result = builder.build();
    expect(result).toContain("CME FedWatch");
    expect(result).toContain("Federal Funds futures");
  });

  it("tells fallback sentiment answers to include source-coverage risk", () => {
    const result = buildFallbackPlaybook({
      assumptionsBlock: "No assumptions.",
      missingRequired: [],
    });

    expect(result).toContain("sentiment-only");
    expect(result).toContain("score scale");
    expect(result).toContain("why those missing sources matter");
    expect(result).toContain("source-coverage risk");
    expect(result).toContain("low sample counts");
    expect(result).toContain("downgrade confidence");
    expect(result).toContain("For ticker-specific sentiment prompts, call get_stock_quote");
    expect(result).toContain("whether sentiment diverges from price action");
  });

  it("tells fallback sector research to include segmentation and scenario confidence", () => {
    const result = buildFallbackPlaybook({
      assumptionsBlock: "No assumptions.",
      missingRequired: [],
    });

    expect(result).toContain("industry or sector structure");
    expect(result).toContain("lead with a 2-3 sentence thesis");
    expect(result).toContain("segmentation table");
    expect(result).toContain("key company examples/types");
    expect(result).toContain("technology or business-model timeline");
    expect(result).toContain("likely winners/losers");
    expect(result).toContain("scenario");
    expect(result).toContain("confidence");
    expect(result).toContain("key indicators");
    expect(result).toContain("geopolitical");
    expect(result).toContain("technology impact");
    expect(result).toContain("Infer the relevant technologies");
    expect(result).toContain("constraints, moats, company strategies");
    expect(result).toContain("fetched evidence");
    expect(result).toContain("investor or strategic takeaways");
    expect(result).toContain("not a generic follow-up offer");
    expect(result).toContain("value-chain impact");
    expect(result).not.toContain("semiconductors");
    expect(result).not.toContain("CUDA");
    expect(result).not.toContain("silicon photonics");
  });

  it("tells broad research to degrade gracefully after web search gaps", () => {
    const result = buildFallbackPlaybook({
      assumptionsBlock: "No assumptions.",
      missingRequired: [],
    });

    expect(result).toContain("web search returns no results");
    expect(result).toContain("credential-required provider tags");
    expect(result).toContain("continue with the best high-level analysis");
    expect(result).toContain("Label the live-data gap");
    expect(result).toContain("Do not stop with a tool-failure apology");
    expect(result).toContain("Do not turn a missing-provider tag into a final answer that only asks the user to connect a provider");
    expect(result).toContain("For macro-risk prompts, produce a ranked risk list");
    expect(result).toContain("Never say you cannot provide an assessment at this time");
    expect(result).toContain("For portfolio-allocation macro prompts, critique structural exposures");
    expect(result).toContain("stock-bond correlation");
    expect(result).toContain("specific percentage or trigger");
    expect(result).toContain("scenario table");
    expect(result).toContain("portfolio exposure map");
    expect(result).toContain("Do not describe the analysis as hypothetical");
    expect(result).toContain("name the provider or source family and observation date");
    expect(result).toContain("compact structural-bias read");
    expect(result).toContain("what it does not fix");
    expect(result).toContain("state the trend direction");
    expect(result).toContain("estimate the order of magnitude of the impact");
    expect(result).toContain("End macro portfolio answers with a short bottom line");
    expect(result).toContain("For prompts that ask to critically evaluate an existing portfolio or allocation");
    expect(result).toContain("Structural portfolio read");
    expect(result).toContain("What this does not fix");
    expect(result).toContain("Do not begin with process narration");
    expect(result).toContain("weave each current datapoint into the relevant sleeve");
  });

  it("tells filing thesis prompts to distinguish filing evidence from adjacent sources", () => {
    const result = buildFallbackPlaybook({
      assumptionsBlock: "No assumptions.",
      missingRequired: [],
    });

    expect(result).toContain("SEC filing or thesis-change prompts");
    expect(result).toContain("call get_sec_filings first");
    expect(result).toContain("targeted search_web queries");
    expect(result).toContain("risk factors");
    expect(result).toContain("MD&A");
    expect(result).toContain("litigation");
    expect(result).toContain("regulatory disclosures");
    expect(result).toContain("revenue concentration");
    expect(result).toContain("Separate what came from filing metadata");
    expect(result).toContain("If the full filing body was not parsed");
    expect(result).toContain("Do not treat search_web/news results as SEC filing evidence");
    expect(result).toContain("Do not claim an Item 5.02, management change, risk-factor change, or thesis-changing event unless that fact appears in get_sec_filings output");
    expect(result).toContain("thesis-changing deltas");
  });

  it("tells single-asset recommendations to disclose data freshness and fallback valuation lenses", () => {
    const result = buildFallbackPlaybook({
      assumptionsBlock: "No assumptions.",
      missingRequired: [],
    });

    expect(result).toContain("single-asset recommendation prompts");
    expect(result).toContain("right now");
    expect(result).toContain("state the quote or tool-output date");
    expect(result).toContain("market is closed");
    expect(result).toContain("last available quote");
    expect(result).toContain("valuation model is unavailable or not meaningful");
    expect(result).toContain("do not treat that absence as the valuation conclusion");
    expect(result).toContain("Do not make missing fundamentals the main thesis");
    expect(result).toContain("position sizing");
    expect(result).toContain("entry strategy");
    expect(result).toContain("relative multiples");
    expect(result).toContain("growth-adjusted multiples");
    expect(result).toContain("cash-flow quality");
  });

  it("tells retail account and product-selection answers not to punt when no live tool exists", () => {
    const result = buildFallbackPlaybook({
      assumptionsBlock: "No assumptions.",
      missingRequired: [],
    });

    expect(result).toContain("brokerage, account, fund-platform, or financial-product selection prompts");
    expect(result).toContain("Do not punt just because no dedicated live-data tool exists");
    expect(result).toContain("cash sweep yields");
    expect(result).toContain("fractional shares");
    expect(result).toContain("fund minimums");
    expect(result).toContain("ETF tax efficiency");
    expect(result).toContain("simple next step");
  });

  it("moves unknown-ticker earnings guidance to the ticker-disambiguation policy card", () => {
    const result = getPolicyCard("ticker_disambiguation").content;

    expect(result).toContain("lookup or company overview evidence is unavailable");
    expect(result).toContain("earnings");
    expect(result).toContain("event-risk framework");
    expect(result).toContain("gap risk");
    expect(result).toContain("guidance");
    expect(result).toContain("position size");
    expect(result).toContain("trim");
    expect(buildFallbackPlaybook({
      assumptionsBlock: "No assumptions.",
      missingRequired: [],
    })).not.toContain("ticker lookup fails");
  });

  it("tells crypto sizing answers to include drawdown math and implementation rules", () => {
    const result = buildFallbackPlaybook({
      assumptionsBlock: "No assumptions.",
      missingRequired: [],
    });

    expect(result).toContain("crypto position-sizing");
    expect(result).toContain("allocation range");
    expect(result).toContain("drawdown");
    expect(result).toContain("sleep test");
    expect(result).toContain("dollar-cost averaging");
    expect(result).toContain("rebalancing rules");
    expect(result).toContain("emergency fund");
    const fullPrompt = new PromptContextBuilder().populateFromOptions({}).build();
    expect(fullPrompt).toContain("For crypto position-sizing prompts");
    expect(fullPrompt).toContain("history period");
    expect(fullPrompt).toContain("sparse or unavailable history");
  });

  it("tells today-move answers to check market status before causal claims", () => {
    const result = buildFallbackPlaybook({
      assumptionsBlock: "No assumptions.",
      missingRequired: [],
    });

    expect(result).toContain("\"today\"");
    expect(result).toContain("market status");
    expect(result).toContain("weekend or market holiday");
    expect(result).toContain("lead with that");
    expect(result).toContain("do not invent");
    expect(result).toContain("most recent trading day");
  });

  it("moves ticker-alias guidance to the ticker-disambiguation policy card", () => {
    const result = getPolicyCard("ticker_disambiguation").content;

    expect(result).toContain("current primary ticker");
    expect(result).toContain("current primary ticker");
    expect(result).toContain("legacy ticker");
    expect(result).toContain("former ticker");
    expect(result).toContain("foreign listing");
    expect(result).toContain("company overview evidence is unavailable");
    expect(result).toContain("business-model");
    expect(result).toContain("licensing");
    expect(buildFallbackPlaybook({
      assumptionsBlock: "No assumptions.",
      missingRequired: [],
    })).not.toContain("ticker-alias or alternate-symbol prompts");
  });

  it("uses the current-event policy without retaining the legacy today-move clause after replacement activation", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput: "Why did Boeing move today?",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: ["BA"] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market"],
        activeToolNames: ["get_stock_quote", "search_web"],
        memoryQueryPlan: {
          routeKind: "agent_task",
          workflow: "general_finance_qa",
          categories: ["investor_profile", "workflow_history"],
          symbols: ["BA"],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "agent_task",
        diagnostics: [],
        planning: {
          version: "planning-v1",
          taskFamily: "current_event_explanation",
          commitmentMode: "framework",
          policyCardId: "current_event_explanation",
          evidencePlanId: "market_status",
          answerContractId: "current_event_explanation",
          structuredCheckIds: ["required_evidence_present", "freshness_disclosed"],
          capabilityGapIds: ["market_calendar"],
          behaviorMode: "replacement_active",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: [],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Current Event Explanation Policy");
    expect(result).not.toContain("For \"today\" or \"why did it move today\" prompts");
    expect(result).toContain("market-status evidence");
  });

  it("uses the concept policy without retaining the legacy conceptual-education clause after replacement activation", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput: "Explain how to use P/E ratios without over relying on them.",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: [] },
        slots: {},
        missingRequired: [],
        toolBundles: [],
        activeToolNames: [],
        memoryQueryPlan: {
          routeKind: "agent_task",
          workflow: "general_finance_qa",
          categories: ["investor_profile", "workflow_history"],
          symbols: [],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "agent_task",
        diagnostics: [{ code: "conceptual_education_no_tools", message: "no tools needed" }],
        planning: {
          version: "planning-v1",
          taskFamily: "concept_explainer",
          commitmentMode: "framework",
          policyCardId: "concept_explainer",
          evidencePlanId: "placeholder_concept_explainer",
          answerContractId: "concept_explainer",
          structuredCheckIds: ["commitment_mode_respected"],
          capabilityGapIds: [],
          behaviorMode: "replacement_active",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: [],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Concept Explainer Policy");
    expect(result).not.toContain("For conceptual or educational finance prompts: use a decision-framework shape");
    expect(result).toContain("Bottom line");
    expect(result).toContain("Core mental model");
  });

  it("uses the sentiment policy with the legacy sentiment clause during dual run", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput: "What’s the retail mood around GME right now across Reddit, X/Twitter, and recent news, and is it diverging from price action?",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: ["GME"] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market", "sentiment"],
        activeToolNames: ["get_stock_quote", "get_sentiment_summary"],
        memoryQueryPlan: {
          routeKind: "agent_task",
          workflow: "general_finance_qa",
          categories: ["investor_profile", "workflow_history"],
          symbols: ["GME"],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "agent_task",
        diagnostics: [],
        planning: {
          version: "planning-v1",
          taskFamily: "sentiment_snapshot",
          commitmentMode: "framework",
          policyCardId: "sentiment_snapshot",
          evidencePlanId: "placeholder_sentiment_snapshot",
          answerContractId: "sentiment_snapshot",
          structuredCheckIds: ["required_evidence_present", "source_coverage_disclosed", "data_gap_disclosed"],
          capabilityGapIds: ["sentiment_sample_depth"],
          behaviorMode: "dual_run",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: ["artifact_source_coverage_placeholder"],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Sentiment Snapshot Policy");
    expect(result).toContain("For sentiment-only prompts: final answer must include");
    expect(result).toContain("source-coverage risk");
    expect(result).toContain("whether sentiment diverges from price action");
  });

  it("uses the sentiment policy without retaining the legacy sentiment clause after replacement activation", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput: "What’s the retail mood around GME right now across Reddit, X/Twitter, and recent news, and is it diverging from price action?",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: ["GME"] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market", "sentiment"],
        activeToolNames: ["get_stock_quote", "get_sentiment_summary"],
        memoryQueryPlan: {
          routeKind: "agent_task",
          workflow: "general_finance_qa",
          categories: ["investor_profile", "workflow_history"],
          symbols: ["GME"],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "agent_task",
        diagnostics: [],
        planning: {
          version: "planning-v1",
          taskFamily: "sentiment_snapshot",
          commitmentMode: "framework",
          policyCardId: "sentiment_snapshot",
          evidencePlanId: "placeholder_sentiment_snapshot",
          answerContractId: "sentiment_snapshot",
          structuredCheckIds: ["required_evidence_present", "source_coverage_disclosed", "data_gap_disclosed"],
          capabilityGapIds: ["sentiment_sample_depth"],
          behaviorMode: "replacement_active",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: ["artifact_source_coverage_placeholder"],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Sentiment Snapshot Policy");
    expect(result).not.toContain("For sentiment-only prompts: final answer must include");
    expect(result).toContain("source-coverage risk");
    expect(result).toContain("diverges from price action");
  });

  it("uses the filing policy with the legacy SEC filing clause during dual run", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput: "Look at COIN's latest 10-Q. Separate SEC filing evidence from news.",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "single_asset_analysis",
        entities: { symbols: ["COIN"] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market", "sec"],
        activeToolNames: ["get_sec_filings", "search_web"],
        memoryQueryPlan: {
          routeKind: "agent_task",
          workflow: "single_asset_analysis",
          categories: ["investor_profile", "workflow_history"],
          symbols: ["COIN"],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "agent_task",
        diagnostics: [],
        planning: {
          version: "planning-v1",
          taskFamily: "filing_thesis_review",
          commitmentMode: "framework",
          policyCardId: "filing_thesis_review",
          evidencePlanId: "placeholder_filing_thesis_review",
          answerContractId: "filing_thesis_review",
          structuredCheckIds: ["required_evidence_present", "data_gap_disclosed"],
          capabilityGapIds: [],
          behaviorMode: "dual_run",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: ["artifact_filing_change_placeholder"],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Filing Thesis Review Policy");
    expect(result).toContain("For SEC filing or thesis-change prompts");
    expect(result).toContain("Do not treat search_web/news results as SEC filing evidence");
  });

  it("uses the filing policy without retaining the legacy SEC filing clause after replacement activation", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput: "Look at COIN's latest 10-Q. Separate SEC filing evidence from news.",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "single_asset_analysis",
        entities: { symbols: ["COIN"] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market", "sec"],
        activeToolNames: ["get_sec_filings", "search_web"],
        memoryQueryPlan: {
          routeKind: "agent_task",
          workflow: "single_asset_analysis",
          categories: ["investor_profile", "workflow_history"],
          symbols: ["COIN"],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "agent_task",
        diagnostics: [],
        planning: {
          version: "planning-v1",
          taskFamily: "filing_thesis_review",
          commitmentMode: "framework",
          policyCardId: "filing_thesis_review",
          evidencePlanId: "placeholder_filing_thesis_review",
          answerContractId: "filing_thesis_review",
          structuredCheckIds: ["required_evidence_present", "data_gap_disclosed"],
          capabilityGapIds: [],
          behaviorMode: "replacement_active",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: ["artifact_filing_change_placeholder"],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Filing Thesis Review Policy");
    expect(result).not.toContain("targeted search_web queries for the requested filing sections or themes");
    expect(result).toContain("filing metadata");
    expect(result).toContain("filing-section summaries");
  });

  it("uses the retail policy with the legacy retail clause during dual run", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput: "I’m opening a taxable account and want simple recurring ETF investing. Which brokerage would you pick?",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: [] },
        slots: {},
        missingRequired: [],
        toolBundles: [],
        activeToolNames: [],
        memoryQueryPlan: {
          routeKind: "agent_task",
          workflow: "general_finance_qa",
          categories: ["investor_profile", "workflow_history"],
          symbols: [],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "agent_task",
        diagnostics: [],
        planning: {
          version: "planning-v1",
          taskFamily: "retail_finance_tradeoff",
          commitmentMode: "framework",
          policyCardId: "retail_finance_tradeoff",
          evidencePlanId: "placeholder_retail_finance_tradeoff",
          answerContractId: "retail_tradeoff_framework",
          structuredCheckIds: ["data_gap_disclosed", "capability_gap_disclosure"],
          capabilityGapIds: ["brokerage_comparison", "cash_yield_products", "fund_tax_efficiency"],
          behaviorMode: "dual_run",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: ["artifact_comparison_table_placeholder"],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Retail Finance Tradeoff Policy");
    expect(result).toContain("For brokerage, account, fund-platform, or financial-product selection prompts");
    expect(result).toContain("Do not punt just because no dedicated live-data tool exists");
  });

  it("uses the retail policy without retaining the legacy retail clause after replacement activation", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput: "Where should I keep cash I might need in 6-12 months: HYSA, money-market fund, T-bills, CDs, or a bond ETF?",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: [] },
        slots: {},
        missingRequired: [],
        toolBundles: [],
        activeToolNames: [],
        memoryQueryPlan: {
          routeKind: "agent_task",
          workflow: "general_finance_qa",
          categories: ["investor_profile", "workflow_history"],
          symbols: [],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "agent_task",
        diagnostics: [],
        planning: {
          version: "planning-v1",
          taskFamily: "retail_finance_tradeoff",
          commitmentMode: "compare_tradeoffs",
          policyCardId: "retail_finance_tradeoff",
          evidencePlanId: "placeholder_retail_finance_tradeoff",
          answerContractId: "retail_tradeoff_framework",
          structuredCheckIds: ["data_gap_disclosed", "capability_gap_disclosure"],
          capabilityGapIds: ["brokerage_comparison", "cash_yield_products", "fund_tax_efficiency"],
          behaviorMode: "replacement_active",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: ["artifact_comparison_table_placeholder"],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Retail Finance Tradeoff Policy");
    expect(result).not.toContain("For brokerage, account, fund-platform, or financial-product selection prompts");
    expect(result).toContain("current yield facts");
    expect(result).toContain("FDIC/SIPC/Treasury");
  });

  it("tells educational finance prompts to include behavioral and practical frameworks", () => {
    const result = buildFallbackPlaybook({
      assumptionsBlock: "No assumptions.",
      missingRequired: [],
    });

    expect(result).toContain("conceptual or educational finance prompts");
    expect(result).toContain("decision-framework shape");
    expect(result).toContain("Do not fetch live data unless the user asks for current examples");
    expect(result).toContain("do not mention OpenCandle tool names");
    expect(result).toContain("Bottom line");
    expect(result).toContain("practical step-by-step workflow");
    expect(result).toContain("evidence/base-rate view");
    expect(result).toContain("concrete study names or rough percentages");
    expect(result).toContain("behavioral or implementation tradeoff");
    expect(result).toContain("simple self-check questions");
    expect(result).toContain("different investor profiles");
    expect(result).toContain("common traps to avoid");
    expect(result).toContain("practical middle-ground");
    expect(result).toContain("For \"how to use [metric] without over-relying\" prompts");
    expect(result).toContain("the final answer must use these sections");
    expect(result).toContain("include a one-sentence Core mental model");
    expect(result).toContain("Bottom line must frame the metric as a starting point or question generator");
    expect(result).toContain("the workflow section must be numbered question-driven application steps");
    expect(result).toContain("not a second limitations list");
    expect(result).toContain("Where it misleads section must cover common traps");
    expect(result).toContain("quality of earnings distortions");
    expect(result).toContain("final checklist should reinforce the decision framework");
    expect(result).toContain("\"Practical workflow\"");
    expect(result).toContain("\"Where it misleads\"");
    expect(result).toContain("\"Cross-checks\"");
    expect(result).toContain("\"Quick checklist\"");
    expect(result).toContain("valuation-metric education");
    expect(result).toContain("screening tool or question generator");
    expect(result).toContain("short step-by-step checklist");
    expect(result).toContain("compact cross-check table");
    expect(result).toContain("metric/lens");
    expect(result).toContain("when to use it");
    expect(result).toContain("perfect\" multiple");
    expect(result).toContain("cyclicals at peak/trough earnings");
    expect(result).toContain("one-time or non-cash earnings");
    expect(result).toContain("capital-structure differences");
    expect(result).toContain("GAAP vs adjusted");
    expect(result).toContain("free cash flow");
    expect(result).toContain("interest-rate regime shifts");
    expect(result).toContain("stock-based compensation");
    expect(result).toContain("cyclically adjusted ratios such as Shiller/CAPE");
    expect(result).toContain("Do not use \"Commitment\"");
    expect(result).toContain("education rather than a trade");
    expect(result).toContain("For conceptual education answers, use the educational section order above");
    expect(result).toContain("keep tool names out of the final answer");
    expect(result).toContain("Conceptual education prompts are not committal responses");
    expect(result).toContain("Do not append \"Analyst View\"");
    expect(result).toContain("explanation, definition, or learning framework");
    expect(result).toContain("do not add analyst commitment/confidence/invalidation labels");
  });

  it("documents supported search freshness values and forbids unsupported ranges", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({});

    const result = builder.build();
    expect(result).toContain("Supported freshness values are hours, day, week, and month");
    expect(result).toContain("category general with freshness month");
    expect(result).toContain("never pass unsupported values such as all, year, 3mo");
  });

  it("tells fallback macro-policy research to map mechanisms and country examples", () => {
    const result = buildFallbackPlaybook({
      assumptionsBlock: "No assumptions.",
      missingRequired: [],
    });

    expect(result).toContain("mechanism map");
    expect(result).toContain("country");
    expect(result).toContain("currency");
    expect(result).toContain("capital flows");
  });

  it("tells U.S. macro fallbacks to search direct U.S. sources and market indicators", () => {
    const result = buildFallbackPlaybook({
      assumptionsBlock: "No assumptions.",
      missingRequired: [],
    });

    expect(result).toContain("For U.S. macro or U.S.-heavy portfolio prompts");
    expect(result).toContain("Federal Reserve SEP");
    expect(result).toContain("BLS CPI");
    expect(result).toContain("BEA PCE");
    expect(result).toContain("Treasury yield");
    expect(result).toContain("DXY");
    expect(result).toContain("IG OAS");
    expect(result).toContain("avoid broad global-only searches");
  });

  it("renders clarification playbook from resolved route context", () => {
    const result = buildRoutePlaybook({
      userInput: "build me an options setup",
      priorTurns: [],
      routeKind: "clarification",
      legacyRoute: "fallback",
      workflow: "options_screener",
      entities: { symbols: [] },
      slots: {},
      missingRequired: ["symbol"],
      toolBundles: ["clarification"],
      activeToolNames: ["ask_user"],
      memoryQueryPlan: {
        routeKind: "clarification",
        workflow: "options_screener",
        categories: ["investor_profile", "workflow_history"],
        symbols: [],
        slotKeys: [],
      },
      memoryProvenance: [],
      promptPlaybook: "clarification",
      diagnostics: [],
    } satisfies ResolvedTurnContext);

    expect(result).toContain("Clarification Playbook");
    expect(result).toContain("symbol");
    expect(result).toContain("ask_user");
  });

  it("renders pass-through playbook without finance tool instructions", () => {
    const result = buildRoutePlaybook({
      userInput: "write a haiku",
      priorTurns: [],
      routeKind: "pass_through",
      legacyRoute: "fallback",
      entities: { symbols: [] },
      slots: {},
      missingRequired: [],
      toolBundles: [],
      activeToolNames: [],
      memoryQueryPlan: {
        routeKind: "pass_through",
        categories: [],
        symbols: [],
        slotKeys: [],
      },
      memoryProvenance: [],
      promptPlaybook: "pass_through",
      diagnostics: [],
    } satisfies ResolvedTurnContext);

    expect(result).toContain("Pass-Through Playbook");
    expect(result).toContain("without invoking finance tools");
  });

  it("includes sentiment source-coverage risk guidance in the standard prompt", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({});

    const result = builder.build();
    expect(result).toContain("sentiment-only");
    expect(result).toContain("score scale");
    expect(result).toContain("why those missing sources matter");
    expect(result).toContain("source-coverage risk");
    expect(result).toContain("low sample counts");
    expect(result).toContain("downgrade confidence");
    expect(result).toContain("For ticker-specific sentiment prompts, call get_stock_quote");
    expect(result).toContain("whether sentiment diverges from price action");
  });

  it("requires full backtest metric reporting", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({});

    const result = builder.build();
    expect(result).toContain("backtest_strategy");
    expect(result).toContain("win rate");
    expect(result).toContain("max drawdown");
    expect(result).toContain("Sharpe or Sortino");
    expect(result).toContain("trading costs/slippage");
  });

  it("assembled prompt contains no refusal / fiduciary-advisor vocabulary", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      workflowInstructions: "Build a portfolio for $10k",
      memoryContext: "risk_profile: aggressive",
    });
    const result = builder.build();
    expect(result).not.toMatch(/\bfinancial advice\b/i);
    expect(result).not.toMatch(/\bnot financial advice\b/i);
    expect(result).not.toMatch(/\bconsult (?:a )?qualified (?:financial )?advisor/i);
    expect(result).not.toMatch(/\bstandard disclaimer\b/i);
  });

  it("contains analyst-stance content in base-role and output-format", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({});
    const result = builder.build();
    expect(result.toLowerCase()).toContain("analyst");
    expect(result.toLowerCase()).toContain("invalidation");
    expect(result.toLowerCase()).toContain("confidence");
  });

  it("base role exempts conceptual education from analyst-view boilerplate", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({});
    const result = builder.build();
    expect(result).toContain("For conceptual education questions");
    expect(result).toContain("teach the concept directly");
    expect(result).toContain("do not name tool functions");
    expect(result).toContain("do not append analyst-view, confidence-band, or invalidation boilerplate");
    expect(result).toContain("For valuation-metric education");
    expect(result).toContain("start with \"Bottom line\"");
    expect(result).toContain("one-sentence paragraph beginning \"Core mental model:\"");
    expect(result).toContain("heading exactly named \"Practical workflow\"");
    expect(result).toContain("numbered question-driven application steps");
    expect(result).toContain("common traps to avoid");
    expect(result).toContain("cross-check table with why/when");
    expect(result).toContain("trailing, forward, normalized, or cyclically adjusted variants");
    expect(result).toContain("where the metric misleads");
    expect(result).toContain("heading exactly named \"Quick checklist\"");
  });

  it("stance is present on every workflow type and the unclassified path", () => {
    for (const workflowType of ["portfolio_builder", "options_screener", "compare_assets", "unclassified"]) {
      const builder = new PromptContextBuilder();
      builder.populateFromOptions({
        workflowType,
        workflowInstructions: workflowType === "unclassified" ? undefined : `Workflow: ${workflowType}`,
      });
      const result = builder.build();
      expect(result.toLowerCase()).toContain("analyst");
      expect(result.toLowerCase()).toContain("invalidation");
      expect(result).not.toMatch(/\bnot financial advice\b/i);
      expect(result).not.toMatch(/\bstandard disclaimer\b/i);
    }
  });
});
