import { describe, it, expect, vi } from "vitest";
import { route, validateRouterOutput } from "../../../src/routing/router.js";
import { buildRouterPrompt } from "../../../src/routing/router-prompt.js";
import {
  activeToolsForBundles,
  buildResolvedTurnContext,
  ROUTE_CAPABILITY_MANIFEST,
  TOOL_BUNDLE_TOOLS,
} from "../../../src/routing/index.js";
import type {
  RouterInputContext,
  RouterLlmClient,
  RouterOutput,
} from "../../../src/routing/router-types.js";
import { PromptContextBuilder } from "../../../src/prompts/context-builder.js";

const BASE_INPUT: RouterInputContext = {
  text: "analyze AAPL",
  priorTurns: [],
  profileSnapshot: {},
  recentWorkflowRuns: [],
};

function fixedClient(text: string): RouterLlmClient {
  return { async complete() { return text; } };
}

describe("validateRouterOutput", () => {
  it("accepts a minimal valid fallback output", () => {
    const out = validateRouterOutput(
      JSON.stringify({
        route: "fallback",
        entities: { symbols: ["AAPL"] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "x",
      }),
    );
    expect(out.route).toBe("fallback");
    expect(out.entities.symbols).toEqual(["AAPL"]);
  });

  it("accepts compare metrics emitted by the router", () => {
    const out = validateRouterOutput(
      JSON.stringify({
        route: "workflow",
        workflow: "compare_assets",
        entities: { symbols: ["BTC", "GLD"], compareMetrics: ["macro_hedge"] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "x",
      }),
    );

    expect(out.entities.compareMetrics).toEqual(["macro_hedge"]);
  });

  it("accepts protective-put strategy and share quantity emitted by the router", () => {
    const out = validateRouterOutput(
      JSON.stringify({
        route: "workflow",
        workflow: "options_screener",
        entities: {
          symbols: ["NVDA"],
          direction: "bearish",
          optionStrategy: "protective_put",
          shareQuantity: 200,
        },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "x",
      }),
    );

    expect(out.entities.optionStrategy).toBe("protective_put");
    expect(out.entities.shareQuantity).toBe(200);
  });

  it("rejects invalid route", () => {
    expect(() =>
      validateRouterOutput(
        JSON.stringify({
          route: "direct_tool",
          entities: { symbols: [] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "",
        }),
      ),
    ).toThrow(/invalid route/);
  });

  it("rejects workflow route without a workflow name", () => {
    expect(() =>
      validateRouterOutput(
        JSON.stringify({
          route: "workflow",
          entities: { symbols: [] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "",
        }),
      ),
    ).toThrow(/workflow route requires/);
  });

  it("rejects invalid slot source", () => {
    expect(() =>
      validateRouterOutput(
        JSON.stringify({
          route: "fallback",
          entities: { symbols: [] },
          slots: { foo: { value: 1, source: "unknown", confidence: "high" } },
          preference_updates: [],
          missing_required: [],
          reasoning: "",
        }),
      ),
    ).toThrow(/invalid source/);
  });

  it("tolerates ```json fenced payloads", () => {
    const out = validateRouterOutput(
      "```json\n" +
        JSON.stringify({
          route: "fallback",
          entities: { symbols: [] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "",
        }) +
        "\n```",
    );
    expect(out.route).toBe("fallback");
  });

  it("normalizes omitted preference_updates[].source to 'inferred'", () => {
    const out = validateRouterOutput(
      JSON.stringify({
        route: "fallback",
        entities: { symbols: [] },
        slots: {},
        preference_updates: [
          { key: "risk_profile", value: "aggressive", confidence: "high" },
        ],
        missing_required: [],
        reasoning: "",
      }),
    );
    expect(out.preference_updates[0].source).toBe("inferred");
  });

  it("rejects preference_updates[].source other than 'inferred'", () => {
    expect(() =>
      validateRouterOutput(
        JSON.stringify({
          route: "fallback",
          entities: { symbols: [] },
          slots: {},
          preference_updates: [
            { key: "risk_profile", value: "aggressive", confidence: "high", source: "user" },
          ],
          missing_required: [],
          reasoning: "",
        }),
      ),
    ).toThrow(/source must be "inferred"/);
  });
});

describe("route()", () => {
  it("keeps valid LLM route kind authoritative when legacy rules would classify differently", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "analyze NVDA" },
      fixedClient(JSON.stringify({
        routeKind: "agent_task",
        entities: { symbols: ["NVDA"] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        diagnostics: [],
        reasoning: "valid llm classification",
      })),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.workflow).toBeUndefined();
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
      code: "deterministic_failure_recovery",
    }));
  });

  it("returns validated output on first successful call", async () => {
    const expected = {
      routeKind: "workflow_dispatch",
      route: "workflow",
      workflow: "single_asset_analysis",
      entities: { symbols: ["AAPL"] },
      slots: { symbol: { value: "AAPL", source: "user", confidence: "high" } },
      preference_updates: [],
      missing_required: [],
      tool_bundles: [],
      diagnostics: [],
      reasoning: "simple",
    } satisfies RouterOutput;
    const client = fixedClient(JSON.stringify(expected));
    const result = await route(BASE_INPUT, client);
    expect(result).toMatchObject({
      routeKind: "agent_task",
      route: "fallback",
      workflow: "single_asset_analysis",
      entities: { symbols: ["AAPL"] },
      slots: expected.slots,
      preference_updates: [],
      missing_required: [],
      reasoning: "simple",
    });
    expect(result.tool_bundles).toContain("core_market");
  });

  it("normalizes dispatchable compare workflow emitted as agent_task to workflow_dispatch", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "I already own VOO and QQQ. If I add SCHD, am I actually diversifying or just buying more of the same stuff?",
      },
      fixedClient(JSON.stringify({
        routeKind: "agent_task",
        workflow: "compare_assets",
        entities: { symbols: ["VOO", "QQQ", "SCHD"] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        diagnostics: [],
        reasoning: "compare assets but wrong route kind",
      })),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.route).toBe("workflow");
    expect(result.workflow).toBe("compare_assets");
    expect(result.entities.compareMetrics).toEqual(["overlap"]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "dispatchable_workflow_corrected_to_workflow_dispatch",
    }));
  });

  it("merges deterministic overlap focus when router emits a different compare metric", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Does buying QQQ on top of VOO create too much overlap?",
      },
      fixedClient(JSON.stringify({
        routeKind: "workflow_dispatch",
        workflow: "compare_assets",
        entities: { symbols: ["VOO", "QQQ"], compareMetrics: ["sentiment"] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        diagnostics: [],
        reasoning: "compare assets",
      })),
    );

    expect(result.entities.compareMetrics).toEqual(["sentiment", "overlap"]);
  });

  it("keeps crypto sizing out of portfolio construction when the user asks allocation range and drawdown", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "I have a $75k portfolio and want BTC exposure. What allocation range would you use, and how bad could the drawdown feel?",
      },
      fixedClient(JSON.stringify({
        routeKind: "workflow_dispatch",
        workflow: "portfolio_builder",
        entities: { symbols: ["BTC"], budget: 75_000 },
        slots: {},
        preference_updates: [],
        missing_required: [],
        diagnostics: [],
        reasoning: "mistaken portfolio builder",
      })),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "crypto_sizing_corrected_to_agent_task",
    }));
  });

  it("preserves portfolio construction when bitcoin is one sleeve in an explicit build request", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Build me a $75k portfolio with a small bitcoin allocation.",
      },
      fixedClient(JSON.stringify({
        routeKind: "workflow_dispatch",
        workflow: "portfolio_builder",
        entities: { symbols: ["BTC"], budget: 75_000 },
        slots: {},
        preference_updates: [],
        missing_required: [],
        diagnostics: [],
        reasoning: "portfolio build with bitcoin sleeve",
      })),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.workflow).toBe("portfolio_builder");
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
      code: "crypto_sizing_corrected_to_agent_task",
    }));
  });

  it("retries once on validation failure", async () => {
    const bad = JSON.stringify({ route: "nope" });
    const good = JSON.stringify({
      route: "fallback",
      entities: { symbols: [] },
      slots: {},
      preference_updates: [],
      missing_required: [],
      reasoning: "",
    });
    let call = 0;
    const client: RouterLlmClient = {
      async complete() {
        call += 1;
        return call === 1 ? bad : good;
      },
    };
    const result = await route({ ...BASE_INPUT, text: "hello" }, client);
    expect(result.route).toBe("fallback");
    expect(call).toBe(2);
  });

  it("emits minimal fallback after persistent failure", async () => {
    const client: RouterLlmClient = {
      async complete() {
        return "not json at all";
      },
    };
    const result = await route(
      { ...BASE_INPUT, text: "hello" },
      client,
    );
    expect(result.route).toBe("fallback");
    expect(result.entities.symbols).toEqual([]);
    expect(result.missing_required).toEqual([]);
  });

  it("upgrades persistent router validation failure when deterministic rules can classify", async () => {
    const client: RouterLlmClient = {
      async complete() {
        return "not json at all";
      },
    };
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Analyze the current market structure of the semiconductor industry and predict how emerging technologies like AI could reshape it over the next decade.",
      },
      client,
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.entities.symbols).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "deterministic_failure_recovery",
    }));
  });

  it("enriches omitted compare focus from deterministic extraction", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "For the next 6 months, should I use BTC or GLD as a macro hedge?" },
      fixedClient(JSON.stringify({
        route: "workflow",
        workflow: "compare_assets",
        entities: { symbols: ["BTC", "GLD"] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "x",
      })),
    );

    expect(result.entities.timeHorizon).toBe("6mo");
    expect(result.entities.compareMetrics).toEqual(["macro_hedge"]);
  });

  it("keeps valid LLM agent-task fallback but drops ambiguous concept symbols", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Analyze the current market structure of the semiconductor industry and predict how emerging technologies like AI could reshape it over the next decade.",
      },
      fixedClient(JSON.stringify({
        route: "fallback",
        entities: { symbols: ["AI"] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "broad research prompt",
      })),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.workflow).toBeUndefined();
    expect(result.entities.symbols).toEqual([]);
  });

  it("keeps ambiguous symbols when the user explicitly asks for the ticker", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Analyze AI stock",
      },
      fixedClient(JSON.stringify({
        route: "fallback",
        entities: { symbols: ["AI"] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "single ticker request",
      })),
    );

    expect(result.entities.symbols).toEqual(["AI"]);
  });

  it("corrects macro data prompts misread as ticker comparisons", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Use get_economic_data to show FRED CPI inflation data",
      },
      fixedClient(JSON.stringify({
        routeKind: "workflow_dispatch",
        workflow: "compare_assets",
        entities: { symbols: ["FRED", "CPI"] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "misread source and macro acronym as tickers",
      })),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.entities.symbols).toEqual([]);
    expect(result.tool_bundles).toContain("macro");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "compare_route_corrected_to_macro_task",
    }));
  });

  it("keeps macro tools in scope after router validation fallback", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Use get_economic_data to show FRED CPI inflation data",
      },
      fixedClient("not json"),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.entities.symbols).toEqual([]);
    expect(result.tool_bundles).toContain("macro");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "macro_task_inferred_from_prompt",
    }));
  });

  it("keeps macro-risk portfolio discussion as an agent task after router validation fallback", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "What macro risks matter most for a balanced portfolio right now?",
      },
      fixedClient("not json"),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.missing_required).toEqual([]);
    expect(result.tool_bundles).toContain("macro");
    expect(result.tool_bundles).not.toEqual(["clarification"]);
  });

  it("keeps existing-allocation evaluation as an agent task after router validation fallback", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Critically evaluate a balanced portfolio with 60% equity and 40% fixed income for the next 12-18 months.",
      },
      fixedClient("not json"),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.missing_required).toEqual([]);
    expect(result.tool_bundles).toContain("macro");
  });

  it("corrects portfolio-builder output for existing-allocation evaluation prompts", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Evaluate the prospects of a 60/40 portfolio over the next year and suggest one risk mitigation adjustment.",
      },
      fixedClient(JSON.stringify({
        routeKind: "workflow_dispatch",
        workflow: "portfolio_builder",
        entities: { symbols: [] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "misread evaluation as construction",
      })),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.missing_required).toEqual([]);
    expect(result.tool_bundles).toContain("macro");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "portfolio_evaluation_corrected_to_agent_task",
    }));
  });

  it("corrects compare-assets output for existing-portfolio crash-risk prompts", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "I've got about $50,000 invested, mostly in SPY and a little MSFT. I'm 40 and planning for retirement in 25 years. I'm worried about a big market crash. Does this portfolio look too risky and what's a simple way to protect myself without missing growth?",
      },
      fixedClient(JSON.stringify({
        routeKind: "workflow_dispatch",
        workflow: "compare_assets",
        entities: { symbols: ["SPY", "MSFT"] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "misread portfolio review as asset comparison",
      })),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "portfolio_evaluation_corrected_to_agent_task",
    }));
  });

  it("corrects portfolio-builder clarification for existing-allocation rebalance prompts", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text:
          "My portfolio is 45% tech stocks, 25% S&P 500 ETFs, and 30% bonds. " +
          "Should I rebalance to diversify more?",
      },
      fixedClient(JSON.stringify({
        routeKind: "clarification",
        workflow: "portfolio_builder",
        entities: { symbols: [] },
        slots: {},
        preference_updates: [],
        missing_required: ["budget"],
        reasoning: "misread rebalance as construction",
      })),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.missing_required).toEqual([]);
    expect(result.tool_bundles).toContain("macro");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "portfolio_evaluation_corrected_to_agent_task",
    }));
  });

  it("corrects portfolio-builder output for explicit multi-ETF tradeoff prompts", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "If I have $5,000 for 10-15 years, should I prioritize VYM or SCHD, or something more growth-oriented like VOO or QQQ? What are the tradeoffs?",
      },
      fixedClient(JSON.stringify({
        routeKind: "workflow_dispatch",
        workflow: "portfolio_builder",
        entities: { symbols: ["VYM", "SCHD", "VOO", "QQQ"], budget: 5000 },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "misread tradeoff as portfolio construction",
      })),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.route).toBe("workflow");
    expect(result.workflow).toBe("compare_assets");
    expect(result.entities.symbols).toEqual(["VYM", "SCHD", "VOO", "QQQ"]);
    expect(result.missing_required).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "portfolio_tradeoff_corrected_to_compare_assets",
    }));
  });

  it("removes live tool bundles for no-symbol conceptual education", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Explain how to use valuation ratios without over relying on them.",
      },
      fixedClient(JSON.stringify({
        routeKind: "agent_task",
        workflow: "general_finance_qa",
        entities: { symbols: [] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        tool_bundles: ["core_market", "macro"],
        diagnostics: [],
        reasoning: "conceptual education prompt",
      })),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.tool_bundles).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "conceptual_education_no_tools",
    }));
  });

  it("keeps macro tools for forward-looking rate impact questions", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "How should falling rates affect growth stocks over the next year?",
      },
      fixedClient(JSON.stringify({
        routeKind: "agent_task",
        workflow: "general_finance_qa",
        entities: { symbols: [] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        tool_bundles: ["macro"],
        diagnostics: [],
        reasoning: "macro rate context",
      })),
    );

    expect(result.tool_bundles).toContain("macro");
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
      code: "conceptual_education_no_tools",
    }));
  });

  it("routes missing options symbol to clarification with ask_user bundle", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "build me an options setup" },
      fixedClient(JSON.stringify({
        routeKind: "workflow_dispatch",
        workflow: "options_screener",
        entities: { symbols: [] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "options request",
      })),
    );

    expect(result.routeKind).toBe("clarification");
    expect(result.route).toBe("fallback");
    expect(result.missing_required).toEqual(["symbol"]);
    expect(result.tool_bundles).toEqual(["clarification"]);
  });

  it("routes missing portfolio budget to clarification", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "build me a diversified portfolio" },
      fixedClient(JSON.stringify({
        routeKind: "workflow_dispatch",
        workflow: "portfolio_builder",
        entities: { symbols: [] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "portfolio request",
      })),
    );

    expect(result.routeKind).toBe("clarification");
    expect(result.missing_required).toEqual(["budget"]);
  });

  it("does not clarify when resolved slots supply the required budget", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "build me a portfolio like last time" },
      fixedClient(JSON.stringify({
        routeKind: "workflow_dispatch",
        workflow: "portfolio_builder",
        entities: { symbols: [] },
        slots: {
          budget: { value: 10_000, source: "preference", confidence: "high" },
        },
        preference_updates: [],
        missing_required: [],
        reasoning: "profile supplies budget",
      })),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.missing_required).toEqual([]);
    expect(result.slots.budget?.source).toBe("preference");
  });

  it("enriches omitted portfolio constraints from deterministic extraction", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "Build a conservative ETF portfolio with $25k for 5 years" },
      fixedClient(JSON.stringify({
        routeKind: "workflow_dispatch",
        workflow: "portfolio_builder",
        entities: { symbols: [] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "portfolio request but omitted constraints",
      })),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.workflow).toBe("portfolio_builder");
    expect(result.entities.budget).toBe(25_000);
    expect(result.entities.riskProfile).toBe("conservative");
    expect(result.entities.assetScope).toBe("etf_focused");
    expect(result.entities.timeHorizon).toBe("5_years");
  });

  it("does not clarify when prior context supplies the required symbol", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "what about a call spread?",
        priorTurns: [{ role: "user", text: "Let's look at NVDA" }],
      },
      fixedClient(JSON.stringify({
        routeKind: "workflow_dispatch",
        workflow: "options_screener",
        entities: { symbols: ["NVDA"] },
        slots: {
          symbol: { value: "NVDA", source: "prior_context", confidence: "high" },
        },
        preference_updates: [],
        missing_required: [],
        reasoning: "prior context supplies symbol",
      })),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.missing_required).toEqual([]);
    expect(result.slots.symbol?.source).toBe("prior_context");
  });

  it("enriches omitted option premium caps from deterministic extraction", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "MSFT puts under $500 premium" },
      fixedClient(JSON.stringify({
        routeKind: "workflow_dispatch",
        workflow: "options_screener",
        entities: { symbols: ["MSFT"] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "options request but omitted cap",
      })),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.workflow).toBe("options_screener");
    expect(result.entities.symbols).toEqual(["MSFT"]);
    expect(result.entities.direction).toBe("bearish");
    expect(result.entities.maxPremium).toBe(500);
    expect(result.entities.budget).toBeUndefined();
  });

  it("uses the owned underlying instead of a catalyst ticker for covered-call workflows", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "NVDA earnings are today. If I have DRAM, what is the best covered call to sell right now? Cost basis is $51.",
      },
      fixedClient(JSON.stringify({
        routeKind: "workflow_dispatch",
        workflow: "options_screener",
        entities: { symbols: ["NVDA"] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "misread catalyst as underlying",
      })),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.workflow).toBe("options_screener");
    expect(result.entities.symbols).toEqual(["DRAM", "NVDA"]);
    expect(result.entities.heldSymbol).toBe("DRAM");
    expect(result.entities.catalystSymbols).toEqual(["NVDA"]);
    expect(result.entities.costBasis).toBe(51);
    expect(result.entities.dteHint).toBe("event_week");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "covered_call_underlying_corrected",
    }));
  });

  it("keeps covered-call education and suitability prompts out of options workflow dispatch", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "I own 200 shares of Microsoft (MSFT) and it's been flat. How does selling covered calls work, and is it a good idea?",
      },
      fixedClient(JSON.stringify({
        routeKind: "workflow_dispatch",
        workflow: "options_screener",
        entities: { symbols: ["MSFT"] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "misread education as a contract screen",
      })),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.tool_bundles).toEqual(expect.arrayContaining(["core_market", "options"]));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "options_workflow_corrected_to_policy_task",
    }));
  });

  it("enriches omitted protective-put hedge context from deterministic extraction", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "I own 200 shares of NVDA after a big rally. What's a reasonable protective put 30-45 days out that doesn't cost too much?",
      },
      fixedClient(JSON.stringify({
        routeKind: "workflow_dispatch",
        workflow: "options_screener",
        entities: { symbols: ["NVDA"] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "options request",
      })),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.workflow).toBe("options_screener");
    expect(result.entities.symbols).toEqual(["NVDA"]);
    expect(result.entities.direction).toBe("bearish");
    expect(result.entities.optionStrategy).toBe("protective_put");
    expect(result.entities.shareQuantity).toBe(200);
    expect(result.entities.heldSymbol).toBe("NVDA");
    expect(result.entities.dteHint).toBe("30-45 days");
  });

  it("uses the owned underlying instead of a catalyst ticker for protective-put workflows", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "NVDA earnings are today. I own 200 shares of AMD. What protective put should I buy for the next month?",
      },
      fixedClient(JSON.stringify({
        routeKind: "workflow_dispatch",
        workflow: "options_screener",
        entities: { symbols: ["NVDA"] },
        slots: {},
        preference_updates: [],
        missing_required: [],
        reasoning: "misread catalyst as underlying",
      })),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.workflow).toBe("options_screener");
    expect(result.entities.symbols).toEqual(["AMD", "NVDA"]);
    expect(result.entities.heldSymbol).toBe("AMD");
    expect(result.entities.catalystSymbols).toEqual(["NVDA"]);
    expect(result.entities.optionStrategy).toBe("protective_put");
    expect(result.entities.direction).toBe("bearish");
    expect(result.entities.shareQuantity).toBe(200);
    expect(result.entities.dteHint).toBe("month");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "existing_position_underlying_corrected",
    }));
  });
});

