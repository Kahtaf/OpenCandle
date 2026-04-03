import { afterAll } from "vitest";
import { describeEval } from "vitest-evals";
import type { ScoreFn } from "vitest-evals";
import { buildReport, formatReport, saveRun } from "./baseline.js";
import { runEvalCase } from "./runner.js";
import { scoreCase } from "./score-case.js";
import type { EvalCase, EvalCaseResult, EvalTrace } from "./types.js";

// Shared trace cache — task stores, scorer retrieves
const traceCache = new Map<string, { evalCase: EvalCase; trace: EvalTrace }>();

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

/**
 * Create a custom scorer that runs all deterministic layers against the cached trace.
 */
function openCandleScorer(): ScoreFn {
  return ({ input }) => {
    const cached = traceCache.get(input);
    if (!cached) {
      return { score: 0, metadata: { rationale: "No trace found for input" } };
    }

    const result = scoreCase(cached.evalCase, cached.trace);
    allResults.push(result);

    if (result.safetyCriticalFailure) {
      return {
        score: 0,
        metadata: {
          rationale: "Safety-critical failure (Layer 4 or 5 scored 0)",
          layers: result.layers,
        },
      };
    }

    return {
      score: result.score,
      metadata: {
        rationale: Object.entries(result.layers)
          .map(([name, detail]) => `${name}: ${detail.passed ? "PASS" : "FAIL"} (${detail.score}) ${detail.message ?? ""}`)
          .join("\n"),
        layers: result.layers,
      },
    };
  };
}

/**
 * Register an eval suite for a set of eval cases.
 * Uses vitest-evals' describeEval for test organization and reporting.
 */
export function registerEvalSuite(
  suiteName: string,
  cases: EvalCase[],
  options?: { threshold?: number; timeout?: number },
) {
  describeEval(suiteName, {
    data: async () =>
      cases.map((c) => ({
        input: c.prompt,
        name: c.name,
        _evalCase: c,
      })),
    task: async (input: string) => {
      const evalCase = cases.find((c) => c.prompt === input);
      if (!evalCase) throw new Error(`No eval case found for prompt: ${input}`);

      const trace = runEvalCase(evalCase);
      traceCache.set(input, { evalCase, trace });

      return {
        result: trace.text,
        toolCalls: trace.toolCalls.map((tc) => ({
          name: tc.name,
          arguments: tc.args as Record<string, unknown>,
        })),
      };
    },
    scorers: [openCandleScorer()],
    threshold: options?.threshold ?? 0.8,
    timeout: options?.timeout ?? 180_000,
  });
}
