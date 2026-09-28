import { type CompletionReportCase, sessionFailureReason } from "../completion-report.js";
import type { ProductEvalCase, ProductEvalCaseResult } from "./types.js";

export interface ProductCasesRun {
  results: ProductEvalCaseResult[];
  completionCases: CompletionReportCase[];
}

/**
 * Runs every product eval case in order. A case whose session throws is
 * recorded as a failed, zero-score result and the loop moves on, so one broken
 * case still yields a full report and completion report instead of none.
 */
export async function runProductCases(
  cases: readonly ProductEvalCase[],
  runCase: (evalCase: ProductEvalCase) => Promise<ProductEvalCaseResult>,
): Promise<ProductCasesRun> {
  const results: ProductEvalCaseResult[] = [];
  const completionCases: CompletionReportCase[] = [];
  for (const evalCase of cases) {
    let result: ProductEvalCaseResult;
    try {
      result = await runCase(evalCase);
    } catch (error) {
      console.error(`case ${evalCase.id} errored:`, error);
      const reason = sessionFailureReason(error);
      results.push(sessionFailureResult(evalCase, reason));
      completionCases.push({ id: evalCase.id, status: "failed", reason });
      continue;
    }
    results.push(result);
    completionCases.push(
      result.passed && !result.mandatoryFailure
        ? { id: result.id, status: "passed" }
        : { id: result.id, status: "failed", reason: productEvalFailureReason(result) },
    );
  }
  return { results, completionCases };
}

function sessionFailureResult(evalCase: ProductEvalCase, reason: string): ProductEvalCaseResult {
  return {
    id: evalCase.id,
    family: evalCase.family,
    prompt: evalCase.prompt,
    score: 0,
    passed: false,
    mandatoryFailure: true,
    dimensions: [
      {
        id: "session_completed",
        description: "The OpenCandle session completed with a final answer.",
        passed: false,
        score: 0,
        weight: 1,
        mandatory: true,
        message: reason,
      },
    ],
  };
}

function productEvalFailureReason(result: ProductEvalCaseResult): string {
  const failedDimensions = result.dimensions.filter((dimension) => !dimension.passed);
  const reason =
    failedDimensions.length > 0
      ? failedDimensions.map((dimension) => `${dimension.id}: ${dimension.message}`).join("; ")
      : result.mandatoryFailure
        ? "mandatory dimension failed"
        : "score below pass threshold";
  return reason.length > 900 ? `${reason.slice(0, 899)}…` : reason;
}