describe("buildRouterPrompt", () => {
  it("does NOT contain a tool catalog (zero-tool router)", () => {
    const prompt = buildRouterPrompt(BASE_INPUT);
    expect(prompt).not.toMatch(/tool catalog/i);
    expect(prompt).toMatch(/You have NO tools\./);
  });

  it("includes workflow catalog entries", () => {
    const prompt = buildRouterPrompt(BASE_INPUT);
    expect(prompt).toContain("portfolio_builder");
    expect(prompt).toContain("options_screener");
    expect(prompt).toContain("compare_assets");
    expect(prompt).toContain("agent_task");
    expect(prompt).toContain("workflow_dispatch");
  });

  it("asks the router to preserve compare metrics such as macro hedge intent", () => {
    const prompt = buildRouterPrompt(BASE_INPUT);
    expect(prompt).toContain("compareMetrics");
    expect(prompt).toContain("macro_hedge");
  });

  it("tells the router to distinguish covered-call underlyings from catalyst tickers", () => {
    const prompt = buildRouterPrompt(BASE_INPUT);
    expect(prompt).toContain("heldSymbol");
    expect(prompt).toContain("catalystSymbols");
    expect(prompt).toContain("costBasis");
    expect(prompt).toContain("covered call");
    expect(prompt).not.toContain("NVDA earnings are today");
    expect(prompt).not.toContain('symbols=["DRAM","NVDA"]');
  });

  it("describes broad sector and macro research as general finance QA", () => {
    const prompt = buildRouterPrompt(BASE_INPUT);
    expect(prompt).toContain("market structure");
    expect(prompt).toContain("sector");
    expect(prompt).toContain("monetary policy");
    expect(prompt).toContain("emerging markets");
  });

  it("renders profile snapshot and prior turns inline", () => {
    const prompt = buildRouterPrompt({
      ...BASE_INPUT,
      profileSnapshot: { risk_profile: "aggressive" },
      priorTurns: [{ role: "user", text: "hello" }],
    });
    expect(prompt).toContain("risk_profile");
    expect(prompt).toContain("aggressive");
    expect(prompt).toContain("[user] hello");
  });
});

