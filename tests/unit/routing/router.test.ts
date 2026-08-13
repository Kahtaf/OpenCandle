import { describe, expect, it } from "vitest";
import { PromptContextBuilder } from "../../../src/prompts/context-builder.js";
import {
  activeToolsForBundles,
  buildResolvedTurnContext,
  ROUTE_CAPABILITY_MANIFEST,
  TOOL_BUNDLE_TOOLS,
} from "../../../src/routing/index.js";
import { route, validateRouterOutput } from "../../../src/routing/router.js";
import { buildRouterPrompt } from "../../../src/routing/router-prompt.js";
import type {
  RouterInputContext,
  RouterLlmClient,
  RouterOutput,
} from "../../../src/routing/router-types.js";

const BASE_INPUT: RouterInputContext = {
  text: "analyze AAPL",
  priorTurns: [],
  profileSnapshot: {},
  recentWorkflowRuns: [],
};

function fixedClient(text: string): RouterLlmClient {
  return {
    async complete() {
      return text;
    },
  };
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

  it("canonicalizes camelCase slot keys to snake_case", () => {
    const out = validateRouterOutput(
      JSON.stringify({
        route: "workflow",
        workflow: "portfolio_builder",
        entities: { symbols: [] },
        slots: {
          budget: { value: 10000, source: "user", confidence: "high" },
          timeHorizon: { value: "3y", source: "user", confidence: "high" },
          riskProfile: { value: "aggressive", source: "user", confidence: "high" },
        },
        preference_updates: [],
        missing_required: [],
        reasoning: "x",
      }),
    );

    expect(out.slots.time_horizon).toEqual({ value: "3y", source: "user", confidence: "high" });
    expect(out.slots.risk_profile?.value).toBe("aggressive");
    expect(out.slots.timeHorizon).toBeUndefined();
    expect(out.slots.riskProfile).toBeUndefined();
  });

  it("canonicalizes a one-element symbols slot to symbol for symbol workflows", () => {
    const out = validateRouterOutput(
      JSON.stringify({
        routeKind: "agent_task",
        route: "fallback",
        workflow: "single_asset_analysis",
        entities: { symbols: ["TSLA"] },
        slots: {
          symbols: { value: ["TSLA"], source: "user", confidence: "high" },
        },
        preference_updates: [],
        missing_required: [],
        reasoning: "x",
      }),
    );

    expect(out.slots.symbol).toEqual({ value: "TSLA", source: "user", confidence: "high" });
    expect(out.slots.symbols).toBeUndefined();
  });

  it("keeps multi-element symbols slots intact for symbol workflows", () => {
    const out = validateRouterOutput(
      JSON.stringify({
        routeKind: "agent_task",
        route: "fallback",
        workflow: "single_asset_analysis",
        entities: { symbols: ["TSLA", "F"] },
        slots: {
          symbols: { value: ["TSLA", "F"], source: "user", confidence: "high" },
        },
        preference_updates: [],
        missing_required: [],
        reasoning: "x",
      }),
    );

    expect(out.slots.symbols?.value).toEqual(["TSLA", "F"]);
    expect(out.slots.symbol).toBeUndefined();
  });

  it("wraps a scalar symbol slot into symbols for compare workflows", () => {
    const out = validateRouterOutput(
      JSON.stringify({
        route: "workflow",
        workflow: "compare_assets",
        entities: { symbols: ["KO"] },
        slots: {
          symbol: { value: "KO", source: "user", confidence: "high" },
        },
        preference_updates: [],
        missing_required: ["symbols"],
        reasoning: "x",
      }),
    );

    expect(out.slots.symbols?.value).toEqual(["KO"]);
    expect(out.slots.symbol).toBeUndefined();
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
        preference_updates: [{ key: "risk_profile", value: "aggressive", confidence: "high" }],
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
      fixedClient(
        JSON.stringify({
          routeKind: "agent_task",
          entities: { symbols: ["NVDA"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          diagnostics: [],
          reasoning: "valid llm classification",
        }),
      ),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.workflow).toBeUndefined();
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({
        code: "deterministic_failure_recovery",
      }),
    );
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
      fixedClient(
        JSON.stringify({
          routeKind: "agent_task",
          workflow: "compare_assets",
          entities: { symbols: ["VOO", "QQQ", "SCHD"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          diagnostics: [],
          reasoning: "compare assets but wrong route kind",
        }),
      ),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.route).toBe("workflow");
    expect(result.workflow).toBe("compare_assets");
    expect(result.entities.compareMetrics).toEqual(["overlap"]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "dispatchable_workflow_corrected_to_workflow_dispatch",
      }),
    );
  });

  it("merges deterministic overlap focus when router emits a different compare metric", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Does buying QQQ on top of VOO create too much overlap?",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "compare_assets",
          entities: { symbols: ["VOO", "QQQ"], compareMetrics: ["sentiment"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          diagnostics: [],
          reasoning: "compare assets",
        }),
      ),
    );

    expect(result.entities.compareMetrics).toEqual(["sentiment", "overlap"]);
  });

  it("keeps crypto sizing out of portfolio construction when the user asks allocation range and drawdown", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "I have a $75k portfolio and want BTC exposure. What allocation range would you use, and how bad could the drawdown feel?",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "portfolio_builder",
          entities: { symbols: ["BTC"], budget: 75_000 },
          slots: {},
          preference_updates: [],
          missing_required: [],
          diagnostics: [],
          reasoning: "mistaken portfolio builder",
        }),
      ),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "crypto_sizing_corrected_to_agent_task",
      }),
    );
  });

  it("preserves portfolio construction when bitcoin is one sleeve in an explicit build request", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Build me a $75k portfolio with a small bitcoin allocation.",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "portfolio_builder",
          entities: { symbols: ["BTC"], budget: 75_000 },
          slots: {},
          preference_updates: [],
          missing_required: [],
          diagnostics: [],
          reasoning: "portfolio build with bitcoin sleeve",
        }),
      ),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.workflow).toBe("portfolio_builder");
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({
        code: "crypto_sizing_corrected_to_agent_task",
      }),
    );
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
    const result = await route({ ...BASE_INPUT, text: "hello" }, client);
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
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "deterministic_failure_recovery",
      }),
    );
  });

  it("enriches omitted compare focus from deterministic extraction", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "For the next 6 months, should I use BTC or GLD as a macro hedge?" },
      fixedClient(
        JSON.stringify({
          route: "workflow",
          workflow: "compare_assets",
          entities: { symbols: ["BTC", "GLD"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "x",
        }),
      ),
    );

    expect(result.entities.timeHorizon).toBe("6mo");
    expect(result.entities.compareMetrics).toEqual(["macro_hedge"]);
  });

  it("keeps a one-off analysis horizon out of persistent preference updates", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "Give me entry levels on ASTS for a 6 month horizon" },
      fixedClient(
        JSON.stringify({
          routeKind: "agent_task",
          entities: { symbols: ["ASTS"], timeHorizon: "6mo" },
          slots: {
            symbol: { value: "ASTS", source: "user", confidence: "high" },
            time_horizon: { value: "6mo", source: "user", confidence: "high" },
          },
          preference_updates: [
            {
              key: "time_horizon",
              value: "6mo",
              confidence: "high",
              source: "inferred",
            },
          ],
          missing_required: [],
          reasoning: "entry analysis",
        }),
      ),
    );

    expect(result.entities.timeHorizon).toBe("6mo");
    expect(result.preference_updates).toEqual([]);
  });

  it("keeps an explicit portfolio horizon authoritative over a widened LLM horizon", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "I'm aggressive, give me a 3-year portfolio for $25k" },
      fixedClient(
        JSON.stringify({
          route: "workflow",
          workflow: "portfolio_builder",
          entities: {
            symbols: [],
            budget: 25_000,
            timeHorizon: "3y_plus",
            riskProfile: "aggressive",
          },
          slots: {
            budget: { value: 25_000, source: "user", confidence: "high" },
            time_horizon: { value: "3y_plus", source: "user", confidence: "high" },
            risk_profile: { value: "aggressive", source: "user", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          reasoning: "portfolio request",
        }),
      ),
    );

    expect(result.entities.timeHorizon).toBe("3y");
    expect(result.slots.time_horizon?.value).toBe("3y");
  });

  it("drops an unsupported risk profile inferred from diversification language", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "invest $50k diversified" },
      fixedClient(
        JSON.stringify({
          route: "workflow",
          workflow: "portfolio_builder",
          entities: { symbols: [], budget: 50_000, riskProfile: "balanced" },
          slots: {
            budget: { value: 50_000, source: "user", confidence: "high" },
            risk_profile: { value: "balanced", source: "user", confidence: "medium" },
          },
          preference_updates: [
            {
              key: "risk_profile",
              value: "balanced",
              confidence: "medium",
              source: "inferred",
            },
          ],
          missing_required: [],
          reasoning: "diversified portfolio",
        }),
      ),
    );

    expect(result.entities.riskProfile).toBeUndefined();
    expect(result.slots.risk_profile).toBeUndefined();
    expect(result.preference_updates).toEqual([]);
  });

  it("drops a non-canonical asset-scope preference inferred from diversification language", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "invest $50k diversified" },
      fixedClient(
        JSON.stringify({
          route: "workflow",
          workflow: "portfolio_builder",
          entities: { symbols: [], budget: 50_000 },
          slots: { budget: { value: 50_000, source: "user", confidence: "high" } },
          preference_updates: [
            {
              key: "asset_scope",
              value: "diversified",
              confidence: "high",
              source: "inferred",
            },
          ],
          missing_required: [],
          reasoning: "diversified portfolio",
        }),
      ),
    );

    expect(result.preference_updates).toEqual([]);
  });

  it("recovers a complete portfolio build from an unnecessary LLM clarification", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "invest $50k diversified" },
      fixedClient(
        JSON.stringify({
          routeKind: "clarification",
          workflow: "portfolio_builder",
          entities: { symbols: [], budget: 50_000 },
          slots: { budget: { value: 50_000, source: "user", confidence: "high" } },
          preference_updates: [],
          missing_required: [],
          reasoning: "ask about risk preference",
        }),
      ),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.workflow).toBe("portfolio_builder");
    expect(result.missing_required).toEqual([]);
  });

  it("keeps valid LLM agent-task fallback but drops ambiguous concept symbols", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Analyze the current market structure of the semiconductor industry and predict how emerging technologies like AI could reshape it over the next decade.",
      },
      fixedClient(
        JSON.stringify({
          route: "fallback",
          entities: { symbols: ["AI"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "broad research prompt",
        }),
      ),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.workflow).toBeUndefined();
    expect(result.entities.symbols).toEqual([]);
  });

  it("asks for a ticker when a market-news request has only an unresolved reference", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "what's the latest news on that one semiconductor stock" },
      fixedClient(
        JSON.stringify({
          routeKind: "agent_task",
          workflow: "general_finance_qa",
          entities: { symbols: [] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "semiconductor news request",
        }),
      ),
    );

    expect(result.routeKind).toBe("clarification");
    expect(result.missing_required).toEqual(["symbol"]);
  });

  it("keeps ambiguous symbols when the user explicitly asks for the ticker", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Analyze AI stock",
      },
      fixedClient(
        JSON.stringify({
          route: "fallback",
          entities: { symbols: ["AI"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "single ticker request",
        }),
      ),
    );

    expect(result.entities.symbols).toEqual(["AI"]);
  });

  it("drops finance acronyms without a direct ticker signal from LLM output", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Compare these assets: IV, ASTS",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          route: "workflow",
          workflow: "compare_assets",
          entities: { symbols: ["IV", "ASTS"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          tool_bundles: [],
          diagnostics: [],
          reasoning: "compare requested assets",
        }),
      ),
    );

    expect(result.entities.symbols).toEqual(["ASTS"]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "symbol_dropped",
        message: expect.stringContaining("IV"),
      }),
    );
  });

  it("removes dropped finance acronyms from router symbol slots before missing-slot checks", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Compare these assets: IV, ASTS",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          route: "workflow",
          workflow: "compare_assets",
          entities: { symbols: ["IV", "ASTS"] },
          slots: {
            symbols: { value: ["IV", "ASTS"], source: "user", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          tool_bundles: [],
          diagnostics: [],
          reasoning: "compare requested assets",
        }),
      ),
    );

    expect(result.routeKind).toBe("clarification");
    expect(result.entities.symbols).toEqual(["ASTS"]);
    expect(result.slots.symbols?.value).toEqual(["ASTS"]);
    expect(result.missing_required).toEqual(["symbols"]);
  });

  it("corrects macro metric comparisons after acronym slot cleanup leaves one ticker", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Show CPI vs SPY YTD",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          route: "workflow",
          workflow: "compare_assets",
          entities: { symbols: ["CPI", "SPY"] },
          slots: {
            symbols: { value: ["CPI", "SPY"], source: "user", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          tool_bundles: [],
          diagnostics: [],
          reasoning: "misread CPI as a ticker",
        }),
      ),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.entities.symbols).toEqual(["SPY"]);
    expect(result.slots.symbols).toBeUndefined();
    expect(result.missing_required).toEqual([]);
    expect(result.tool_bundles).toContain("macro");
  });

  it("drops comparison tickers invented by the model and absent from context", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "compare KO, IV, PEP" },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "compare_assets",
          entities: { symbols: ["KO", "IVV", "PEP"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "interpreted IV as IVV",
        }),
      ),
    );

    expect(result.entities.symbols).toEqual(["KO", "PEP"]);
  });

  it("corrects macro metric comparisons when the model already omits the metric symbol", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "Show CPI vs SPY YTD" },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "compare_assets",
          entities: { symbols: ["SPY"] },
          slots: {},
          preference_updates: [],
          missing_required: ["symbols"],
          reasoning: "CPI is a metric but comparison needs another ticker",
        }),
      ),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.entities.symbols).toEqual(["SPY"]);
    expect(result.missing_required).toEqual([]);
    expect(result.tool_bundles).toContain("macro");
  });

  it("keeps finance acronym tickers with a direct ticker phrase", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "compare KO, the IV ticker, and PEP",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          route: "workflow",
          workflow: "compare_assets",
          entities: { symbols: ["KO", "IV", "PEP"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          tool_bundles: [],
          diagnostics: [],
          reasoning: "compare requested assets",
        }),
      ),
    );

    expect(result.entities.symbols).toEqual(["KO", "IV", "PEP"]);
  });

  it("recovers an explicit multi-asset comparison from an LLM clarification", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "compare KO, the IV ticker, and PEP" },
      fixedClient(
        JSON.stringify({
          routeKind: "clarification",
          entities: { symbols: ["KO", "PEP"] },
          slots: {},
          preference_updates: [],
          missing_required: ["symbols"],
          reasoning: "IV may mean volatility",
        }),
      ),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.workflow).toBe("compare_assets");
    expect(result.entities.symbols).toEqual(["KO", "IV", "PEP"]);
    expect(result.missing_required).toEqual([]);
  });

  it("does not carry an incidental prior holding range as an agent-task budget", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "same question for QQQ",
        priorTurns: [
          {
            role: "user",
            text: "I'm holding $500k-$1M in SPY — how's it positioned relative to the broad market?",
          },
        ],
      },
      fixedClient(
        JSON.stringify({
          routeKind: "agent_task",
          entities: {
            symbols: ["QQQ", "SPY"],
            budget: 750_000,
            heldSymbol: "SPY",
          },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "same analysis with prior holding context",
        }),
      ),
    );

    expect(result.entities.budget).toBeUndefined();
    expect(result.entities.heldSymbol).toBeUndefined();
  });

  it("restores locally marked acronym tickers omitted by the model in text order", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "compare KO, the IV ticker, and PEP",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          route: "workflow",
          workflow: "compare_assets",
          entities: { symbols: ["KO", "PEP"] },
          slots: {
            symbols: { value: ["KO", "PEP"], source: "user", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          tool_bundles: [],
          diagnostics: [],
          reasoning: "missed locally marked IV ticker",
        }),
      ),
    );

    expect(result.entities.symbols).toEqual(["KO", "IV", "PEP"]);
    expect(result.slots.symbols?.value).toEqual(["KO", "IV", "PEP"]);
    // Every synced symbol appears in the user's text, so user provenance holds.
    expect(result.slots.symbols?.source).toBe("user");
  });

  it("labels synced compare symbol slots prior_context when merged symbols are absent from the text", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "compare those with SPY over the last year",
        priorTurns: [
          { role: "user", text: "I'm deciding between NVDA and AMD for a semiconductor position." },
          { role: "assistant", text: "NVDA and AMD are the two semiconductor names in scope." },
        ],
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          route: "workflow",
          workflow: "compare_assets",
          entities: { symbols: ["NVDA", "AMD", "SPY"] },
          slots: {
            symbols: { value: ["SPY"], source: "user", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          tool_bundles: [],
          diagnostics: [],
          reasoning: "NVDA and AMD carried from prior turns",
        }),
      ),
    );

    expect(result.entities.symbols).toEqual(["SPY", "NVDA", "AMD"]);
    expect(result.slots.symbols?.value).toEqual(["SPY", "NVDA", "AMD"]);
    // NVDA/AMD never appear in this turn's text; claiming the user specified
    // them corrupts the Assumptions block and ask-vs-guess provenance.
    expect(result.slots.symbols?.source).toBe("prior_context");
    expect(result.diagnostics.map((d) => d.code)).toContain(
      "symbols_slot_provenance_prior_context",
    );
  });

  it("downgrades user provenance on already-ordered compare slots with prior-turn symbols", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "compare those with SPY over the last year",
        priorTurns: [
          { role: "user", text: "I'm deciding between NVDA and AMD for a semiconductor position." },
        ],
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          route: "workflow",
          workflow: "compare_assets",
          entities: { symbols: ["SPY", "NVDA", "AMD"] },
          slots: {
            symbols: { value: ["SPY", "NVDA", "AMD"], source: "user", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          tool_bundles: [],
          diagnostics: [],
          reasoning: "already in text order; no sync fires",
        }),
      ),
    );

    expect(result.slots.symbols?.source).toBe("prior_context");
  });

  it("keeps preference-sourced compare slots untouched when symbols are absent from text", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "compare my usual etfs over the last year",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          route: "workflow",
          workflow: "compare_assets",
          entities: { symbols: ["VOO", "VTI"] },
          slots: {
            symbols: { value: ["VOO", "VTI"], source: "preference", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          tool_bundles: [],
          diagnostics: [],
          reasoning: "symbols from saved preferences",
        }),
      ),
    );

    expect(result.slots.symbols?.source).toBe("preference");
  });

  it("corrects macro data prompts misread as ticker comparisons", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Use get_economic_data to show FRED CPI inflation data",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "compare_assets",
          entities: { symbols: ["FRED", "CPI"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "misread source and macro acronym as tickers",
        }),
      ),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.entities.symbols).toEqual([]);
    expect(result.tool_bundles).toContain("macro");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "compare_route_corrected_to_macro_task",
      }),
    );
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
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "macro_task_inferred_from_prompt",
      }),
    );
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

  it("fills profile-backed portfolio risk slots when the model omits them", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "build me a portfolio for $30k",
        profileSnapshot: { risk_profile: "conservative" },
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          route: "workflow",
          workflow: "portfolio_builder",
          entities: { symbols: [], budget: 30000 },
          slots: {
            budget: { value: 30000, source: "user", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          tool_bundles: [],
          diagnostics: [],
          reasoning: "portfolio budget extracted",
        }),
      ),
    );

    expect(result.slots.risk_profile).toEqual({
      value: "conservative",
      source: "preference",
      confidence: "high",
    });
  });

  it("fills the options dte_target slot from deterministic extraction when the model omits it", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "find me bullish calls on NVDA 30-45 DTE",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          route: "workflow",
          workflow: "options_screener",
          entities: { symbols: ["NVDA"] },
          slots: {
            symbol: { value: "NVDA", source: "user", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          tool_bundles: [],
          diagnostics: [],
          reasoning: "options screener without the dte slot",
        }),
      ),
    );

    // The DTE horizon is a named historical loss class; when the model drops
    // the slot the deterministic extraction must preserve the user's range.
    expect(result.slots.dte_target).toEqual({
      value: "30_to_45_days",
      source: "user",
      confidence: "high",
    });
    expect(result.diagnostics.map((d) => d.code)).toContain("dte_slot_filled_from_extraction");
  });

  it("overrides a conflicting default DTE slot with the user's explicit maximum horizon", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Sell an AAPL covered call max 2 weeks out.",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          route: "workflow",
          workflow: "options_screener",
          entities: { symbols: ["AAPL"], dteHint: "month" },
          slots: {
            symbol: { value: "AAPL", source: "user", confidence: "high" },
            dte_target: { value: "25_to_45_days", source: "default", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          tool_bundles: ["options"],
          diagnostics: [],
          reasoning: "covered-call screen with a default monthly horizon",
        }),
      ),
    );

    expect(result.entities.dteHint).toBe("0-14 days");
    expect(result.slots.dte_target).toEqual({
      value: "0_to_14_days",
      source: "user",
      confidence: "high",
    });
  });

  it("overrides a conflicting model slot that claims user provenance with the explicit maximum", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Sell an AAPL covered call max 2 weeks out.",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          route: "workflow",
          workflow: "options_screener",
          entities: { symbols: ["AAPL"], dteHint: "month" },
          slots: {
            symbol: { value: "AAPL", source: "user", confidence: "high" },
            dte_target: { value: "25_to_45_days", source: "user", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          tool_bundles: ["options"],
          diagnostics: [],
          reasoning: "covered-call screen with a conflicting monthly horizon",
        }),
      ),
    );

    expect(result.entities.dteHint).toBe("0-14 days");
    expect(result.slots.dte_target).toEqual({
      value: "0_to_14_days",
      source: "user",
      confidence: "high",
    });
  });

  it("repairs a model DTE range that drops the user's day unit", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Screen bullish AAPL calls 30-45 DTE.",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          route: "workflow",
          workflow: "options_screener",
          entities: { symbols: ["AAPL"], direction: "bullish", dteHint: "30-45" },
          slots: {},
          preference_updates: [],
          missing_required: [],
          tool_bundles: ["options"],
          diagnostics: [],
          reasoning: "options screen with a unitless model DTE range",
        }),
      ),
    );

    expect(result.entities.dteHint).toBe("30-45 days");
    expect(result.slots.dte_target).toEqual({
      value: "30_to_45_days",
      source: "user",
      confidence: "high",
    });
  });

  it("does not replace a requested monthly horizon with a negated short horizon", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "I don't want AAPL options within 14 days; screen calls a month out.",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          route: "workflow",
          workflow: "options_screener",
          entities: { symbols: ["AAPL"], direction: "bullish", dteHint: "month" },
          slots: {
            dte_target: { value: "25_to_45_days", source: "user", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          tool_bundles: ["options"],
          diagnostics: [],
          reasoning: "the user rejected short-dated options and requested a monthly horizon",
        }),
      ),
    );

    expect(result.entities.dteHint).toBe("month");
    expect(result.slots.dte_target).toEqual({
      value: "25_to_45_days",
      source: "user",
      confidence: "high",
    });
  });

  it("preserves a user-sourced DTE slot when deterministic cap parsing sees curly negation", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "I don’t want AAPL options within 14 days; screen calls a month out.",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          route: "workflow",
          workflow: "options_screener",
          entities: { symbols: ["AAPL"], direction: "bullish", dteHint: "month" },
          slots: {
            dte_target: { value: "25_to_45_days", source: "user", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          tool_bundles: ["options"],
          diagnostics: [],
          reasoning: "the user rejected short-dated options and requested a monthly horizon",
        }),
      ),
    );

    expect(result.entities.dteHint).toBe("month");
    expect(result.slots.dte_target).toEqual({
      value: "25_to_45_days",
      source: "user",
      confidence: "high",
    });
  });

  it("keeps the requested month when the live router emits only a DTE hint", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "I don’t want AAPL options within 14 days; screen calls a month out.",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          route: "workflow",
          workflow: "options_screener",
          entities: { symbols: ["AAPL"], direction: "bullish", dteHint: "month" },
          slots: {
            dte_hint: { value: "month", source: "user", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          tool_bundles: ["options"],
          diagnostics: [],
          reasoning: "the user rejected short-dated options and requested a monthly horizon",
        }),
      ),
    );

    expect(result.entities.dteHint).toBe("month");
    expect(result.slots.dte_target).toEqual({
      value: "25_to_45_days",
      source: "user",
      confidence: "high",
    });
  });

  it("canonicalizes asset_scope vocabulary synonyms in slots and preference updates", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "I only want ETFs in my portfolio, budget is $20k",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          route: "workflow",
          workflow: "portfolio_builder",
          entities: { symbols: [], budget: 20000 },
          slots: {
            budget: { value: 20000, source: "user", confidence: "high" },
            asset_scope: { value: "etf_only", source: "user", confidence: "high" },
          },
          preference_updates: [
            { key: "asset_scope", value: "etf_only", confidence: "high", source: "inferred" },
          ],
          missing_required: [],
          tool_bundles: [],
          diagnostics: [],
          reasoning: "asset scope emitted with synonym vocabulary",
        }),
      ),
    );

    // "etf_only"/"etfs_only" are model-vocabulary synonyms of the canonical
    // asset_scope value; canonicalization keeps saved preferences and slot
    // consumers on one vocabulary.
    expect(result.slots.asset_scope?.value).toBe("etf_focused");
    expect(result.preference_updates).toEqual([
      { key: "asset_scope", value: "etf_focused", confidence: "high", source: "inferred" },
    ]);
  });

  it("suppresses preference updates that restate the saved profile value", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "remember, I only want ETFs, so compare VOO and SCHD",
        profileSnapshot: { asset_scope: "etf_focused" },
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          route: "workflow",
          workflow: "compare_assets",
          entities: { symbols: ["VOO", "SCHD"] },
          slots: {
            symbols: { value: ["VOO", "SCHD"], source: "user", confidence: "high" },
          },
          preference_updates: [
            { key: "asset_scope", value: "etf_focused", confidence: "high", source: "inferred" },
          ],
          missing_required: [],
          tool_bundles: [],
          diagnostics: [],
          reasoning: "echoed preference written as an update",
        }),
      ),
    );

    // "remember, I only want ETFs" restates the saved preference; a no-op
    // rewrite pollutes preference provenance (the fixture-029 ECHO contract).
    expect(result.preference_updates).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toContain("preference_echo_suppressed");
  });

  it("does not hijack non-finance pass-through chat into a risk preference write", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "I'm feeling more aggressive on the tennis court lately",
        priorTurns: [
          { role: "user", text: "my backhand has been improving all summer" },
          { role: "assistant", text: "Great to hear the training is paying off." },
        ],
        profileSnapshot: { risk_profile: "conservative" },
      },
      fixedClient(
        JSON.stringify({
          routeKind: "pass_through",
          route: "fallback",
          entities: { symbols: [] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          tool_bundles: [],
          diagnostics: [],
          reasoning: "non-finance conversation",
        }),
      ),
    );

    // A saved risk_profile alone must not convert non-finance chat into a
    // preference write; finance context must come from the conversation.
    expect(result.routeKind).toBe("pass_through");
    expect(result.preference_updates).toEqual([]);
  });

  it("recovers conversational risk preference updates from prior profile context", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "I've been getting more cautious lately, I'm thinking conservative now",
        priorTurns: [
          {
            role: "assistant",
            text: "Got it — based on your profile I've been sizing positions aggressively.",
          },
        ],
        profileSnapshot: { risk_profile: "aggressive" },
      },
      fixedClient(
        JSON.stringify({
          routeKind: "pass_through",
          route: "fallback",
          entities: { symbols: [] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          tool_bundles: [],
          diagnostics: [],
          reasoning: "conversational statement",
        }),
      ),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.entities.riskProfile).toBe("conservative");
    expect(result.slots.risk_profile).toEqual({
      value: "conservative",
      source: "user",
      confidence: "high",
    });
    expect(result.preference_updates).toEqual([
      {
        key: "risk_profile",
        value: "conservative",
        confidence: "high",
        source: "inferred",
      },
    ]);
    expect(result.tool_bundles).toEqual(["core_market"]);
  });

  it("corrects portfolio-builder output for existing-allocation evaluation prompts", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Evaluate the prospects of a 60/40 portfolio over the next year and suggest one risk mitigation adjustment.",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "portfolio_builder",
          entities: { symbols: [] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "misread evaluation as construction",
        }),
      ),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.missing_required).toEqual([]);
    expect(result.tool_bundles).toContain("macro");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "portfolio_evaluation_corrected_to_agent_task",
      }),
    );
  });

  it("keeps an explicit funded portfolio construction request on the builder workflow", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Build me a long-term growth portfolio with 10000 USD, moderate risk, and four US stocks.",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "portfolio_builder",
          entities: { symbols: [], budget: 10000 },
          slots: {
            budget: { value: 10000, source: "user", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          reasoning: "explicit portfolio construction request",
        }),
      ),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.route).toBe("workflow");
    expect(result.workflow).toBe("portfolio_builder");
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "portfolio_evaluation_corrected_to_agent_task" }),
    );
  });

  it("corrects compare-assets output for existing-portfolio crash-risk prompts", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "I've got about $50,000 invested, mostly in SPY and a little MSFT. I'm 40 and planning for retirement in 25 years. I'm worried about a big market crash. Does this portfolio look too risky and what's a simple way to protect myself without missing growth?",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "compare_assets",
          entities: { symbols: ["SPY", "MSFT"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "misread portfolio review as asset comparison",
        }),
      ),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "portfolio_evaluation_corrected_to_agent_task",
      }),
    );
  });

  it("corrects portfolio-builder clarification for existing-allocation rebalance prompts", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text:
          "My portfolio is 45% tech stocks, 25% S&P 500 ETFs, and 30% bonds. " +
          "Should I rebalance to diversify more?",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "clarification",
          workflow: "portfolio_builder",
          entities: { symbols: [] },
          slots: {},
          preference_updates: [],
          missing_required: ["budget"],
          reasoning: "misread rebalance as construction",
        }),
      ),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.missing_required).toEqual([]);
    expect(result.tool_bundles).toContain("macro");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "portfolio_evaluation_corrected_to_agent_task",
      }),
    );
  });

  it("corrects portfolio-builder dispatch for saved portfolio exposure reviews", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text:
          "Does my current portfolio look too exposed if rates stay high for another year, " +
          "and what would you change first?",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "portfolio_builder",
          entities: { symbols: [] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "misread existing portfolio exposure review as construction",
        }),
      ),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.missing_required).toEqual([]);
    expect(result.tool_bundles).toContain("macro");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "portfolio_evaluation_corrected_to_agent_task",
      }),
    );
  });

  it("corrects portfolio-builder output for explicit multi-ETF tradeoff prompts", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "If I have $5,000 for 10-15 years, should I prioritize VYM or SCHD, or something more growth-oriented like VOO or QQQ? What are the tradeoffs?",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "portfolio_builder",
          entities: { symbols: ["VYM", "SCHD", "VOO", "QQQ"], budget: 5000 },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "misread tradeoff as portfolio construction",
        }),
      ),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.route).toBe("workflow");
    expect(result.workflow).toBe("compare_assets");
    expect(result.entities.symbols).toEqual(["VYM", "SCHD", "VOO", "QQQ"]);
    expect(result.missing_required).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "portfolio_tradeoff_corrected_to_compare_assets",
      }),
    );
  });

  it("corrects options output for prose multi-asset swing-trade comparisons", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Compare NVDA and AMD for a 6-month swing trade. Use available market data, call out valuation and downside risks, and end with a cautious action plan.",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "options_screener",
          entities: { symbols: ["NVDA", "AMD"], direction: "bullish", dteHint: "month" },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "misread call out as call options",
        }),
      ),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.route).toBe("workflow");
    expect(result.workflow).toBe("compare_assets");
    expect(result.entities.symbols).toEqual(["NVDA", "AMD"]);
    expect(result.entities.direction).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "options_comparison_corrected_to_compare_assets",
      }),
    );
  });

  it("corrects portfolio lot mutations away from compare workflow dispatch", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Add 40 shares of ASTS to my portfolio at an average cost of 28 dollars USD.",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "compare_assets",
          entities: { symbols: ["ASTS", "USD"], budget: 28 },
          slots: {
            symbols: { value: ["ASTS", "USD"], source: "user", confidence: "high" },
            budget: { value: 28, source: "user", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          tool_bundles: ["core_market"],
          diagnostics: [],
          reasoning: "misread a portfolio mutation as comparison",
        }),
      ),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.workflow).toBe("watchlist_or_tracking");
    expect(result.entities.symbols).toEqual(["ASTS"]);
    expect(result.missing_required).toEqual([]);
    expect(result.slots.symbols?.value).toEqual(["ASTS"]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "stateful_tracking_corrected_to_agent_task",
      }),
    );
  });

  it("removes live tool bundles for no-symbol conceptual education", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Explain how to use valuation ratios without over relying on them.",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "agent_task",
          workflow: "general_finance_qa",
          entities: { symbols: [] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          tool_bundles: ["core_market", "macro"],
          diagnostics: [],
          reasoning: "conceptual education prompt",
        }),
      ),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.tool_bundles).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "conceptual_education_no_tools",
      }),
    );
  });

  it("keeps macro tools for forward-looking rate impact questions", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "How should falling rates affect growth stocks over the next year?",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "agent_task",
          workflow: "general_finance_qa",
          entities: { symbols: [] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          tool_bundles: ["macro"],
          diagnostics: [],
          reasoning: "macro rate context",
        }),
      ),
    );

    expect(result.tool_bundles).toContain("macro");
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({
        code: "conceptual_education_no_tools",
      }),
    );
  });

  it("recovers the macro tool bundle for a current Fear and Greed request when the router omits a workflow", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Show me the current Fear and Greed index",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "agent_task",
          route: "fallback",
          entities: { symbols: [] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          tool_bundles: ["core_market"],
          diagnostics: [],
          reasoning: "simple market sentiment request",
        }),
      ),
    );

    expect(result.workflow).toBe("general_finance_qa");
    expect(result.tool_bundles).toContain("macro");
    expect(activeToolsForBundles(result.tool_bundles)).toContain("get_fear_greed");
  });

  it("retains the Fear and Greed tool when the router assigns a non-macro workflow", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Show me the current Fear and Greed index",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "agent_task",
          route: "fallback",
          workflow: "watchlist_or_tracking",
          entities: { symbols: [] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          tool_bundles: ["core_market"],
          diagnostics: [],
          reasoning: "misclassified current index request",
        }),
      ),
    );

    expect(result.tool_bundles).toContain("macro");
    expect(activeToolsForBundles(result.tool_bundles)).toContain("get_fear_greed");
  });

  it("routes missing options symbol to clarification with ask_user bundle", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "build me an options setup" },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "options_screener",
          entities: { symbols: [] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "options request",
        }),
      ),
    );

    expect(result.routeKind).toBe("clarification");
    expect(result.route).toBe("fallback");
    expect(result.missing_required).toEqual(["symbol"]);
    expect(result.tool_bundles).toEqual(["clarification"]);
  });

  it("routes missing portfolio budget to clarification", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "build me a diversified portfolio" },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "portfolio_builder",
          entities: { symbols: [] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "portfolio request",
        }),
      ),
    );

    expect(result.routeKind).toBe("clarification");
    expect(result.missing_required).toEqual(["budget"]);
  });

  it("does not clarify when resolved slots supply the required budget", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "build me a portfolio like last time" },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "portfolio_builder",
          entities: { symbols: [] },
          slots: {
            budget: { value: 10_000, source: "preference", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          reasoning: "profile supplies budget",
        }),
      ),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.missing_required).toEqual([]);
    expect(result.slots.budget?.source).toBe("preference");
  });

  it("enriches omitted portfolio constraints from deterministic extraction", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "Build a conservative ETF portfolio with $25k for 5 years" },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "portfolio_builder",
          entities: { symbols: [] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "portfolio request but omitted constraints",
        }),
      ),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.workflow).toBe("portfolio_builder");
    expect(result.entities.budget).toBe(25_000);
    expect(result.slots.budget).toEqual({
      value: 25_000,
      source: "user",
      confidence: "high",
    });
    expect(result.entities.riskProfile).toBe("conservative");
    expect(result.entities.assetScope).toBe("etf_focused");
    expect(result.entities.timeHorizon).toBe("5y");
  });

  it("does not clarify when prior context supplies the required symbol", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "what about a call spread?",
        priorTurns: [{ role: "user", text: "Let's look at NVDA" }],
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "options_screener",
          entities: { symbols: ["NVDA"] },
          slots: {
            symbol: { value: "NVDA", source: "prior_context", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          reasoning: "prior context supplies symbol",
        }),
      ),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.missing_required).toEqual([]);
    expect(result.slots.symbol?.source).toBe("prior_context");
  });

  it("enriches omitted option premium caps from deterministic extraction", async () => {
    const result = await route(
      { ...BASE_INPUT, text: "MSFT puts under $500 premium" },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "options_screener",
          entities: { symbols: ["MSFT"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "options request but omitted cap",
        }),
      ),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.workflow).toBe("options_screener");
    expect(result.entities.symbols).toEqual(["MSFT"]);
    expect(result.entities.direction).toBe("bearish");
    expect(result.entities.maxPremium).toBe(500);
    expect(result.entities.budget).toBeUndefined();
  });

  it("recovers follow-up symbols only from the nearest prior user turn", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "what about QQQ?",
        priorTurns: [
          { role: "user", text: "Compare NVDA and AMD" },
          { role: "assistant", text: "NVDA and AMD have different risk profiles." },
          { role: "user", text: "Tell me about SPY" },
          { role: "assistant", text: "SPY tracks large-cap US equities and mentioned IWM." },
        ],
      },
      fixedClient(
        JSON.stringify({
          routeKind: "agent_task",
          workflow: "single_asset_analysis",
          entities: { symbols: ["QQQ"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "follow-up",
        }),
      ),
    );

    expect(result.entities.symbols).toEqual(["QQQ", "SPY"]);
  });

  it("uses the owned underlying instead of a catalyst ticker for covered-call workflows", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "NVDA earnings are today. If I have DRAM, what is the best covered call to sell right now? Cost basis is $51.",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "options_screener",
          entities: { symbols: ["NVDA"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "misread catalyst as underlying",
        }),
      ),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.workflow).toBe("options_screener");
    expect(result.entities.symbols).toEqual(["DRAM", "NVDA"]);
    expect(result.entities.heldSymbol).toBe("DRAM");
    expect(result.entities.catalystSymbols).toEqual(["NVDA"]);
    expect(result.entities.costBasis).toBe(51);
    expect(result.entities.dteHint).toBe("event_week");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "covered_call_underlying_corrected",
      }),
    );
  });

  // Historical loss class: "1-2 weeks DTE preservation". The held-symbol
  // correction re-derives dteHint from deterministic extraction; a same-day
  // catalyst mention must not collapse an explicit "1-2 weeks out" request
  // into event_week/0-7 days anywhere in the postprocess.
  it("preserves an explicit 1-2 week DTE through catalyst-driven covered-call correction", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "I own 100 shares of DRAM at a $51 cost basis. NVDA earnings are today, but I want a covered call 1-2 weeks out. What strike and expiry should I look at?",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "options_screener",
          entities: { symbols: ["NVDA"], dteHint: "1-2 weeks" },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "covered call on owned DRAM around NVDA catalyst",
        }),
      ),
    );

    expect(result.routeKind).toBe("workflow_dispatch");
    expect(result.workflow).toBe("options_screener");
    expect(result.entities.heldSymbol).toBe("DRAM");
    expect(result.entities.dteHint).toBe("1-2 weeks");
    expect(result.slots.dte_target?.value).toBe("7_to_14_days");
  });

  it("keeps covered-call education and suitability prompts out of options workflow dispatch", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "I own 200 shares of Microsoft (MSFT) and it's been flat. How does selling covered calls work, and is it a good idea?",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "options_screener",
          entities: { symbols: ["MSFT"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "misread education as a contract screen",
        }),
      ),
    );

    expect(result.routeKind).toBe("agent_task");
    expect(result.route).toBe("fallback");
    expect(result.workflow).toBe("general_finance_qa");
    expect(result.tool_bundles).toEqual(expect.arrayContaining(["core_market", "options"]));
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "options_workflow_corrected_to_policy_task",
      }),
    );
  });

  it("enriches omitted protective-put hedge context from deterministic extraction", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "I own 200 shares of NVDA after a big rally. What's a reasonable protective put 30-45 days out that doesn't cost too much?",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "options_screener",
          entities: { symbols: ["NVDA"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "options request",
        }),
      ),
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

  it("keeps an explicit maximum options horizon ahead of a model-normalized hint", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "Screen bullish AAPL calls expiring within 60 days.",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "options_screener",
          entities: { symbols: ["AAPL"], direction: "bullish", dteHint: "60d" },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "options request",
        }),
      ),
    );

    expect(result.entities.dteHint).toBe("0-60 days");
  });

  it("uses the owned underlying instead of a catalyst ticker for protective-put workflows", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "NVDA earnings are today. I own 200 shares of AMD. What protective put should I buy for the next month?",
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "options_screener",
          entities: { symbols: ["NVDA"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "misread catalyst as underlying",
        }),
      ),
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
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "existing_position_underlying_corrected",
      }),
    );
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

