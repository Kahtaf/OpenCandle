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
 * Requires live credentials for the configured pi-ai model (ANTHROPIC_API_KEY
 * or similar). Uses the OPENCANDLE_ROUTER_MODEL env var if set, otherwise
 * picks `claude-haiku-4-5` via the registered built-in Anthropic provider.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getModel, registerBuiltInApiProviders } from "@earendil-works/pi-ai/compat";
import { route } from "../../src/routing/router.js";
import { createPiAiRouterClient } from "../../src/routing/router-llm-client.js";
import type { RouterInputContext, RouterOutput } from "../../src/routing/router-types.js";

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
const DEFAULT_PROVIDER = process.env.OPENCANDLE_ROUTER_PROVIDER ?? "anthropic";
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

// Diff the routing contract only. Route kind/route stay visible so exemptions
// cannot mask dispatch/pass-through/clarification flips. Every exemption
// carries its classification; anything not exempted here is contractual.
function stripNonContract(
  out: RouterOutput,
  expected?: { slotKeys: string[]; toolBundles: string[] },
): unknown {
  const entities = { ...out.entities };
  // Class C: natural DTE prose and ETF-only compare metric vocabulary are
  // normalized by downstream slot resolution, not by route selection. DTE
  // horizon coverage is preserved through slot values below.
  delete entities.dteHint;
  delete entities.compareMetrics;

  return {
    routeKind: out.routeKind,
    route: out.route,
    // Class B: fallback/agent-task workflow labels are model-specific planning
    // hints; workflow identity is contractual only for dispatchable workflows.
    workflow: out.routeKind === "workflow_dispatch" ? out.workflow : undefined,
    entities,
    // Class A: EXTRA slot keys a model volunteers are exempt; the VALUE of
    // every expected slot is contractual (blanket slot dropping masked wrong
    // budgets/symbols). Class C: source/confidence are provenance detail.
    slots: contractSlotValues(out.slots, expected?.slotKeys),
    // Contractual: a spurious preference write is the exact failure class the
    // preference-ECHO fixture (029) exists to forbid.
    preference_updates: out.preference_updates,
    // Contractual: every EXPECTED bundle must be present (a missing bundle
    // means tools unavailable at runtime). Class A: extra volunteered
    // bundles only widen the available tool surface and are exempt; order
    // is presentation.
    tool_bundles: contractToolBundles(out.tool_bundles, expected?.toolBundles),
    missing_required: out.missing_required,
  };
}

function contractToolBundles(bundles: string[] | undefined, allowedExtra?: string[]): string[] {
  const sorted = [...(bundles ?? [])].sort();
  if (!allowedExtra) return sorted;
  const expectedSet = new Set(allowedExtra);
  return sorted.filter((bundle) => expectedSet.has(bundle));
}

function contractSlotValues(
  slots: RouterOutput["slots"],
  allowedKeys?: string[],
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, slot] of Object.entries(slots ?? {})) {
    if (allowedKeys && !allowedKeys.includes(key)) continue;
    values[key] = slot?.value;
  }
  return values;
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
  registerBuiltInApiProviders();
  const model = getModel(DEFAULT_PROVIDER as "anthropic", DEFAULT_MODEL_ID as "claude-haiku-4-5");
  const client = createPiAiRouterClient(model);

  const fixtures = loadFixtures();
  const latencies: number[] = [];
  let pass = 0;
  const failures: Array<{ name: string; diffs: string[] }> = [];

  console.log(
    `Running live router eval against ${fixtures.length} fixtures with model=${DEFAULT_MODEL_ID}...\n`,
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
      stripNonContract(data.expectedRouterOutput),
      stripNonContract(result, {
        slotKeys: Object.keys(data.expectedRouterOutput.slots ?? {}),
        toolBundles: data.expectedRouterOutput.tool_bundles ?? [],
      }),
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