describe("Fallback playbook rendering — missing_required assertion (task 9.2)", () => {
  it("renders a fallback playbook with an ask_user directive when missing_required is non-empty", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      fallbackContext: {
        assumptionsBlock: "Assumptions (reproduce exactly): (none)",
        missingRequired: ["symbol"],
      },
    });
    const prompt = builder.build();
    expect(prompt).toContain("Missing Required Information");
    expect(prompt).toContain("symbol");
    expect(prompt).toContain("ask_user");
  });

  it("omits the missing-info section when missing_required is empty", () => {
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      fallbackContext: {
        assumptionsBlock: "Assumptions: (none)",
        missingRequired: [],
      },
    });
    const prompt = builder.build();
    expect(prompt).not.toContain("Missing Required Information");
  });
});

describe("Router LLM client isolation", () => {
  it("does not import any AgentTool registration code paths", async () => {
    // We can't statically prove absence, but importing router should not
    // pull in tool-adapter or the pi extension module.
    const mod = await import("../../../src/routing/router.js");
    expect(typeof mod.route).toBe("function");
  });
});

describe("route capability manifest", () => {
  it("declares all canonical route kinds and legacy mappings", () => {
    expect(Object.keys(ROUTE_CAPABILITY_MANIFEST).sort()).toEqual([
      "agent_task",
      "clarification",
      "pass_through",
      "workflow_dispatch",
    ]);
    expect(ROUTE_CAPABILITY_MANIFEST.workflow_dispatch.legacyRoute).toBe("workflow");
    expect(ROUTE_CAPABILITY_MANIFEST.agent_task.legacyRoute).toBe("fallback");
  });

  it("resolves active tools from selected bundles", () => {
    const tools = activeToolsForBundles(["core_market", "clarification"], [
      "get_stock_quote",
      "screen_stocks",
      "ask_user",
      "get_option_chain",
    ]);

    expect(tools).toEqual(["get_stock_quote", "screen_stocks", "ask_user"]);
    expect(TOOL_BUNDLE_TOOLS.options).toContain("get_option_chain");
  });

  it("exposes stock screening only through the core market bundle", () => {
    expect(TOOL_BUNDLE_TOOLS.core_market).toContain("screen_stocks");
    expect(activeToolsForBundles(["macro"])).not.toContain("screen_stocks");
    expect(activeToolsForBundles(["sentiment"])).not.toContain("screen_stocks");
    expect(activeToolsForBundles(["sec"])).not.toContain("screen_stocks");
  });

  it("keeps macro tools for interest-rate comparisons", async () => {
    const output = await route(BASE_INPUT, fixedClient(JSON.stringify({
      routeKind: "workflow_dispatch",
      workflow: "compare_assets",
      entities: { symbols: ["SPY", "QQQ"], compareMetrics: ["interest_rates"] },
      slots: {},
      preference_updates: [],
      missing_required: [],
      diagnostics: [],
      reasoning: "rate-sensitive comparison",
    })));
    const context = buildResolvedTurnContext(BASE_INPUT, output, {
      availableToolNames: ["get_stock_quote", "get_economic_data"],
    });

    expect(context.toolBundles).toContain("macro");
    expect(context.activeToolNames).toContain("get_economic_data");
  });
});

