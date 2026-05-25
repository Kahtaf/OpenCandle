import { describe, expect, it } from "vitest";
import {
  ARTIFACT_CONTRACT_REGISTRY,
  validateArtifactContractRegistry,
} from "../../../src/runtime/artifact-contracts.js";

describe("artifact contract registry", () => {
  it("defines supported trace-only answer artifact contracts", () => {
    expect(Object.keys(ARTIFACT_CONTRACT_REGISTRY).sort()).toEqual([
      "concept_example_table",
      "portfolio_exposure_map",
      "rebalance_action_plan",
      "source_coverage_table",
    ]);
    expect(ARTIFACT_CONTRACT_REGISTRY.concept_example_table.status).toBe("trace_only");
    expect(ARTIFACT_CONTRACT_REGISTRY.rebalance_action_plan.status).toBe("trace_only");
    expect(validateArtifactContractRegistry()).toEqual([]);
  });
});
