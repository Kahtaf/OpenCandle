#!/usr/bin/env tsx
/**
 * Opt-in live eval for the intent router.
 *
 * Runs the REAL LLM router against the deterministic fixture inputs (ignoring
 * the pre-recorded `expectedRouterOutput` for prompt construction, but using
 * it as the labeled answer for diffing).
 *
 * NOT part of CI. Not wired into `npm test` or `npm run test:e2e`.
 * Invoke via `npm run eval -- router-live`.
 *
 * Uses OpenCandle's configured Pi model runtime and stored authentication.
 * OPENCANDLE_ROUTER_PROVIDER and OPENCANDLE_ROUTER_MODEL can override the
 * configured default when supplied together.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Api, getModel, type Model } from "@earendil-works/pi-ai/compat";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { loadEnv } from "../../src/config.js";
import { route } from "../../src/routing/router.js";
import { createPiAiRouterClient } from "../../src/routing/router-llm-client.js";
import type { RouterInputContext, RouterOutput } from "../../src/routing/router-types.js";
import { selectDefaultCompetitiveModel } from "../evals/competitive-finance.js";
import { stripNonContract } from "../evals/router-live-contract.js";

interface RouterFixture {
  input: string;
  priorTurns: RouterInputContext["priorTurns"];
  profileSnapshot: RouterInputContext["profileSnapshot"];
  portfolioPositions?: RouterInputContext["portfolioPositions"];
  expectedRouterOutput: RouterOutput;
  tags: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = join(__dirname, "..", "fixtures", "router");

loadEnv();

const REQUESTED_PROVIDER = process.env.OPENCANDLE_ROUTER_PROVIDER;
const REQUESTED_MODEL_ID = process.env.OPENCANDLE_ROUTER_MODEL;

function loadFixtures(): Array<{ name: string; data: RouterFixture }> {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json") && f !== "BASELINE.json")
    .sort()
    .map((name) => ({
      name,
      data: JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf-8")) as RouterFixture,
    }));
}

function shallowDiff(expected: unknown, actual: unknown): string[] {
  const diffs: string[] = [];
  function walk(path: string, exp: unknown, act: unknown): void {
    if (JSON.stringify(exp) === JSON.stringify(act)) return;
    if (exp === null || act === null || typeof exp !== "object" || typeof act !== "object") {
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
  const modelRuntime = await ModelRuntime.create();
  const modelRegistry = new ModelRegistry(modelRuntime);
  const model = resolveRouterModel(modelRuntime, modelRegistry);
  const client = createPiAiRouterClient(
    model,
    modelRuntime.completeSimple.bind(modelRuntime) as Parameters<typeof createPiAiRouterClient>[1],
  );

  const fixtures = loadFixtures();
  const latencies: number[] = [];
  let pass = 0;
  const failures: Array<{ name: string; diffs: string[] }> = [];

  console.log(
    `Running live router eval against ${fixtures.length} fixtures with model=${model.provider}/${model.id}...\n`,
  );

  for (const { name, data } of fixtures) {
    const start = Date.now();
    let result: RouterOutput;
    try {
      result = await route(
        {
          text: data.input,
          priorTurns: data.priorTurns,
          profileSnapshot: data.profileSnapshot,
          portfolioPositions: data.portfolioPositions,
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

    const contract = {
      slotKeys: Object.keys(data.expectedRouterOutput.slots ?? {}),
      toolBundles: data.expectedRouterOutput.tool_bundles ?? [],
    };
    const diffs = shallowDiff(
      stripNonContract(data.expectedRouterOutput, contract),
      stripNonContract(result, contract),
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

function resolveRouterModel(modelRuntime: ModelRuntime, modelRegistry: ModelRegistry): Model<Api> {
  if (REQUESTED_PROVIDER && REQUESTED_MODEL_ID) {
    return (
      modelRegistry.find(REQUESTED_PROVIDER, REQUESTED_MODEL_ID) ??
      (getModel(REQUESTED_PROVIDER as never, REQUESTED_MODEL_ID as never) as Model<Api>)
    );
  }

  const selected = selectDefaultCompetitiveModel({
    googleAuthConfigured: modelRuntime.getProviderAuthStatus("google").configured,
    googleModel: getModel("google", "gemini-2.5-flash") as Model<Api>,
    available: modelRegistry.getAvailable(),
  });
  if (selected) return selected;

  throw new Error(
    "No configured model found for router-live. Configure a Pi/OpenCandle model or set OPENCANDLE_ROUTER_PROVIDER and OPENCANDLE_ROUTER_MODEL with matching credentials.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