describe("ResolvedTurnContext", () => {
  it("records route, tool, memory, and diagnostic provenance", async () => {
    const output = await route(BASE_INPUT, fixedClient(JSON.stringify({
      routeKind: "agent_task",
      entities: { symbols: ["AAPL"] },
      slots: {
        symbol: { value: "AAPL", source: "user", confidence: "high" },
      },
      preference_updates: [],
      missing_required: [],
      diagnostics: [{ code: "example", message: "corrected" }],
      reasoning: "x",
    })));
    const context = buildResolvedTurnContext(BASE_INPUT, output, {
      availableToolNames: ["get_stock_quote", "search_ticker", "ask_user"],
    });

    expect(context.routeKind).toBe("agent_task");
    expect(context.legacyRoute).toBe("fallback");
    expect(context.toolBundles).toContain("core_market");
    expect(context.activeToolNames).toContain("get_stock_quote");
    expect(context.memoryQueryPlan.categories).toContain("investor_profile");
    expect(context.diagnostics[0]?.code).toBe("example");
    expect(context.planning.version).toBe("planning-v1");
    expect(context.planning.taskFamily).toBe("single_asset_decision");
  });

  it("applies planning migration status overrides to the resolved context", async () => {
    const output = await route(BASE_INPUT, fixedClient(JSON.stringify({
      routeKind: "agent_task",
      entities: { symbols: ["AAPL"] },
      slots: {
        symbol: { value: "AAPL", source: "user", confidence: "high" },
      },
      preference_updates: [],
      missing_required: [],
      diagnostics: [],
      reasoning: "single asset decision",
    })));
    const context = buildResolvedTurnContext(BASE_INPUT, output, {
      availableToolNames: ["get_stock_quote", "search_ticker"],
      planning: {
        migrationStatuses: {
          single_asset_decision: "dual_run",
        },
      },
    });

    expect(context.planning.taskFamily).toBe("single_asset_decision");
    expect(context.planning.behaviorMode).toBe("dual_run");
  });
});
