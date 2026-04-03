#!/usr/bin/env tsx
/**
 * Eval CLI — run evals and optionally update baseline.
 *
 * Usage:
 *   npx tsx tests/evals/cli.ts                    # run evals, report only
 *   npx tsx tests/evals/cli.ts --update-baseline  # run evals, then update baseline
 */
import { execSync } from "node:child_process";
import { saveBaseline, loadBaseline, buildReport, formatReport } from "./baseline.js";
import { scoreCase } from "./score-case.js";
import { runEvalCase } from "./runner.js";
import type { EvalCase, EvalCaseResult } from "./types.js";

// Import all eval case modules — dynamically collect cases
const caseModules = import.meta.glob("./cases/*.eval.ts", { eager: true });

async function main() {
  const updateBaseline = process.argv.includes("--update-baseline");

  console.log("Running OpenCandle evals...\n");

  // For now, run via vitest to get the eval reporter output
  try {
    execSync("npx vitest run --config vitest.config.evals.ts --reporter=verbose", {
      cwd: process.cwd(),
      stdio: "inherit",
      timeout: 600_000,
    });
  } catch {
    console.log("\nSome evals failed (see above).\n");
  }

  if (updateBaseline) {
    console.log("\n--update-baseline flag detected.");
    console.log("Note: Baseline update requires a separate scoring run.");
    console.log("Use `npm run test:evals` first, then manually update baseline.json.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
