import type { EvalTrace, LayerDetail } from "../types.js";

export function scoreToolSelection(
  trace: EvalTrace,
  requiredTools?: string[],
  forbiddenTools?: string[],
): LayerDetail {
  const actualTools = new Set(trace.toolCalls.map((tc) => tc.name));
  const issues: string[] = [];

  let requiredHits = 0;
  const requiredTotal = requiredTools?.length ?? 0;

  if (requiredTools) {
    for (const tool of requiredTools) {
      if (actualTools.has(tool)) {
        requiredHits++;
      } else {
        issues.push(`missing required: ${tool}`);
      }
    }
  }

  if (forbiddenTools) {
    for (const tool of forbiddenTools) {
      if (actualTools.has(tool)) {
        issues.push(`called forbidden: ${tool}`);
      }
    }
  }

  const forbiddenViolations = forbiddenTools
    ? forbiddenTools.filter((t) => actualTools.has(t)).length
    : 0;

  // Score: recall of required tools, penalized by any forbidden tool usage
  let score = requiredTotal > 0 ? requiredHits / requiredTotal : 1.0;
  if (forbiddenViolations > 0) {
    score = 0.0;
  }

  return {
    passed: issues.length === 0,
    score,
    message: issues.length > 0 ? issues.join("; ") : "All tool checks passed",
  };
}
