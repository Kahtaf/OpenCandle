#!/usr/bin/env tsx
/**
 * TUI-harness e2e for the DCF tool: drives a natural DCF prompt through
 * `tests/harness/manual-run.ts` against a live LLM and asserts that:
 *   - the trace shows a `compute_dcf` tool call
 *   - the final answer reports an intrinsic value with its assumptions OR an
 *     explicit refusal naming the missing input (never a fabricated
 *     per-share value)
 *
 * Requires a live LLM credential plus ALPHA_VANTAGE_API_KEY (compute_dcf
 * reads statements from Alpha Vantage). Skips with a notice otherwise.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  toolCalls: Array<{ name: string; args: unknown; result?: unknown }>;
  text?: string;
}

function runHarness(prompt: string): Trace {
  const ipcDir = mkdtempSync(join(tmpdir(), "oc-harness-dcf-"));
  try {
    const result = spawnSync("npx", ["tsx", "tests/harness/manual-run.ts", ipcDir, prompt], {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 10 * 60 * 1000,
    });
    if (result.status !== 0) {
      throw new Error(
        `manual-run failed (exit ${result.status}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    }
    return JSON.parse(readFileSync(join(ipcDir, "trace.json"), "utf-8")) as Trace;
  } finally {
    rmSync(ipcDir, { recursive: true, force: true });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

console.log("harness-dcf e2e: running 'Run a DCF on AAPL and tell me the intrinsic value'...");
const trace = runHarness("Run a DCF on AAPL and tell me the intrinsic value");

const toolNames = trace.toolCalls.map((call) => call.name);
assert(
  toolNames.includes("compute_dcf"),
  `expected a compute_dcf tool call in the trace, got: ${toolNames.join(", ") || "(none)"}`,
);

const text = (trace.text ?? "").toLowerCase();
const reportsValue = /intrinsic value/.test(text) && /\$\s?\d/.test(trace.text ?? "");
const explicitRefusal =
  /cannot compute|unavailable|shares outstanding|missing/.test(text) && text.length > 40;
assert(
  reportsValue || explicitRefusal,
  `expected an intrinsic value with assumptions or an explicit refusal naming the missing input; got: ${trace.text?.slice(0, 400)}`,
);

console.log(`  ✓ compute_dcf called; final answer ${reportsValue ? "reports intrinsic value" : "refuses explicitly"}`);
console.log("harness-dcf e2e passed.");
