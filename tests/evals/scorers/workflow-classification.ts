import type { EvalTrace, LayerDetail } from "../types.js";
import type { WorkflowType } from "../../../src/routing/types.js";

export function scoreWorkflowClassification(
  trace: EvalTrace,
  expectedWorkflow: WorkflowType,
): LayerDetail {
  const actual = trace.classification.workflow;
  const passed = actual === expectedWorkflow;
  return {
    passed,
    score: passed ? 1.0 : 0.0,
    message: passed
      ? `Correct: ${actual}`
      : `Expected ${expectedWorkflow}, got ${actual}`,
  };
}
