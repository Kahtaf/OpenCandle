import type { ProductEvalReport } from "./types.js";

export function productEvalExitCode(report: Pick<ProductEvalReport, "failed">): number {
  return report.failed > 0 ? 1 : 0;
}
