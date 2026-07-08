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

  it("fixture set is non-empty", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

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
  // Beyond JSON round-trip: each fixture's slots must produce an Assumptions
  // block that distributes slot sources into the canonical sections, and
  // fallback-route fixtures must produce a fallback playbook that carries the
  // block and the ask_user directive when missing_required is non-empty.
  const fixtures = loadFixtures();

  for (const { name, data } of fixtures) {
    const { slots } = data.expectedRouterOutput;
    const hasSlots = Object.keys(slots).length > 0;

    if (hasSlots) {
      it(`fixture ${name} Assumptions block places each slot under the right source section`, () => {
        const block = buildAssumptionsBlockFromRouter(slots);
        const sectionForLabel = (line: string) => {
          if (line.startsWith("  User-specified:")) return "user";
          if (line.startsWith("  From saved preferences:")) return "preference";
          if (line.startsWith("  From prior context:")) return "prior_context";
          if (line.startsWith("  From memory:")) return "memory";
          if (line.startsWith("  Defaults:")) return "default";
          return null;
        };
        const sectionContents: Record<string, string> = {
          user: "",
          preference: "",
          prior_context: "",
          memory: "",
          default: "",
        };
        let currentSection: string | null = null;
        for (const line of block.split("\n")) {
          const s = sectionForLabel(line);
          if (s) {
            currentSection = s;
            sectionContents[s] += line;
          } else if (currentSection) {
            sectionContents[currentSection] += ` ${line}`;
          }
        }
        for (const [key, slot] of Object.entries(slots)) {
          expect(sectionContents[slot.source]).toContain(`${key} (`);
        }
      });
    }

    if (data.expectedRouterOutput.route === "fallback") {
      it(`fixture ${name} fallback playbook embeds assumptions as context and ask_user directive`, () => {
        const assumptionsBlock = buildAssumptionsBlockFromRouter(slots);
        const playbook = buildFallbackPlaybook({
          assumptionsBlock,
          missingRequired: data.expectedRouterOutput.missing_required,
          extraContext:
            data.expectedRouterOutput.entities.symbols.length > 0
              ? `Router-extracted symbols: ${data.expectedRouterOutput.entities.symbols.join(", ")}.`
              : undefined,
        });
        if (hasSlots) {
          // The playbook must carry the block as context, but should not tell
          // the model to reproduce fallback assumptions verbatim in the answer.
          expect(playbook).toContain(assumptionsBlock);
          expect(playbook).toContain("Keep this fallback generic");
          expect(playbook).toContain("Do not add task-specific instructions here");
          expect(playbook).not.toContain("same-month year-over-year inflation");
          expect(playbook).not.toContain(
            "instead of searching only for provider-specific series identifiers",
          );
          expect(playbook).not.toContain("Start with the Assumptions block");
          expect(playbook).not.toContain("Reproduce the block in your response exactly");
        }
        if (data.expectedRouterOutput.missing_required.length > 0) {
          expect(playbook).toMatch(/ask_user/);
          for (const slot of data.expectedRouterOutput.missing_required) {
            expect(playbook).toContain(slot);
          }
        }
        // Universal: no refusal vocabulary anywhere in the playbook.
        expect(playbook).not.toMatch(/not financial advice/i);
        expect(playbook).not.toMatch(/consult a qualified/i);
        expect(playbook).not.toMatch(/I cannot/i);
      });
    }
  }

  it("full system prompt assembled for a fallback fixture contains analyst stance + playbook + assumptions", () => {
    const fallback = fixtures.find((f) => f.data.expectedRouterOutput.route === "fallback");
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
