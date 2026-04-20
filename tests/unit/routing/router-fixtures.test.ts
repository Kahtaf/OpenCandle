import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { route } from "../../../src/routing/router.js";
import type {
  RouterInputContext,
  RouterLlmClient,
  RouterOutput,
} from "../../../src/routing/router-types.js";

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
});
