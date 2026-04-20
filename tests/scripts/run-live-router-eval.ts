#!/usr/bin/env tsx
/**
 * Opt-in live eval for the intent router.
 *
 * Runs the REAL LLM router against the deterministic fixture inputs (ignoring
 * the pre-recorded `expectedRouterOutput` for prompt construction, but using
 * it as the labeled answer for diffing).
 *
 * NOT part of CI. Not wired into `npm test` or `npm run test:e2e`.
 * Invoke via `npm run eval:router-live`.
 *
 * Requires live credentials for the configured pi-ai model (ANTHROPIC_API_KEY
 * or similar). Uses the OPENCANDLE_ROUTER_MODEL env var if set, otherwise
 * picks `claude-haiku-4-5` via the registered built-in Anthropic provider.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getModel, registerBuiltInApiProviders } from "@mariozechner/pi-ai";
import { route } from "../../src/routing/router.js";
import { createPiAiRouterClient } from "../../src/routing/router-llm-client.js";
import type {
  RouterInputContext,
  RouterOutput,
} from "../../src/routing/router-types.js";

interface RouterFixture {
  input: string;
  priorTurns: RouterInputContext["priorTurns"];
  profileSnapshot: RouterInputContext["profileSnapshot"];
  expectedRouterOutput: RouterOutput;
  tags: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = join(__dirname, "..", "fixtures", "router");
const DEFAULT_MODEL_ID = process.env.OPENCANDLE_ROUTER_MODEL ?? "claude-haiku-4-5";

function loadFixtures(): Array<{ name: string; data: RouterFixture }> {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json") && f !== "BASELINE.json")
    .sort()
    .map((name) => ({
      name,
      data: JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf-8")) as RouterFixture,
    }));
}

function stripReasoning(out: RouterOutput): Omit<RouterOutput, "reasoning"> {
  const { reasoning: _r, ...rest } = out;
  return rest;
}

function shallowDiff(expected: unknown, actual: unknown): string[] {
  const diffs: string[] = [];
  function walk(path: string, exp: unknown, act: unknown): void {
    if (JSON.stringify(exp) === JSON.stringify(act)) return;
    if (
      exp === null ||
      act === null ||
      typeof exp !== "object" ||
      typeof act !== "object"
    ) {
      diffs.push(`${path}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(act)}`);
      return;
    }
    const keys = new Set([...Object.keys(exp), ...Object.keys(act)]);
    for (const k of keys) {
      walk(
        `${path}.${k}`,
        (exp as Record<string, unknown>)[k],
        (act as Record<string, unknown>)[k],
      );
    }
  }
  walk("", expected, actual);
  return diffs;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main(): Promise<void> {
  registerBuiltInApiProviders();
  const model = getModel("anthropic", DEFAULT_MODEL_ID as "claude-haiku-4-5");
  const client = createPiAiRouterClient(model);

  const fixtures = loadFixtures();
  const latencies: number[] = [];
  let pass = 0;
  const failures: Array<{ name: string; diffs: string[] }> = [];

  console.log(`Running live router eval against ${fixtures.length} fixtures with model=${DEFAULT_MODEL_ID}...\n`);

  for (const { name, data } of fixtures) {
    const start = Date.now();
    let result: RouterOutput;
    try {
      result = await route(
        {
          text: data.input,
          priorTurns: data.priorTurns,
          profileSnapshot: data.profileSnapshot,
          recentWorkflowRuns: [],
        },
        client,
      );
    } catch (err) {
      failures.push({
        name,
        diffs: [`threw: ${err instanceof Error ? err.message : String(err)}`],
      });
      console.log(`FAIL ${name}: threw`);
      continue;
    }
    const elapsed = Date.now() - start;
    latencies.push(elapsed);

    const diffs = shallowDiff(
      stripReasoning(data.expectedRouterOutput),
      stripReasoning(result),
    );
    if (diffs.length === 0) {
      pass += 1;
      console.log(`PASS ${name} (${elapsed}ms)`);
    } else {
      failures.push({ name, diffs });
      console.log(`FAIL ${name} (${elapsed}ms)`);
      for (const d of diffs) console.log(`  ${d}`);
    }
  }

  const total = fixtures.length;
  const passRate = total === 0 ? 0 : pass / total;

  console.log(`\n--- Summary ---`);
  console.log(`pass: ${pass}/${total} (passRate=${passRate.toFixed(3)})`);
  console.log(`latency p50=${percentile(latencies, 50)}ms p95=${percentile(latencies, 95)}ms`);
  if (failures.length > 0) {
    console.log(`failures: ${failures.map((f) => f.name).join(", ")}`);
  }

  if (passRate < 1.0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
