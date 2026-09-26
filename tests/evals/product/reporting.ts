import type { ProductEvalReport } from "./types.js";

/**
 * The report fields a completed product eval run must keep internally
 * consistent. `results` carries the per-case completed outcomes (`passed`,
 * `mandatoryFailure`) and identities, and the summary counts must agree with it.
 */
export type ProductEvalExitInput = Pick<
  ProductEvalReport,
  "caseCount" | "passed" | "failed" | "results"
>;

export function productEvalExitCode(report: ProductEvalExitInput): number {
  const results = Array.isArray(report.results) ? report.results : [];
  const ids = results.map((result) => (typeof result?.id === "string" ? result.id.trim() : ""));
  const completed = results.every(
    (result) =>
      typeof result?.id === "string" &&
      typeof result?.passed === "boolean" &&
      typeof result?.mandatoryFailure === "boolean",
  );
  const passedCount = results.filter((result) => result.passed === true).length;
  const failedCount = results.filter((result) => result.passed === false).length;
  const hasEmptyId = ids.some((id) => id.length === 0);
  const hasDuplicateId = new Set(ids).size !== ids.length;
  // A mandatory dimension failure is a case failure even if a caller left the
  // convenience `passed` flag at `true`; never let a false green through.
  const hasMandatoryFailure = results.some((result) => result.mandatoryFailure === true);

  const consistent =
    Number.isInteger(report.caseCount) &&
    report.caseCount > 0 &&
    results.length === report.caseCount &&
    completed &&
    !hasEmptyId &&
    !hasDuplicateId &&
    !hasMandatoryFailure &&
    report.passed === passedCount &&
    report.failed === failedCount &&
    report.passed + report.failed === report.caseCount;

  return consistent && report.failed === 0 ? 0 : 1;
}
