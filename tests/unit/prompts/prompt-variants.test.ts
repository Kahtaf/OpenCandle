import { describe, expect, it } from "vitest";
import type { PromptContextOptions } from "../../../src/prompts/context-builder.js";
import { PromptContextBuilder } from "../../../src/prompts/context-builder.js";
import type { ResolvedTurnContext } from "../../../src/routing/turn-context.js";

function context(overrides: Partial<ResolvedTurnContext>): ResolvedTurnContext {
  return {
    userInput: "analyze AAPL",
    priorTurns: [],
    routeKind: "agent_task",
    legacyRoute: "fallback",
    workflow: "general_finance_qa",
    entities: { symbols: ["AAPL"] },
    slots: {},
    missingRequired: [],
    toolBundles: ["core_market"],
    activeToolNames: ["get_stock_quote", "search_ticker"],
    memoryQueryPlan: {
      routeKind: "agent_task",
      workflow: "general_finance_qa",
      categories: ["investor_profile", "workflow_history"],
      symbols: ["AAPL"],
      slotKeys: [],
    },
    memoryProvenance: [],
    promptPlaybook: "agent_task",
    diagnostics: [],
    ...overrides,
  };
}

const promptVariants: Array<{ name: string; options: PromptContextOptions }> = [
  { name: "standard", options: {} },
  {
    name: "fallback",
    options: {
      fallbackContext: {
        assumptionsBlock: "Assumptions Context:\n  symbol: AAPL (user)",
        missingRequired: [],
        extraContext: "Router-extracted symbols: AAPL. Route kind: agent_task.",
      },
    },
  },
  {
    name: "workflow dispatch",
    options: {
      resolvedTurnContext: context({
        routeKind: "workflow_dispatch",
        legacyRoute: "workflow",
        workflow: "compare_assets",
        entities: { symbols: ["VOO", "SCHD"] },
        toolBundles: ["core_market", "macro", "sentiment"],
      }),
    },
  },
  {
    name: "clarification",
    options: {
      resolvedTurnContext: context({
        routeKind: "clarification",
        missingRequired: ["symbol"],
        toolBundles: ["clarification"],
        activeToolNames: ["ask_user"],
      }),
    },
  },
  {
    name: "pass-through",
    options: {
      resolvedTurnContext: context({
        routeKind: "pass_through",
        workflow: undefined,
        entities: { symbols: [] },
        toolBundles: [],
        activeToolNames: [],
      }),
    },
  },
  {
    name: "no-tool",
    options: {
      resolvedTurnContext: context({
        userInput: "Explain how to use valuation ratios.",
        entities: { symbols: [] },
        toolBundles: [],
        activeToolNames: [],
        diagnostics: [{ code: "conceptual_education_no_tools", message: "no tools needed" }],
      }),
    },
  },
];

describe("production prompt variants", () => {
  it("characterizes section lengths and truncation markers", () => {
    const reports = promptVariants.map(({ name, options }) => {
      const report = new PromptContextBuilder().populateFromOptions(options).buildWithReport();
      return {
        name,
        totalLength: report.prompt.length,
        truncationMarkers: report.truncationMarkers,
        sections: report.sections.map((section) => ({
          name: section.name,
          originalLength: section.originalLength,
          renderedLength: section.renderedLength,
          characterBudget: section.characterBudget,
          truncated: section.truncated,
        })),
      };
    });

    expect(reports).toHaveLength(promptVariants.length);
    for (const report of reports) {
      expect(report.totalLength).toBeGreaterThan(0);
      expect(report.sections.length).toBeGreaterThan(0);
    }
  });

  it("does not truncate active non-memory sections", () => {
    for (const { name, options } of promptVariants) {
      const report = new PromptContextBuilder().populateFromOptions(options).buildWithReport();
      const truncatedActiveSections = report.sections
        .filter((section) => section.name !== "memory-context")
        .filter((section) => section.truncated);

      expect(truncatedActiveSections, `${name} active sections should not truncate`).toEqual([]);
    }
  });
});
