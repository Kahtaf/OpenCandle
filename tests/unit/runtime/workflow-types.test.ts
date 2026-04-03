import { describe, it, expect } from "vitest";
import {
  isValidStepTransition,
  transitionStepStatus,
  createWorkflowRun,
} from "../../../src/runtime/workflow-types.js";

describe("isValidStepTransition", () => {
  it("allows pending → running", () => {
    expect(isValidStepTransition("pending", "running")).toBe(true);
  });

  it("allows pending → skipped", () => {
    expect(isValidStepTransition("pending", "skipped")).toBe(true);
  });

  it("allows running → completed", () => {
    expect(isValidStepTransition("running", "completed")).toBe(true);
  });

  it("allows running → failed", () => {
    expect(isValidStepTransition("running", "failed")).toBe(true);
  });

  it("allows running → skipped", () => {
    expect(isValidStepTransition("running", "skipped")).toBe(true);
  });

  it("rejects completed → running", () => {
    expect(isValidStepTransition("completed", "running")).toBe(false);
  });

  it("rejects failed → running", () => {
    expect(isValidStepTransition("failed", "running")).toBe(false);
  });

  it("rejects skipped → running", () => {
    expect(isValidStepTransition("skipped", "running")).toBe(false);
  });

  it("rejects pending → completed (must go through running)", () => {
    expect(isValidStepTransition("pending", "completed")).toBe(false);
  });
});

describe("transitionStepStatus", () => {
  it("returns new status on valid transition", () => {
    expect(transitionStepStatus("pending", "running")).toBe("running");
    expect(transitionStepStatus("running", "completed")).toBe("completed");
  });

  it("throws on invalid transition", () => {
    expect(() => transitionStepStatus("completed", "running")).toThrow(
      "Invalid step transition: completed → running",
    );
  });
});

describe("createWorkflowRun", () => {
  it("creates a run with all steps in pending state", () => {
    const run = createWorkflowRun("run-1", "portfolio_builder", [
      {
        stepType: "fetch_data",
        description: "Fetch market data",
        requiredInputs: ["symbols"],
        expectedOutputs: ["quotes"],
        skippable: false,
      },
      {
        stepType: "rank",
        description: "Rank candidates",
        requiredInputs: ["quotes"],
        expectedOutputs: ["rankings"],
        skippable: false,
      },
    ]);

    expect(run.runId).toBe("run-1");
    expect(run.workflowType).toBe("portfolio_builder");
    expect(run.steps).toHaveLength(2);
    expect(run.steps[0].status).toBe("pending");
    expect(run.steps[1].status).toBe("pending");
    expect(run.currentStepIndex).toBe(0);
    expect(run.status).toBe("pending");
    expect(run.stepOutputs.size).toBe(0);
  });

  it("assigns unique run IDs", () => {
    const run1 = createWorkflowRun("run-a", "portfolio_builder", []);
    const run2 = createWorkflowRun("run-b", "portfolio_builder", []);
    expect(run1.runId).not.toBe(run2.runId);
  });
});
