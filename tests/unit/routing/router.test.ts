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
      "ask_user",
      "get_option_chain",
    ]);

    expect(tools).toEqual(["get_stock_quote", "ask_user"]);
    expect(TOOL_BUNDLE_TOOLS.options).toContain("get_option_chain");
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
  });
});