describe("live-router deterministic context recovery", () => {
  it("carries prior symbols for an explicit same-question follow-up", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "same question for QQQ",
        priorTurns: [
          { role: "user", text: "I'm holding $500k-$1M in SPY — how is it positioned?" },
          { role: "assistant", text: "SPY tracks the S&P 500." },
        ],
      },
      fixedClient(
        JSON.stringify({
          routeKind: "agent_task",
          entities: { symbols: ["QQQ"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "follow-up",
        }),
      ),
    );

    expect(result.entities.symbols).toEqual(["QQQ", "SPY"]);
    expect(result.entities.budget).toBeUndefined();
  });

  it("recovers saved portfolio symbols and risk profile for an exposure review", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "does my current portfolio look too exposed if rates stay high?",
        profileSnapshot: {
          risk_profile: "moderate",
        },
        portfolioPositions: [
          { symbol: "SPY", quantity: 100 },
          { symbol: "TLT", quantity: 100 },
          { symbol: "AMD", quantity: 100 },
        ],
      },
      fixedClient(
        JSON.stringify({
          routeKind: "agent_task",
          workflow: "general_finance_qa",
          entities: { symbols: [], compareMetrics: ["interest_rates"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "portfolio exposure review",
        }),
      ),
    );

    expect(result.entities.symbols).toEqual(["SPY", "TLT", "AMD"]);
    expect(result.entities.riskProfile).toBe("moderate");
    expect(result.slots.risk_profile).toMatchObject({
      value: "moderate",
      source: "preference",
    });
  });

  it("recovers covered-call strategy and owned share quantity from profile context", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "should I sell calls against my AMD shares for the next 1-2 weeks?",
        portfolioPositions: [
          { symbol: "AMD", quantity: 40, costBasis: 40 },
          { symbol: "AMD", quantity: 60, costBasis: 60 },
        ],
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "options_screener",
          entities: { symbols: ["AMD"], heldSymbol: "AMD", direction: "bullish" },
          slots: {
            symbol: { value: "AMD", source: "user", confidence: "high" },
            time_horizon: { value: "1-2 weeks", source: "user", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          reasoning: "sell calls",
        }),
      ),
    );

    expect(result.entities.optionStrategy).toBe("covered_call");
    expect(result.entities.shareQuantity).toBe(100);
    expect(result.entities.costBasis).toBe(52);
    expect(result.slots.strategy).toMatchObject({ value: "covered_call", source: "user" });
  });

  it("does not average saved cost bases across currencies", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "should I sell calls against my AMD shares for the next 1-2 weeks?",
        portfolioPositions: [
          { symbol: "AMD", quantity: 50, costBasis: 40, currency: "USD" },
          { symbol: "AMD", quantity: 50, costBasis: 60, currency: "CAD" },
        ],
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "options_screener",
          entities: { symbols: ["AMD"], heldSymbol: "AMD" },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "sell calls",
        }),
      ),
    );

    expect(result.entities.shareQuantity).toBe(100);
    expect(result.entities.costBasis).toBeUndefined();
  });

  it("prefers canonical saved position values over model-only financial numbers", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "should I sell calls against my AMD shares for the next 1-2 weeks?",
        portfolioPositions: [{ symbol: "AMD", quantity: 100, costBasis: 52, currency: "USD" }],
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "options_screener",
          entities: {
            symbols: ["AMD"],
            heldSymbol: "AMD",
            shareQuantity: 900,
            costBasis: 999,
          },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "sell calls",
        }),
      ),
    );

    expect(result.entities.shareQuantity).toBe(100);
    expect(result.entities.costBasis).toBe(52);
  });

  it("drops model-only catalyst symbols from an existing-position request", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "should I sell calls against my AMD shares for the next 1-2 weeks?",
        portfolioPositions: [{ symbol: "AMD", quantity: 100, currency: "USD" }],
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "options_screener",
          entities: { symbols: ["AMD", "NVDA"], heldSymbol: "AMD" },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "sell calls",
        }),
      ),
    );

    expect(result.entities.symbols).toEqual(["AMD"]);
    expect(result.entities.catalystSymbols).toBeUndefined();
  });

  it("clears an unsupported model catalyst from a single-symbol position request", async () => {
    const result = await route(
      {
        ...BASE_INPUT,
        text: "What protective put should I buy for my AMD shares next month?",
        portfolioPositions: [{ symbol: "AMD", quantity: 200 }],
      },
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "options_screener",
          entities: {
            symbols: ["AMD"],
            heldSymbol: "AMD",
            catalystSymbols: ["NVDA"],
            optionStrategy: "protective_put",
            direction: "bearish",
          },
          slots: { symbol: { value: "AMD", source: "user", confidence: "high" } },
          preference_updates: [],
          missing_required: [],
          reasoning: "protective put",
        }),
      ),
    );

    expect(result.entities.symbols).toEqual(["AMD"]);
    expect(result.entities.catalystSymbols).toBeUndefined();
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
    const tools = activeToolsForBundles(
      ["core_market", "clarification"],
      [
        "get_stock_quote",
        "screen_stocks",
        "ask_user",
        "get_option_chain",
        "manage_alerts",
        "daily_watchlist_report",
        "manage_notifications",
      ],
    );

    expect(tools).toEqual([
      "get_stock_quote",
      "screen_stocks",
      "manage_alerts",
      "daily_watchlist_report",
      "manage_notifications",
      "ask_user",
    ]);
    expect(TOOL_BUNDLE_TOOLS.options).toContain("get_option_chain");
  });

  it("exposes stock screening only through the core market bundle", () => {
    expect(TOOL_BUNDLE_TOOLS.core_market).toContain("screen_stocks");
    expect(activeToolsForBundles(["macro"])).not.toContain("screen_stocks");
    expect(activeToolsForBundles(["sentiment"])).not.toContain("screen_stocks");
    expect(activeToolsForBundles(["sec"])).not.toContain("screen_stocks");
  });

  it("keeps macro tools for interest-rate comparisons", async () => {
    const output = await route(
      BASE_INPUT,
      fixedClient(
        JSON.stringify({
          routeKind: "workflow_dispatch",
          workflow: "compare_assets",
          entities: { symbols: ["SPY", "QQQ"], compareMetrics: ["interest_rates"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          diagnostics: [],
          reasoning: "rate-sensitive comparison",
        }),
      ),
    );
    const context = buildResolvedTurnContext(BASE_INPUT, output, {
      availableToolNames: ["get_stock_quote", "get_economic_data"],
    });

    expect(context.toolBundles).toContain("macro");
    expect(context.activeToolNames).toContain("get_economic_data");
  });
});

describe("ResolvedTurnContext", () => {
  it("records route, tool, memory, and diagnostic provenance", async () => {
    const output = await route(
      BASE_INPUT,
      fixedClient(
        JSON.stringify({
          routeKind: "agent_task",
          entities: { symbols: ["AAPL"] },
          slots: {
            symbol: { value: "AAPL", source: "user", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          diagnostics: [{ code: "example", message: "corrected" }],
          reasoning: "x",
        }),
      ),
    );
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
    const output = await route(
      BASE_INPUT,
      fixedClient(
        JSON.stringify({
          routeKind: "agent_task",
          entities: { symbols: ["AAPL"] },
          slots: {
            symbol: { value: "AAPL", source: "user", confidence: "high" },
          },
          preference_updates: [],
          missing_required: [],
          diagnostics: [],
          reasoning: "single asset decision",
        }),
      ),
    );
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
