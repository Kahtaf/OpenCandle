import { scoreWorkflowClassification } from "./scorers/workflow-classification.js";
import { scoreToolSelection } from "./scorers/tool-selection.js";
import { scoreToolArguments } from "./scorers/tool-arguments.js";
import { scoreDataFaithfulness } from "./scorers/data-faithfulness.js";
import { scoreRiskDisclosure } from "./scorers/risk-disclosure.js";
import type { EvalCase, EvalCaseResult, EvalTrace, LayerDetail } from "./types.js";

/**
 * Score a trace against an eval case's assertions.
 * Returns per-layer details and an aggregate score.
 */
export function scoreCase(evalCase: EvalCase, trace: EvalTrace): EvalCaseResult {
  const layers: Record<string, LayerDetail> = {};
  const scores: number[] = [];

  const { assertions } = evalCase;

  // Layer 1: Workflow classification
  if (assertions.expectedWorkflow) {
    const detail = scoreWorkflowClassification(trace, assertions.expectedWorkflow);
    layers["workflow_classification"] = detail;
    scores.push(detail.score);
  }

  // Layer 2: Tool selection
  if (assertions.requiredTools || assertions.forbiddenTools) {
    const detail = scoreToolSelection(trace, assertions.requiredTools, assertions.forbiddenTools);
    layers["tool_selection"] = detail;
    scores.push(detail.score);
  }

  // Layer 3: Tool arguments
  if (assertions.requiredArgs) {
    const detail = scoreToolArguments(trace, assertions.requiredArgs);
    layers["tool_arguments"] = detail;
    scores.push(detail.score);
  }

  // Layer 4: Data faithfulness
  if (assertions.dataFaithfulness) {
    const detail = scoreDataFaithfulness(trace);
    layers["data_faithfulness"] = detail;
    scores.push(detail.score);
  }

  // Layer 5: Risk disclosure
  if (assertions.responseContains || assertions.responseNotContains || assertions.dataFaithfulness === undefined) {
    // Only run risk disclosure if explicitly requested via responseContains/responseNotContains
    if (assertions.responseContains || assertions.responseNotContains) {
      const detail = scoreRiskDisclosure(trace, assertions.responseContains, assertions.responseNotContains);
      layers["risk_disclosure"] = detail;
      scores.push(detail.score);
    }
  }

  const aggregate = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 1.0;

  // Safety-critical: Layer 4 or 5 score of 0 on always-tier
  const safetyCriticalFailure =
    evalCase.tier === "always" &&
    ((layers["data_faithfulness"]?.score === 0) ||
     (layers["risk_disclosure"]?.score === 0));

  return {
    name: evalCase.name,
    tier: evalCase.tier,
    score: aggregate,
    layers,
    safetyCriticalFailure,
  };
}
