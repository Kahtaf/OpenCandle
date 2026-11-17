import { describe, expect, it } from "vitest";
import { buildResolvedTurnContext } from "../../../src/routing/index.js";
import { route } from "../../../src/routing/router.js";
import type { RouterInputContext } from "../../../src/routing/router-types.js";

const input = (text: string): RouterInputContext => ({
  text,
  priorTurns: [],
  profileSnapshot: {},
  recentWorkflowRuns: [],
});

function client(workflow: string, symbols: string[] = []) {
  return {
    async complete() {
      return JSON.stringify({
        routeKind: workflow === "general_finance_qa" ? "agent_task" : "workflow_dispatch",
        workflow,
        entities: { symbols, timeHorizon: "6mo" },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "fixed classification",
      });
    },
  };
}

describe("asset-linked choices", () => {
  for (const workflow of ["general_finance_qa", "portfolio_builder", "options_screener"]) {
    it.each([
      ["For the next 6 months, should I use BND or SGOV as a reserve?", ["BND", "SGOV"]],
      ["Should I buy HD or TGT?", ["HD", "TGT"]],
      ["Should I buy HD or TGT.", ["HD", "TGT"]],
      ["Would you choose IEF or SHY for my portfolio?", ["IEF", "SHY"]],
      ["Which should I hold, VTI or VXUS?", ["VTI", "VXUS"]],
      ["Should I prioritize VYM or SCHD for income?", ["VYM", "SCHD"]],
      ["I own MSFT. Should I hold $HD or $TGT for 6 months? AAPL is a peer.", ["HD", "TGT"]],
    ])(`recovers %s from ${workflow}`, async (text, symbols) => {
      const request = input(text);
      const result = await route(request, client(workflow, [...symbols].reverse()));
      expect(result.routeKind).toBe("workflow_dispatch");
      expect(result.workflow).toBe("compare_assets");
      expect(result.entities.symbols).toEqual(symbols);
      expect(result.entities.timeHorizon).toBe("6mo");
      expect(result.missing_required).toEqual([]);
      expect(buildResolvedTurnContext(request, result).planning).toMatchObject({
        taskFamily: "asset_compare",
        commitmentMode: "compare_tradeoffs",
        answerContractId: "asset_compare_tradeoff",
      });
    });
  }

  it("grounds cashtags without model-supplied assets", async () => {
    const result = await route(input("Should I use $BND or $SGOV?"), client("general_finance_qa"));
    expect(result.workflow).toBe("compare_assets");
    expect(result.entities.symbols).toEqual(["BND", "SGOV"]);
    expect(result.missing_required).toEqual([]);
  });

  it.each([
    [
      "Should I buy calls or puts on HD? TGT is only a peer reference.",
      "options_screener",
      "options_screener",
    ],
    [
      "Review the concentration risk in my HD and TGT holdings; should I trim now or wait?",
      "portfolio_builder",
      "general_finance_qa",
    ],
    [
      "Build a portfolio using BND and SGOV; should I fund it today or tomorrow?",
      "portfolio_builder",
      "portfolio_builder",
    ],
    ["Build a portfolio. Should I use BND or SGOV?", "portfolio_builder", "portfolio_builder"],
    [
      "Add HD and TGT to my watchlist; should I label it income or growth?",
      "portfolio_builder",
      "watchlist_or_tracking",
    ],
    [
      "HD and TGT are in my account. Should I use a limit order or a market order?",
      "portfolio_builder",
      "portfolio_builder",
    ],
    [
      "Should I download quotes for HD or export a report about TGT?",
      "portfolio_builder",
      "portfolio_builder",
    ],
    ["My broker supports BND or SGOV.", "general_finance_qa", "general_finance_qa"],
    ["TGT rallied. Should I use HD or wait?", "general_finance_qa", "general_finance_qa"],
    ["Should I use HD or cash?", "general_finance_qa", "general_finance_qa"],
    ["Should I use GDP or CPI for this analysis?", "general_finance_qa", "general_finance_qa"],
  ])("preserves the route for %s", async (text, initial, expected) => {
    const result = await route(input(text), client(initial));
    expect(result.workflow).toBe(expected);
    if (expected === "general_finance_qa" || expected === "watchlist_or_tracking") {
      expect(result.routeKind).toBe("agent_task");
    }
  });

  it("preserves existing portfolio-risk review precedence for a direct choice", async () => {
    const result = await route(
      input("Should I hold HD or TGT to reduce my portfolio risks?"),
      client("general_finance_qa"),
    );
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.routeKind).toBe("agent_task");
  });
});
