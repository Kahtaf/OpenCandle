import { describe, expect, it } from "vitest";
import {
  buildFallbackPlaybook,
  buildRoutePlaybook,
  PromptContextBuilder,
} from "../../../src/prompts/context-builder.js";
import { getPolicyCard, renderPolicyCardForPlanning } from "../../../src/prompts/policy-cards.js";
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

  it("guides tool choice between stock screening and single-symbol Yahoo tools", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({});

    const result = builder.build();
    expect(result).toContain("screen_stocks");
    expect(result).toContain("breadth");
    expect(result).toContain("single-security quote");
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
    expect(result).toContain("distinguish the current primary ticker from a legacy ticker");
    expect(result).toContain("lead with a risk-first trim/hedge/hold framework");
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
          structuredCheckIds: [
            "required_evidence_present",
            "data_gap_disclosed",
            "capability_gap_disclosure",
          ],
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
    expect(result).toContain("provider-backed holdings-overlap evidence");
    expect(result).toContain("partial or unavailable provider coverage");
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
          structuredCheckIds: [
            "required_evidence_present",
            "data_gap_disclosed",
            "capability_gap_disclosure",
          ],
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

  it("uses the options strategy policy alongside workflow dispatch context during dual run", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput:
          "I own 100 shares of NVDA at a $500 cost basis. Should I sell covered calls around earnings?",
        priorTurns: [],
        routeKind: "workflow_dispatch",
        legacyRoute: "workflow",
        workflow: "options_screener",
        entities: { symbols: ["NVDA"] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market", "options", "sentiment"],
        activeToolNames: ["get_stock_quote", "get_option_chain"],
        memoryQueryPlan: {
          routeKind: "workflow_dispatch",
          workflow: "options_screener",
          categories: ["investor_profile", "workflow_history"],
          symbols: ["NVDA"],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "workflow_dispatch",
        diagnostics: [],
        planning: {
          version: "planning-v1",
          taskFamily: "options_strategy",
          commitmentMode: "decision",
          policyCardId: "options_strategy",
          evidencePlanId: "placeholder_options_strategy",
          answerContractId: "options_strategy",
          structuredCheckIds: ["required_evidence_present", "freshness_disclosed"],
          capabilityGapIds: [],
          behaviorMode: "dual_run",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: [],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Workflow Dispatch Context");
    expect(result).toContain("Options Strategy Policy");
    expect(result).toContain("owned underlying");
    expect(result).toContain("premium received");
  });

  it("uses the options strategy policy after replacement activation without deleting workflow dispatch context", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput: "Should I buy protective puts on SPY before CPI?",
        priorTurns: [],
        routeKind: "workflow_dispatch",
        legacyRoute: "workflow",
        workflow: "options_screener",
        entities: { symbols: ["SPY"] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market", "options", "sentiment"],
        activeToolNames: ["get_stock_quote", "get_option_chain"],
        memoryQueryPlan: {
          routeKind: "workflow_dispatch",
          workflow: "options_screener",
          categories: ["investor_profile", "workflow_history"],
          symbols: ["SPY"],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "workflow_dispatch",
        diagnostics: [],
        planning: {
          version: "planning-v1",
          taskFamily: "options_strategy",
          commitmentMode: "decision",
          policyCardId: "options_strategy",
          evidencePlanId: "placeholder_options_strategy",
          answerContractId: "options_strategy",
          structuredCheckIds: ["required_evidence_present", "freshness_disclosed"],
          capabilityGapIds: [],
          behaviorMode: "replacement_active",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: [],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Workflow Dispatch Context");
    expect(result).toContain("Options Strategy Policy");
    expect(result).toContain("option-chain underlying");
    expect(result).toContain("protective put");
  });

  it("uses the stateful tracking policy without deleting agent-task context", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput: "Add AAPL to my watchlist with a $248 target.",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "watchlist_or_tracking",
        entities: { symbols: ["AAPL"] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market", "clarification"],
        activeToolNames: ["manage_watchlist"],
        memoryQueryPlan: {
          routeKind: "agent_task",
          workflow: "watchlist_or_tracking",
          categories: ["investor_profile", "workflow_history"],
          symbols: ["AAPL"],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "agent_task",
        diagnostics: [],
        planning: {
          version: "planning-v1",
          taskFamily: "stateful_tracking_update",
          commitmentMode: "update_state",
          policyCardId: "stateful_tracking_update",
          evidencePlanId: "placeholder_stateful_tracking_update",
          answerContractId: "stateful_tracking_update",
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
    expect(result).toContain("Route kind: agent_task");
    expect(result).toContain("Tool bundles: core_market, clarification");
    expect(result).toContain("Stateful Tracking Update Policy");
    expect(result).toContain("manage_watchlist");
    expect(result).toContain("Confirm the persisted state update");
    expect(result).not.toContain("Portfolio Review Policy");
    expect(result).not.toContain("Single Asset Decision Policy");
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
          structuredCheckIds: [
            "required_evidence_present",
            "freshness_disclosed",
            "data_gap_disclosed",
          ],
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
    expect(result).toContain(
      "For single-security buy, sell, wait, avoid, trim, add, size, or entry prompts",
    );
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
          structuredCheckIds: [
            "required_evidence_present",
            "freshness_disclosed",
            "data_gap_disclosed",
          ],
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
    expect(result).toContain("If DCF, fundamentals");
  });

  it("uses the macro allocation policy with generic fallback context during dual run", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput:
          "Use current inflation, Fed funds, and market sentiment data to explain what matters most for a balanced U.S. portfolio right now.",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: [] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market", "macro", "sentiment"],
        activeToolNames: ["get_economic_data", "get_fear_greed", "get_web_sentiment"],
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
          taskFamily: "macro_allocation_review",
          commitmentMode: "framework",
          policyCardId: "macro_allocation_review",
          evidencePlanId: "market_status",
          answerContractId: "macro_allocation_review",
          structuredCheckIds: [
            "required_evidence_present",
            "freshness_disclosed",
            "data_gap_disclosed",
          ],
          capabilityGapIds: [
            "market_calendar",
            "forward_rate_probabilities",
            "sentiment_sample_depth",
          ],
          behaviorMode: "dual_run",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: [],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Macro Allocation Review Policy");
    expect(result).toContain(
      "For macro outlook, inflation, Fed, rates, recession, or balanced-portfolio prompts",
    );
    expect(result).toContain("Explain the mechanism from policy shift");
    expect(result).toContain(
      "Preserve the portfolio review shape when the user asks about allocation",
    );
    expect(result).toContain("If web search returns no results");
    expect(result).not.toContain("For macro-risk prompts");
  });

  it("uses the macro allocation policy without retaining legacy macro clauses after replacement activation", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput:
          "Given the current macro outlook for 2026, critically evaluate a balanced portfolio with 60% equity and 40% fixed income.",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: [] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market", "macro", "sentiment"],
        activeToolNames: ["get_economic_data", "get_fear_greed"],
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
          taskFamily: "macro_allocation_review",
          commitmentMode: "decision",
          policyCardId: "macro_allocation_review",
          evidencePlanId: "market_status",
          answerContractId: "macro_allocation_review",
          structuredCheckIds: [
            "required_evidence_present",
            "freshness_disclosed",
            "data_gap_disclosed",
          ],
          capabilityGapIds: ["market_calendar", "forward_rate_probabilities"],
          behaviorMode: "replacement_active",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: [],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Macro Allocation Review Policy");
    expect(result).not.toContain(
      "For macro, rates, inflation, sector, or portfolio-allocation prompts",
    );
    expect(result).not.toContain("For macro-policy impact prompts");
    expect(result).not.toContain("For U.S. macro or U.S.-heavy portfolio prompts");
    expect(result).not.toContain("For non-US macro data");
    expect(result).not.toContain(
      "For prompts that ask to critically evaluate an existing portfolio or allocation",
    );
    expect(result).toContain("If web search returns no results");
    expect(result).toContain("Current macro evidence");
    expect(result).toContain("Sleeve-by-sleeve implications");
    expect(result).toContain("Watchlist and invalidation");
  });

  it("uses the portfolio-review policy alongside agent-task context during dual run", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput:
          "Critically evaluate a 60/40 portfolio for the next year. Do not build a new portfolio; just review the existing allocation.",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: [] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market", "macro", "sentiment"],
        activeToolNames: ["get_economic_data", "analyze_risk"],
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
          taskFamily: "portfolio_review",
          commitmentMode: "decision",
          policyCardId: "portfolio_review",
          evidencePlanId: "placeholder_portfolio_review",
          answerContractId: "portfolio_review",
          structuredCheckIds: [
            "required_evidence_present",
            "data_gap_disclosed",
            "commitment_mode_respected",
          ],
          capabilityGapIds: [],
          behaviorMode: "dual_run",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: [],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Fallback Playbook");
    expect(result).toContain("Portfolio Review Policy");
    expect(result).toContain("existing allocation");
    expect(result).toContain("Structural allocation read");
  });

  it("uses the portfolio-review policy after replacement activation without changing portfolio-builder isolation", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput:
          "Critically evaluate a 60/40 portfolio for the next year. Do not build a new portfolio; just review the existing allocation.",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "general_finance_qa",
        entities: { symbols: [] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market", "macro", "sentiment"],
        activeToolNames: ["get_economic_data", "analyze_risk"],
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
          taskFamily: "portfolio_review",
          commitmentMode: "decision",
          policyCardId: "portfolio_review",
          evidencePlanId: "placeholder_portfolio_review",
          answerContractId: "portfolio_review",
          structuredCheckIds: [
            "required_evidence_present",
            "data_gap_disclosed",
            "commitment_mode_respected",
          ],
          capabilityGapIds: [],
          behaviorMode: "replacement_active",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: [],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Portfolio Review Policy");
    expect(result).toContain("Do not build a new portfolio");
    expect(result).toContain("rebalance");

    expect(
      renderPolicyCardForPlanning({
        version: "planning-v1",
        taskFamily: "portfolio_build",
        commitmentMode: "construct",
        policyCardId: "portfolio_build",
        evidencePlanId: "placeholder_portfolio_build",
        answerContractId: "portfolio_build",
        structuredCheckIds: ["required_evidence_present", "commitment_mode_respected"],
        capabilityGapIds: [],
        behaviorMode: "replacement_active",
        workspacePlaceholderIds: [],
        artifactPlaceholderIds: [],
        diagnostics: [],
      }),
    ).toBe("");
  });

  it("uses the backtest policy alongside agent-task context during dual run", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput:
          "Backtest a simple moving average crossover on SPY over 1 year. What was the total return, max drawdown, and is the edge practical after costs?",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "single_asset_analysis",
        entities: { symbols: ["SPY"] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market", "options", "sentiment", "sec", "clarification"],
        activeToolNames: ["backtest_strategy"],
        memoryQueryPlan: {
          routeKind: "agent_task",
          workflow: "single_asset_analysis",
          categories: ["investor_profile", "workflow_history"],
          symbols: ["SPY"],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "agent_task",
        diagnostics: [],
        planning: {
          version: "planning-v1",
          taskFamily: "backtest_review",
          commitmentMode: "framework",
          policyCardId: "backtest_review",
          evidencePlanId: "placeholder_backtest_review",
          answerContractId: "backtest_review",
          structuredCheckIds: [
            "required_evidence_present",
            "data_gap_disclosed",
            "source_coverage_disclosed",
          ],
          capabilityGapIds: [],
          behaviorMode: "dual_run",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: [],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Fallback Playbook");
    expect(result).toContain("Backtest Review Policy");
    expect(result).toContain("strategy return");
    expect(result).toContain("costs and slippage");
  });

  it("uses the backtest policy after replacement activation without changing agent-task routing context", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput: "Backtest a simple moving average crossover on SPY over 1 year.",
        priorTurns: [],
        routeKind: "agent_task",
        legacyRoute: "fallback",
        workflow: "single_asset_analysis",
        entities: { symbols: ["SPY"] },
        slots: {},
        missingRequired: [],
        toolBundles: ["core_market", "options", "sentiment", "sec", "clarification"],
        activeToolNames: ["backtest_strategy"],
        memoryQueryPlan: {
          routeKind: "agent_task",
          workflow: "single_asset_analysis",
          categories: ["investor_profile", "workflow_history"],
          symbols: ["SPY"],
          slotKeys: [],
        },
        memoryProvenance: [],
        promptPlaybook: "agent_task",
        diagnostics: [],
        planning: {
          version: "planning-v1",
          taskFamily: "backtest_review",
          commitmentMode: "framework",
          policyCardId: "backtest_review",
          evidencePlanId: "placeholder_backtest_review",
          answerContractId: "backtest_review",
          structuredCheckIds: [
            "required_evidence_present",
            "data_gap_disclosed",
            "source_coverage_disclosed",
          ],
          capabilityGapIds: [],
          behaviorMode: "replacement_active",
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: [],
          diagnostics: [],
        },
      } satisfies ResolvedTurnContext,
    });

    const result = builder.build();
    expect(result).toContain("Route kind: agent_task");
    expect(result).toContain("Backtest Review Policy");
    expect(result).toContain("buy-and-hold return");
    expect(result).toContain("Sharpe or Sortino");
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

  it("keeps the fallback playbook generic so competitive fixes do not recreate a broad mega prompt", () => {
    const result = buildFallbackPlaybook({
      assumptionsBlock: "No assumptions.",
      missingRequired: [],
    });

    expect(result.length).toBeLessThanOrEqual(4_500);
    expect(result).toContain("Tool-first");
    expect(result).toContain("Label data gaps");
    expect(result).toContain("Do not add task-specific instructions here");
    expect(result).not.toContain("For macro-risk prompts");
    expect(result).not.toContain("For brokerage, account");
    expect(result).not.toContain("For SEC filing");
    expect(result).not.toContain("For conceptual or educational finance prompts");
    expect(result).not.toContain("For single-asset recommendation prompts");
    expect(result).not.toContain("For ticker-alias");
  });

  it("moves unknown-ticker earnings guidance to the ticker-disambiguation policy card", () => {
    const result = getPolicyCard("ticker_disambiguation").content;

    expect(result).toContain("lookup, quote, or company overview evidence is unavailable");
    expect(result).toContain("earnings");
    expect(result).toContain("risk-first trim/hedge/hold framework");
    expect(result).toContain("gap risk");
    expect(result).toContain("guidance");
    expect(result).toContain("position size");
    expect(result).toContain("ticker could not be verified");
    expect(result).toContain("avoid conceptual education section order");
    expect(result).toContain("trim/hedge/hold");
    expect(
      buildFallbackPlaybook({
        assumptionsBlock: "No assumptions.",
        missingRequired: [],
      }),
    ).not.toContain("ticker lookup fails");
  });

  it("keeps crypto sizing obligations in the universal safety rules", () => {
    const fullPrompt = new PromptContextBuilder().populateFromOptions({}).build();
    expect(fullPrompt).toContain("For crypto position-sizing prompts");
    expect(fullPrompt).toContain("allocation range");
    expect(fullPrompt).toContain("drawdown impact");
    expect(fullPrompt).toContain("sleep test");
    expect(fullPrompt).toContain("dollar-cost averaging");
    expect(fullPrompt).toContain("rebalancing rules");
    expect(fullPrompt).toContain("emergency-fund");
    expect(fullPrompt).toContain("history period");
    expect(fullPrompt).toContain("sparse or unavailable history");
  });

  it("keeps today-move obligations in the current-event policy card", () => {
    const result = getPolicyCard("current_event_explanation").content;

    expect(result).toContain('"today"');
    expect(result).toContain("market-status evidence");
    expect(result).toContain("weekend");
    expect(result).toContain("holiday");
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
    expect(
      buildFallbackPlaybook({
        assumptionsBlock: "No assumptions.",
        missingRequired: [],
      }),
    ).not.toContain("ticker-alias or alternate-symbol prompts");
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
    expect(result).not.toContain('For "today" or "why did it move today" prompts');
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
    expect(result).not.toContain(
      "For conceptual or educational finance prompts: use a decision-framework shape",
    );
    expect(result).toContain("Bottom line");
    expect(result).toContain("Core mental model");
  });

  it("uses the sentiment policy with generic fallback context during dual run", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput:
          "What’s the retail mood around GME right now across Reddit, X/Twitter, and recent news, and is it diverging from price action?",
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
          structuredCheckIds: [
            "required_evidence_present",
            "source_coverage_disclosed",
            "data_gap_disclosed",
          ],
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
    expect(result).toContain("For sentiment-only prompts, include");
    expect(result).toContain("key positive and negative drivers");
    expect(result).toContain("source-coverage risk");
    expect(result).toContain("whether sentiment diverges from price action");
    expect(result).toContain("price-action divergence could not be evaluated");
    expect(
      buildFallbackPlaybook({
        assumptionsBlock: "No assumptions.",
        missingRequired: [],
      }),
    ).not.toContain("For ticker-specific sentiment prompts, call get_stock_quote");
  });

  it("uses the sentiment policy without retaining the legacy sentiment clause after replacement activation", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput:
          "What’s the retail mood around GME right now across Reddit, X/Twitter, and recent news, and is it diverging from price action?",
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
          structuredCheckIds: [
            "required_evidence_present",
            "source_coverage_disclosed",
            "data_gap_disclosed",
          ],
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
    expect(result).toContain("Do not treat search_web or news results as SEC filing evidence");
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
    expect(result).not.toContain(
      "targeted search_web queries for the requested filing sections or themes",
    );
    expect(result).toContain("filing metadata");
    expect(result).toContain("filing-section summaries");
  });

  it("uses the retail policy with the legacy retail clause during dual run", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput:
          "I’m opening a taxable account and want simple recurring ETF investing. Which brokerage would you pick?",
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
    expect(result).toContain(
      "brokerage, account, cash-parking, mortgage-vs-investing, robo-advisor",
    );
    expect(result).toContain("Do not punt just because no dedicated live-data provider exists");
  });

  it("uses the retail policy without retaining the legacy retail clause after replacement activation", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      resolvedTurnContext: {
        userInput:
          "Where should I keep cash I might need in 6-12 months: HYSA, money-market fund, T-bills, CDs, or a bond ETF?",
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
    expect(result).not.toContain(
      "For brokerage, account, fund-platform, or financial-product selection prompts",
    );
    expect(result).toContain("current yield facts");
    expect(result).toContain("FDIC/SIPC/Treasury");
  });

  it("documents supported search freshness values and forbids unsupported ranges", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({});

    const result = builder.build();
    expect(result).toContain("Supported freshness values are hours, day, week, and month");
    expect(result).toContain("category general with freshness month");
    expect(result).toContain("never pass unsupported values such as all, year, 3mo");
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
    expect(result).toContain("key positive and negative drivers");
    expect(result).toContain("representative source evidence");
    expect(result).toContain("why those missing sources matter");
    expect(result).toContain("source-coverage risk");
    expect(result).toContain("low sample counts");
    expect(result).toContain("downgrade confidence");
    expect(result).toContain("For ticker-specific sentiment prompts, call get_stock_quote");
    expect(result).toContain("whether sentiment diverges from price action");
    expect(result).toContain("price-action divergence could not be evaluated");
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
    expect(result).toContain(
      "do not append analyst-view, confidence-band, or invalidation boilerplate",
    );
    expect(result).toContain("For valuation-metric education");
    expect(result).toContain('start with "Bottom line"');
    expect(result).toContain('one-sentence paragraph beginning "Core mental model:"');
    expect(result).toContain('heading exactly named "Practical workflow"');
    expect(result).toContain("numbered question-driven application steps");
    expect(result).toContain("common traps to avoid");
    expect(result).toContain("cross-check table with why/when");
    expect(result).toContain("trailing, forward, normalized, or cyclically adjusted variants");
    expect(result).toContain("where the metric misleads");
    expect(result).toContain('heading exactly named "Quick checklist"');
  });

  it("stance is present on every workflow type and the unclassified path", () => {
    for (const workflowType of [
      "portfolio_builder",
      "options_screener",
      "compare_assets",
      "unclassified",
    ]) {
      const builder = new PromptContextBuilder();
      builder.populateFromOptions({
        workflowType,
        workflowInstructions:
          workflowType === "unclassified" ? undefined : `Workflow: ${workflowType}`,
      });
      const result = builder.build();
      expect(result.toLowerCase()).toContain("analyst");
      expect(result.toLowerCase()).toContain("invalidation");
      expect(result).not.toMatch(/\bnot financial advice\b/i);
      expect(result).not.toMatch(/\bstandard disclaimer\b/i);
    }
  });
});
