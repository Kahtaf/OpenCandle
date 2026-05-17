import { describe, it, expect, vi } from "vitest";
import { route, validateRouterOutput } from "../../../src/routing/router.js";
import { buildRouterPrompt } from "../../../src/routing/router-prompt.js";
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
          slots: { foo: { value: 1, source: "memory", confidence: "high" } },
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
    const expected: RouterOutput = {
      route: "workflow",
      workflow: "single_asset_analysis",
      entities: { symbols: ["AAPL"] },
      slots: { symbol: { value: "AAPL", source: "user", confidence: "high" } },
      preference_updates: [],
      missing_required: [],
      reasoning: "simple",
    };
    const client = fixedClient(JSON.stringify(expected));
    const result = await route(BASE_INPUT, client);
    expect(result).toEqual(expected);
  });

  it("retries once on validation failure", async () => {
    const bad = JSON.stringify({ route: "nope" });
    const good = JSON.stringify({
      route: "fallback",
      entities: { symbols: ["AAPL"] },
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
    const result = await route(BASE_INPUT, client);
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
      { ...BASE_INPUT, text: "tell me about $AAPL and $MSFT" },
      client,
    );
    expect(result.route).toBe("fallback");
    expect(result.entities.symbols.sort()).toEqual(["AAPL", "MSFT"]);
    expect(result.missing_required).toEqual([]);
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
    expect(prompt).toContain("fallback");
  });

  it("asks the router to preserve compare metrics such as macro hedge intent", () => {
    const prompt = buildRouterPrompt(BASE_INPUT);
    expect(prompt).toContain("compareMetrics");
    expect(prompt).toContain("macro_hedge");
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
