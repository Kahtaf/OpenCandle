import type { PolicyCardId, TaskFamily } from "../routing/planning.js";

export type ArtifactContractId =
  | "concept_example_table"
  | "portfolio_exposure_map"
  | "rebalance_action_plan"
  | "source_coverage_table";

export interface ArtifactContractDefinition {
  id: ArtifactContractId;
  taskFamilies: TaskFamily[];
  description: string;
  status: "trace_only";
}

export const ARTIFACT_CONTRACT_REGISTRY: Record<ArtifactContractId, ArtifactContractDefinition> = {
  concept_example_table: {
    id: "concept_example_table",
    taskFamilies: ["concept_explainer"],
    description: "Compact examples, cross-checks, or comparison rows for educational answers.",
    status: "trace_only",
  },
  portfolio_exposure_map: {
    id: "portfolio_exposure_map",
    taskFamilies: ["portfolio_review"],
    description: "Structural exposure map for portfolio review and rebalance prompts.",
    status: "trace_only",
  },
  rebalance_action_plan: {
    id: "rebalance_action_plan",
    taskFamilies: ["portfolio_review"],
    description: "Staged rebalance action plan with target ranges and execution caveats.",
    status: "trace_only",
  },
  source_coverage_table: {
    id: "source_coverage_table",
    taskFamilies: ["sentiment_snapshot", "filing_thesis_review", "current_event_explanation"],
    description: "Source and provider-gap coverage table for source-heavy answers.",
    status: "trace_only",
  },
};

export function artifactContractIdsForPlanning(input: {
  taskFamily: TaskFamily;
  policyCardId: PolicyCardId;
}): ArtifactContractId[] {
  if (
    input.policyCardId === "concept_options_education" ||
    input.policyCardId === "concept_inflation_cash_education" ||
    input.policyCardId === "concept_valuation_metric_education"
  ) {
    return ["concept_example_table"];
  }
  if (input.policyCardId === "portfolio_rebalance_review") {
    return ["portfolio_exposure_map", "rebalance_action_plan"];
  }
  if (
    input.taskFamily === "sentiment_snapshot" ||
    input.taskFamily === "filing_thesis_review" ||
    input.taskFamily === "current_event_explanation"
  ) {
    return ["source_coverage_table"];
  }
  return [];
}

export function validateArtifactContractRegistry(): string[] {
  const errors: string[] = [];
  for (const [id, contract] of Object.entries(ARTIFACT_CONTRACT_REGISTRY)) {
    if (contract.id !== id) errors.push(`${id} key must match contract id`);
    if (contract.status !== "trace_only") errors.push(`${id} must remain trace-only in V1`);
    if (contract.taskFamilies.length === 0)
      errors.push(`${id} must declare at least one task family`);
    if (!contract.description.trim()) errors.push(`${id} must include a description`);
  }
  return errors;
}
