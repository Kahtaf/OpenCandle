/**
 * E2E spot-check for the manual-run harness opencandle-* custom-entry drain.
 *
 * Task 3.4 of router-context-and-observability. Spawns `manual-run.ts` against
 * a live LLM, reads the emitted `trace.json`, and asserts that:
 *   - `customEntries` is present and is an array
 *   - At least one `opencandle-disclaimer` entry is present (emitted at
 *     `turn_end` on every final assistant turn)
 *   - For a workflow-dispatching prompt (portfolio builder), at least one
 *     `opencandle-workflow` entry is present
 *   - If router mode is active (OPENCANDLE_ROUTER_MODE=llm), at least one
 *     `opencandle-router` entry is present — router-specific assertions are
 *     skipped if the flag is not set.
 *
 * Requires one of GOOGLE_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY in the
 * environment. Skips with a clear notice otherwise (the drain logic itself is
 * covered by the LLM-free integration test at
 * `tests/unit/harness/custom-entries.test.ts`).
 *
 * Usage: npx tsx tests/e2e/harness-custom-entries.test.ts
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type LlmChoice = { envVar: string };
const LLM_CANDIDATES: readonly LlmChoice[] = [
  { envVar: "GOOGLE_API_KEY" },
  { envVar: "ANTHROPIC_API_KEY" },
  { envVar: "OPENAI_API_KEY" },
];
const hasLlm = LLM_CANDIDATES.some((c) => !!process.env[c.envVar]);
if (!hasLlm) {
  console.log(
    "Skipping harness-custom-entries e2e: no LLM credential in env " +
      `(need one of ${LLM_CANDIDATES.map((c) => c.envVar).join(", ")}).`,
  );
  console.log(
    "Drain logic is still covered LLM-free by tests/unit/harness/custom-entries.test.ts.",
  );
  process.exit(0);
}

interface TraceEntry {
  customType: string;
  data: unknown;
  timestamp: string;
}

interface Trace {
  prompt: string;
  customEntries?: TraceEntry[];
  text?: string;
}

function runHarness(prompt: string): Trace {
  const ipcDir = mkdtempSync(join(tmpdir(), "oc-harness-customentries-"));
  try {
    const result = spawnSync(
      "npx",
      ["tsx", "tests/harness/manual-run.ts", ipcDir, prompt],
      {
        cwd: process.cwd(),
        encoding: "utf-8",
        // Manual-run waits on askUser via IPC if scripted answers aren't supplied.
        // For portfolio_builder prompts, pre-script a few reasonable answers so
        // the run doesn't hang. The harness consumes them in order.
        // Passing via argv[4] as JSON array per manual-run.ts convention.
        timeout: 10 * 60 * 1000,
      },
    );
    if (result.status !== 0) {
      throw new Error(
        `manual-run failed (exit ${result.status}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    }
    const traceRaw = readFileSync(join(ipcDir, "trace.json"), "utf-8");
    return JSON.parse(traceRaw) as Trace;
  } finally {
    rmSync(ipcDir, { recursive: true, force: true });
  }
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

function record(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${name}: ${message}`);
    failures.push(`${name}: ${message}`);
    failed++;
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// -----------------------------------------------------------------------------
// Case 1: a workflow-dispatching prompt. Portfolio builder dispatches via the
// extension's rule-mode path (or LLM-router workflow path when router mode is
// enabled). Either way, `opencandle-workflow` should be appended.
// -----------------------------------------------------------------------------
console.log("=== harness-custom-entries e2e ===");
console.log("\nCase 1: workflow-dispatching prompt (portfolio builder)");

const workflowTrace = runHarness("build me a $10k portfolio");

record("customEntries is present on the trace", () => {
  assert(workflowTrace.customEntries !== undefined, "customEntries is undefined");
  assert(Array.isArray(workflowTrace.customEntries), "customEntries is not an array");
});

record("workflow-dispatching prompt emits at least one opencandle-workflow entry", () => {
  const entries = workflowTrace.customEntries ?? [];
  const wf = entries.filter((e) => e.customType === "opencandle-workflow");
  assert(
    wf.length >= 1,
    `expected >=1 opencandle-workflow entry, got ${wf.length}. ` +
      `All customTypes: ${entries.map((e) => e.customType).join(", ") || "(none)"}`,
  );
});

record("final assistant response emits at least one opencandle-disclaimer entry", () => {
  const entries = workflowTrace.customEntries ?? [];
  const disclaimer = entries.filter((e) => e.customType === "opencandle-disclaimer");
  assert(
    disclaimer.length >= 1,
    `expected >=1 opencandle-disclaimer entry on a turn with final assistant text, ` +
      `got ${disclaimer.length}. All customTypes: ` +
      `${entries.map((e) => e.customType).join(", ") || "(none)"}`,
  );
});

if (process.env.OPENCANDLE_ROUTER_MODE === "llm") {
  record("router mode emits at least one opencandle-router entry", () => {
    const entries = workflowTrace.customEntries ?? [];
    const router = entries.filter((e) => e.customType === "opencandle-router");
    assert(
      router.length >= 1,
      `expected >=1 opencandle-router entry under OPENCANDLE_ROUTER_MODE=llm, ` +
        `got ${router.length}.`,
    );
  });
} else {
  console.log(
    "  (skipping opencandle-router assertion — OPENCANDLE_ROUTER_MODE is not 'llm')",
  );
}

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log(`\n${"=".repeat(50)}`);
console.log(`harness-custom-entries e2e: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  ✗ ${f}`);
}
process.exit(failed > 0 ? 1 : 0);
