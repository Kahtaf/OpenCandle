#!/usr/bin/env tsx
/**
 * TUI-harness e2e for the DCF tool: drives a natural DCF prompt through
 * `tests/harness/cli.ts` against a live LLM and asserts that:
 *   - the trace shows a `compute_dcf` tool call
 *   - the final answer reports an intrinsic value with its assumptions
 *
 * Requires a live LLM credential plus ALPHA_VANTAGE_API_KEY. The DCF tool
 * prefers Alpha Vantage statements and falls back to Yahoo Finance statements.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LLM_ENV_VARS = ["GOOGLE_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"];
const hasLlm = LLM_ENV_VARS.some((name) => !!process.env[name]);
if (!hasLlm) {
  console.log(
    `Skipping harness-dcf e2e: no LLM credential in env (need one of ${LLM_ENV_VARS.join(", ")}).`,
  );
  process.exit(0);
}
if (!process.env.ALPHA_VANTAGE_API_KEY) {
  console.log("Skipping harness-dcf e2e: ALPHA_VANTAGE_API_KEY not set (compute_dcf needs it).");
  process.exit(0);
}

interface Trace {
  prompt: string;
  toolSequence: string[];
  finalText: string;
}

function runHarness(prompt: string): Trace {
  const ipcDir = mkdtempSync(join(tmpdir(), "oc-harness-dcf-"));
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
    waitForHarness(ipcDir, [], 10 * 60 * 1000, () => ({ stdout, stderr }));
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
      const answer = answers[answerIndex++];
      if (answer === undefined) {
        throw new Error(`harness asked a question with no scripted answer: ${result.stdout}`);
      }
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

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

console.log("harness-dcf e2e: running 'Run a DCF on AAPL and tell me the intrinsic value'...");
const trace = runHarness("Run a DCF on AAPL and tell me the intrinsic value");

assert(
  trace.toolSequence.includes("compute_dcf"),
  `expected a compute_dcf tool call in the trace, got: ${trace.toolSequence.join(", ") || "(none)"}`,
);

const text = trace.finalText.toLowerCase();
const reportsValue = /intrinsic value/.test(text) && /\$\s?\d/.test(trace.finalText);
assert(
  reportsValue,
  `expected an intrinsic value with assumptions; got: ${trace.finalText.slice(0, 400)}`,
);

console.log("  ✓ compute_dcf called; final answer reports intrinsic value");
console.log("harness-dcf e2e passed.");
