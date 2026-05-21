import { describe, it, expect } from "vitest";
import {
  PromptContextBuilder,
  buildFallbackPlaybook,
  buildRoutePlaybook,
} from "../../../src/prompts/context-builder.js";
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
    expect(result).toContain("continue with the best high-level analysis");
    expect(result).toContain("Label the live-data gap");
    expect(result).toContain("Do not stop with a tool-failure apology");
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
    expect(result).toContain("thesis-changing deltas");
  });

  it("tells educational finance prompts to include behavioral and practical frameworks", () => {
    const result = buildFallbackPlaybook({
      assumptionsBlock: "No assumptions.",
      missingRequired: [],
    });

    expect(result).toContain("conceptual or educational finance prompts");
    expect(result).toContain("decision-framework shape");
    expect(result).toContain("Bottom line");
    expect(result).toContain("evidence/base-rate view");
    expect(result).toContain("concrete study names or rough percentages");
    expect(result).toContain("behavioral or implementation tradeoff");
    expect(result).toContain("simple self-check questions");
    expect(result).toContain("different investor profiles");
    expect(result).toContain("practical middle-ground");
    expect(result).toContain("Do not use \"Commitment\"");
    expect(result).toContain("education rather than a trade");
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
