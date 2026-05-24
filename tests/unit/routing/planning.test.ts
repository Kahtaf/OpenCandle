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
    expect(planning.behaviorMode).toBe("observe_only");
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
    const planning = buildPlanningEnvelope(input, compareOutput);

    expect(planning.behaviorMode).toBe("observe_only");
    expect(planning.diagnostics).toContainEqual(expect.objectContaining({
      code: "planning_observe_only",
    }));
  });

  it("runs the selected ticker-disambiguation migration slice in dual-run mode", () => {
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
    expect(planning.behaviorMode).toBe("dual_run");
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
