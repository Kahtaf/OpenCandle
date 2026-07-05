/**
 * E2E spot-check for the IPC harness opencandle-* custom-entry drain.
 *
 * Task 3.4 of router-context-and-observability. Spawns `cli.ts` against
 * a live LLM, reads the emitted `trace.json`, and asserts that:
 *   - `customEntries` is present and is an array
 *   - At least one `opencandle-disclaimer` entry is present (emitted at
 *     `turn_end` on every final assistant turn)
 *   - For a workflow-dispatching prompt (portfolio builder), at least one
 *     `opencandle-workflow` entry is present
 *   - At least one `opencandle-router` entry is present (the LLM router is
 *     the only production routing path).
 *
 * Requires one of GEMINI_API_KEY / GOOGLE_API_KEY / ANTHROPIC_API_KEY /
 * OPENAI_API_KEY in the environment. Skips with a clear notice otherwise
 * (the drain logic itself is covered by the LLM-free integration test at
 * `tests/unit/harness/custom-entries.test.ts`).
 *
 * Usage: npx tsx tests/e2e/harness-custom-entries.test.ts
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type LlmChoice = { envVar: string };
const LLM_CANDIDATES: readonly LlmChoice[] = [
  { envVar: "GEMINI_API_KEY" },
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

function runHarness(prompt: string, answers: string[] = []): Trace {
  const ipcDir = mkdtempSync(join(tmpdir(), "oc-harness-customentries-"));
  const child = spawn(
    "npx",
    ["tsx", "tests/harness/cli.ts", "run", "--prompt", prompt, "--ipc", ipcDir, "--linger", "1"],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  try {
    waitForHarness(ipcDir, answers, 10 * 60 * 1000, () => ({ stdout, stderr }));
    return readTrace(ipcDir);
  } finally {
    child.kill();
    rmSync(ipcDir, { recursive: true, force: true });
  }
}

function waitForHarness(
  ipcDir: string,
  answers: string[],
  timeoutMs: number,
  childOutput: () => { stdout: string; stderr: string },
): void {
  const deadline = Date.now() + timeoutMs;
  let answerIndex = 0;
  while (Date.now() < deadline) {
    const waitMs = Math.min(30_000, Math.max(1_000, deadline - Date.now()));
    const result = spawnSync(
      "npx",
      ["tsx", "tests/harness/cli.ts", "wait", "--ipc", ipcDir, "--timeout", String(waitMs)],
      { cwd: process.cwd(), encoding: "utf-8", timeout: waitMs + 10_000 },
    );
    if (result.status === 0) return;
    if (result.status === 100) {
      const answer = answers[answerIndex++] ?? "Moderate";
      const answerResult = spawnSync(
        "npx",
        ["tsx", "tests/harness/cli.ts", "answer", "--ipc", ipcDir, "--value", answer],
        { cwd: process.cwd(), encoding: "utf-8", timeout: 30_000 },
      );
      if (answerResult.status !== 0) {
        throw new Error(
          `harness answer failed (exit ${answerResult.status}):\nstdout: ${answerResult.stdout}\nstderr: ${answerResult.stderr}`,
        );
      }
      continue;
    }
    if (result.status === 2) continue;
    const output = childOutput();
    throw new Error(
      `cli harness failed while waiting (exit ${result.status}):\nwait stdout: ${result.stdout}\nwait stderr: ${result.stderr}\nrun stdout: ${output.stdout}\nrun stderr: ${output.stderr}`,
    );
  }
  const output = childOutput();
  throw new Error(
    `cli harness timed out:\nrun stdout: ${output.stdout}\nrun stderr: ${output.stderr}`,
  );
}

function readTrace(ipcDir: string): Trace {
  const result = spawnSync("npx", ["tsx", "tests/harness/cli.ts", "trace", "--ipc", ipcDir], {
    cwd: process.cwd(),
    encoding: "utf-8",
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `harness trace failed (exit ${result.status}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout) as Trace;
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

const workflowTrace = runHarness("build me a $10k portfolio", ["Growth", "Moderate", "10000"]);

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

record("router mode emits at least one opencandle-router entry", () => {
  const entries = workflowTrace.customEntries ?? [];
  const router = entries.filter((e) => e.customType === "opencandle-router");
  assert(
    router.length >= 1,
    `expected >=1 opencandle-router entry from the LLM router, got ${router.length}.`,
  );
});

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log(`\n${"=".repeat(50)}`);
console.log(
  `harness-custom-entries e2e: ${passed} passed, ${failed} failed out of ${passed + failed}`,
);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  ✗ ${f}`);
}
process.exit(failed > 0 ? 1 : 0);
