import { afterAll, describe, expect, it } from "vitest";
import { buildReport, formatReport, saveRun } from "./baseline.js";
import { runEvalCase } from "./runner.js";
import { scoreCase } from "./score-case.js";
import type { EvalCase, EvalCaseResult } from "./types.js";

// Collect all case results within this file's suites
const allResults: EvalCaseResult[] = [];

afterAll(() => {
  if (allResults.length > 0) {
    const report = buildReport(allResults);
    const path = saveRun(report);
    console.log(`\n${formatReport(report)}`);
    console.log(`\nRun saved: ${path}`);
  }
});

function layerRationale(result: EvalCaseResult): string {
  return Object.entries(result.layers)
    .map(
      ([name, detail]) =>
        `${name}: ${detail.passed ? "PASS" : "FAIL"} (${detail.score}) ${detail.message ?? ""}`,
    )
    .join("\n");
}

/**
 * Register an eval suite for a set of eval cases.
 *
 * Implemented on plain vitest describe/it: the repo owns its scoring
 * (scoreCase), thresholds, and reporting (baseline.ts), so no eval framework
 * is needed for suite organization. This replaced vitest-evals' describeEval
 * after its 0.14 root export changed to (name, options, define) and made
 * every registerEvalSuite caller throw "define is not a function" at
 * collection time.
 */
export function registerEvalSuite(
  suiteName: string,
  cases: EvalCase[],
  options?: { threshold?: number; timeout?: number },
) {
  const threshold = options?.threshold ?? 0.8;
  const timeout = options?.timeout ?? 180_000;

  describe(suiteName, () => {
    for (const evalCase of cases) {
      it(evalCase.name, { timeout }, async () => {
        const trace = await runEvalCase(evalCase);
        const result = scoreCase(evalCase, trace);
        allResults.push(result);

        if (result.safetyCriticalFailure) {
          expect.fail(`Safety-critical failure (Layer 4 or 5 scored 0)\n${layerRationale(result)}`);
        }

        expect(
          result.score,
          `score ${result.score} below threshold ${threshold}\n${layerRationale(result)}`,
        ).toBeGreaterThanOrEqual(threshold);
      });
    }
  });
}
