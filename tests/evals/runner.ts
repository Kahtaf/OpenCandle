import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvalCase, EvalTrace } from "./types.js";

/**
 * Runs an eval case through the test harness and returns the trace.
 * Spawns manual-run.ts as a subprocess with scripted answers.
 */
export function runEvalCase(evalCase: EvalCase): EvalTrace {
  const ipcDir = mkdtempSync(join(tmpdir(), "oc-eval-"));
  mkdirSync(ipcDir, { recursive: true });

  try {
    const args = [
      "tests/harness/manual-run.ts",
      ipcDir,
      evalCase.prompt,
    ];
    if (evalCase.answers && evalCase.answers.length > 0) {
      args.push(JSON.stringify(evalCase.answers));
    }

    execFileSync("npx", ["tsx", ...args], {
      cwd: process.cwd(),
      timeout: 600_000,
      stdio: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });

    const traceRaw = readFileSync(join(ipcDir, "trace.json"), "utf-8");
    return JSON.parse(traceRaw) as EvalTrace;
  } finally {
    rmSync(ipcDir, { recursive: true, force: true });
  }
}
