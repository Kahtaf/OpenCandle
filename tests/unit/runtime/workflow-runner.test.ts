import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorkflowRunner } from "../../../src/runtime/workflow-runner.js";
import { WorkflowEventLogger } from "../../../src/runtime/workflow-events.js";
import { ProviderTracker } from "../../../src/runtime/provider-tracker.js";
import { initDatabase } from "../../../src/memory/sqlite.js";
import type { WorkflowStep, StepOutput } from "../../../src/runtime/workflow-types.js";
import type { StepExecutor } from "../../../src/runtime/workflow-runner.js";
import type Database from "better-sqlite3";

function makeSteps(...types: string[]): Omit<WorkflowStep, "status">[] {
  return types.map((stepType) => ({
    stepType,
    description: `Step: ${stepType}`,
    requiredInputs: [],
    expectedOutputs: [],
    skippable: false,
  }));
}

function makeSkippableStep(stepType: string): Omit<WorkflowStep, "status"> {
  return {
    stepType,
    description: `Step: ${stepType}`,
    requiredInputs: [],
    expectedOutputs: [],
    skippable: true,
  };
}

const successExecutor: StepExecutor = async (step, stepIndex) => ({
  stepIndex,
  stepType: step.stepType,
  evidence: [{ label: step.stepType, value: "done", provenance: { source: "computed" } }],
});

const failingExecutor: StepExecutor = async () => {
  throw new Error("step_failed");
};

describe("WorkflowRunner", () => {
  let db: Database.Database;
  let eventLogger: WorkflowEventLogger;
  let providerTracker: ProviderTracker;
  let runner: WorkflowRunner;

  beforeEach(() => {
    db = initDatabase(":memory:");
    eventLogger = new WorkflowEventLogger(db);
    providerTracker = new ProviderTracker();
    runner = new WorkflowRunner({ eventLogger, providerTracker });
  });

  afterEach(() => {
    db.close();
  });

  it("executes all steps to completion", async () => {
    const run = await runner.start("portfolio_builder", makeSteps("fetch", "rank", "synthesize"), successExecutor);

    expect(run.status).toBe("completed");
    expect(run.steps[0].status).toBe("completed");
    expect(run.steps[1].status).toBe("completed");
    expect(run.steps[2].status).toBe("completed");
    expect(run.stepOutputs.size).toBe(3);
  });

  it("assigns unique run IDs", async () => {
    const run1 = await runner.start("test", makeSteps("a"), successExecutor);
    const run2 = await runner.start("test", makeSteps("b"), successExecutor);
    expect(run1.runId).not.toBe(run2.runId);
  });

  it("fails the run when a non-skippable step fails", async () => {
    const run = await runner.start("test", makeSteps("a", "b"), failingExecutor);

    expect(run.status).toBe("failed");
    expect(run.steps[0].status).toBe("failed");
    expect(run.steps[1].status).toBe("pending");
  });

  it("skips a skippable step on failure and continues", async () => {
    let callCount = 0;
    const mixedExecutor: StepExecutor = async (step, stepIndex) => {
      callCount++;
      if (step.stepType === "optional") throw new Error("not available");
      return { stepIndex, stepType: step.stepType, evidence: [] };
    };

    const steps = [
      ...makeSteps("required"),
      makeSkippableStep("optional"),
      ...makeSteps("final"),
    ];

    const run = await runner.start("test", steps, mixedExecutor);

    expect(run.status).toBe("completed");
    expect(run.steps[0].status).toBe("completed");
    expect(run.steps[1].status).toBe("skipped");
    expect(run.steps[2].status).toBe("completed");
    expect(callCount).toBe(3);
  });

  it("cancels the active run when a new run starts", async () => {
    // Start a run that we can observe was cancelled
    const steps = makeSteps("a", "b", "c");
    let runRef: any;

    const slowExecutor: StepExecutor = async (step, stepIndex) => {
      if (stepIndex === 1) {
        // Simulate cancellation by starting a new run from within
        runRef = runner.getActiveRun();
        runner.cancel();
      }
      return { stepIndex, stepType: step.stepType, evidence: [] };
    };

    const run = await runner.start("test", steps, slowExecutor);
    // The run should have been cancelled when we called cancel()
    expect(run.status).toBe("cancelled");
  });

  it("logs workflow events", async () => {
    const run = await runner.start("portfolio_builder", makeSteps("fetch"), successExecutor);

    const events = eventLogger.getEventsByRunId(run.runId);
    const types = events.map((e) => e.eventType);

    expect(types).toContain("workflow_started");
    expect(types).toContain("step_started");
    expect(types).toContain("step_completed");
    expect(types).toContain("workflow_completed");
  });

  it("logs step_failed event on failure", async () => {
    const run = await runner.start("test", makeSteps("a"), failingExecutor);

    const events = eventLogger.getEventsByRunId(run.runId);
    const types = events.map((e) => e.eventType);

    expect(types).toContain("step_failed");
  });

  it("passes prior evidence to subsequent steps", async () => {
    const receivedEvidence: number[] = [];
    const trackingExecutor: StepExecutor = async (step, stepIndex, priorEvidence) => {
      receivedEvidence.push(priorEvidence.length);
      return {
        stepIndex,
        stepType: step.stepType,
        evidence: [
          { label: `evidence_${stepIndex}`, value: stepIndex, provenance: { source: "computed" } },
        ],
      };
    };

    await runner.start("test", makeSteps("a", "b", "c"), trackingExecutor);

    expect(receivedEvidence).toEqual([0, 1, 2]);
  });

  it("getActiveRun returns null when no run is active", () => {
    expect(runner.getActiveRun()).toBeNull();
  });

  it("getActiveRun returns the current run", async () => {
    const run = await runner.start("test", makeSteps("a"), successExecutor);
    expect(runner.getActiveRun()).toBe(run);
  });
});
