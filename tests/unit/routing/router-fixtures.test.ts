import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFallbackPlaybook,
  PromptContextBuilder,
} from "../../../src/prompts/context-builder.js";
import { buildAssumptionsBlockFromRouter } from "../../../src/prompts/workflow-prompts.js";
import { route } from "../../../src/routing/router.js";
import type {
  RouterInputContext,
  RouterLlmClient,
  RouterOutput,
} from "../../../src/routing/router-types.js";
import { buildResolvedTurnContext } from "../../../src/routing/turn-context.js";

interface RouterFixture {
  input: string;
  priorTurns: RouterInputContext["priorTurns"];
  profileSnapshot: RouterInputContext["profileSnapshot"];
  portfolioPositions?: RouterInputContext["portfolioPositions"];
  expectedRouterOutput: RouterOutput;
  tags: string[];
}

const FIXTURE_DIR = join(__dirname, "..", "..", "fixtures", "router");

function loadFixtures(): Array<{ name: string; data: RouterFixture }> {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json") && f !== "BASELINE.json")
    .sort()
    .map((name) => ({
      name,
      data: JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf-8")) as RouterFixture,
    }));
}

function mockClient(expected: RouterOutput): RouterLlmClient {
  return {
    async complete(): Promise<string> {
      return JSON.stringify(expected);
    },
  };
}

/**
 * Strip the `reasoning` field for comparison — spec requires reasoning-field
 * exemption from exact-match in both CI and live tiers.
 */
function stripReasoning(output: RouterOutput): Omit<RouterOutput, "reasoning"> {
  const { reasoning: _reasoning, ...rest } = output;
  return rest;
}

describe("Router deterministic fixtures", () => {
  const fixtures = loadFixtures();

  it("suite contains at least one multi-turn fixture (priorTurns.length > 0)", () => {
    const multiTurn = fixtures.filter(({ data }) => data.priorTurns.length > 0);
    expect(
      multiTurn.length,
      "expected at least one fixture with priorTurns.length > 0 — see router-evals spec 'Multi-Turn Fixture Presence Guard'",
    ).toBeGreaterThan(0);
  });

  for (const { name, data } of fixtures) {
    it(`fixture ${name} passes with mocked LLM output`, async () => {
      const client = mockClient(data.expectedRouterOutput);
      const result = await route(
        {
          text: data.input,
          priorTurns: data.priorTurns,
          profileSnapshot: data.profileSnapshot,
          portfolioPositions: data.portfolioPositions,
          recentWorkflowRuns: [],
        },
        client,
      );

      expect(stripReasoning(result)).toEqual(stripReasoning(data.expectedRouterOutput));
    });
  }

  it("fixtures expose planning expectations without dropping route metadata", async () => {
    const expectedPlanningByFixture = new Map([
      ["005-compare-assets.json", { taskFamily: "asset_compare", policyCardId: "asset_compare" }],
      [
        "009-general-qa.json",
        { taskFamily: "concept_explainer", policyCardId: "concept_explainer" },
      ],
    ]);

    for (const { name, data } of fixtures) {
      const expected = expectedPlanningByFixture.get(name);
      if (!expected) continue;
      const result = await route(
        {
          text: data.input,
          priorTurns: data.priorTurns,
          profileSnapshot: data.profileSnapshot,
          portfolioPositions: data.portfolioPositions,
          recentWorkflowRuns: [],
        },
        mockClient(data.expectedRouterOutput),
      );
      const resolved = buildResolvedTurnContext(
        {
          text: data.input,
          priorTurns: data.priorTurns,
          profileSnapshot: data.profileSnapshot,
          recentWorkflowRuns: [],
        },
        result,
      );

      expect(resolved.routeKind).toBe(data.expectedRouterOutput.routeKind);
      expect(resolved.workflow).toBe(data.expectedRouterOutput.workflow);
      expect(resolved.entities).toEqual(data.expectedRouterOutput.entities);
      expect(resolved.toolBundles).toEqual(data.expectedRouterOutput.tool_bundles);
      expect(resolved.planning.taskFamily).toBe(expected.taskFamily);
      expect(resolved.planning.policyCardId).toBe(expected.policyCardId);
    }
  });
});

describe("Router fixtures drive prompt assembly correctly", () => {
  const fixtures = loadFixtures();

  it.each([
    ["010-preference-from-memory.json", "From saved preferences: risk_profile (conservative)"],
    ["027-compare-prior-context.json", "From prior context: symbols (SPY, NVDA, AMD)"],
  ])("preserves slot provenance from %s", (name, expected) => {
    const fixture = fixtures.find((fixture) => fixture.name === name);
    expect(fixture).toBeDefined();
    const block = buildAssumptionsBlockFromRouter(fixture?.data.expectedRouterOutput.slots ?? {});
    expect(block).toContain(expected);
    expect(block).toContain("User-specified:");
  });

  it.each([
    "004-options-missing-symbol.json",
    "006-fallback-entry-levels.json",
    "007-fallback-data-fetch.json",
    "019-iv-as-volatility.json",
  ])("carries assumptions and clarification requirements from %s", (name) => {
    const fixture = fixtures.find((fixture) => fixture.name === name);
    if (!fixture) throw new Error(`Missing router fixture ${name}`);
    const { slots, missing_required, entities } = fixture.data.expectedRouterOutput;
    const assumptionsBlock = buildAssumptionsBlockFromRouter(slots);
    const playbook = buildFallbackPlaybook({
      assumptionsBlock,
      missingRequired: missing_required,
      extraContext:
        entities.symbols.length > 0
          ? `Router-extracted symbols: ${entities.symbols.join(", ")}.`
          : undefined,
    });

    expect(playbook).toContain(`## Assumptions Context\n${assumptionsBlock}`);
    expect(playbook).toContain("Keep this fallback generic");
    expect(playbook).toContain("only as internal routing context");
    expect(playbook).not.toMatch(/not financial advice|consult a qualified|I cannot/i);
    if (missing_required.length > 0) {
      expect(playbook).toContain(`required but not yet filled: ${missing_required.join(", ")}`);
      expect(playbook).toContain("Call the `ask_user` tool");
    } else {
      expect(playbook).not.toContain("## Missing Required Information");
    }
  });

  it("full system prompt assembled for a fallback fixture contains analyst stance + playbook + assumptions", () => {
    const fallback = fixtures.find(
      (f) => f.data.expectedRouterOutput.routeKind !== "workflow_dispatch",
    );
    expect(fallback, "need at least one fallback fixture").toBeDefined();
    if (!fallback) throw new Error("need at least one fallback fixture");
    const { slots, missing_required, entities } = fallback.data.expectedRouterOutput;
    const assumptionsBlock = buildAssumptionsBlockFromRouter(slots);
    const builder = new PromptContextBuilder();
    builder.populateFromOptions({
      fallbackContext: {
        assumptionsBlock,
        missingRequired: missing_required,
        extraContext:
          entities.symbols.length > 0
            ? `Router-extracted symbols: ${entities.symbols.join(", ")}.`
            : undefined,
      },
    });
    const prompt = builder.build();
    // Analyst stance from change A (universal).
    expect(prompt.toLowerCase()).toContain("analyst");
    expect(prompt.toLowerCase()).toContain("invalidation");
    // Fallback playbook marker.
    expect(prompt).toContain("## Fallback Playbook");
    expect(prompt).not.toContain("Start your response with that block exactly as written");
    // No refusal vocabulary from any section.
    expect(prompt).not.toMatch(/not financial advice/i);
    expect(prompt).not.toMatch(/consult a qualified/i);
  });
});
