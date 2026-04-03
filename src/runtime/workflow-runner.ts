import type { WorkflowRun, StepOutput, WorkflowStep } from "./workflow-types.js";
import {
  createWorkflowRun,
  transitionStepStatus,
} from "./workflow-types.js";
import type { WorkflowEventLogger } from "./workflow-events.js";
import type { ProviderTracker } from "./provider-tracker.js";
import type { EvidenceRecord } from "./evidence.js";

/** Function that executes a single workflow step. */
export type StepExecutor = (
  step: WorkflowStep,
  stepIndex: number,
  priorEvidence: EvidenceRecord[],
  context: StepExecutionContext,
) => Promise<StepOutput>;

/** Context passed to step executors. */
export interface StepExecutionContext {
  runId: string;
  providerTracker: ProviderTracker;
}

/** Options for creating a WorkflowRunner. */
export interface WorkflowRunnerOptions {
  eventLogger?: WorkflowEventLogger;
  providerTracker?: ProviderTracker;
}

let runCounter = 0;

function generateRunId(): string {
  runCounter += 1;
  return `run_${Date.now()}_${runCounter}`;
}

/**
 * Typed workflow execution engine with run IDs, step definitions,
 * state transitions, cancellation, and event logging.
 */
export class WorkflowRunner {
  private readonly eventLogger?: WorkflowEventLogger;
  private readonly providerTracker?: ProviderTracker;
  private activeRun: WorkflowRun | null = null;

  constructor(options: WorkflowRunnerOptions = {}) {
    this.eventLogger = options.eventLogger;
    this.providerTracker = options.providerTracker;
  }

  /** Get the currently active run, if any. */
  getActiveRun(): WorkflowRun | null {
    return this.activeRun;
  }

  /**
   * Start a new workflow run. If a run is already active, it is cancelled first.
   */
  async start(
    workflowType: string,
    stepDefinitions: Omit<WorkflowStep, "status">[],
    executor: StepExecutor,
  ): Promise<WorkflowRun> {
    // Cancel any active run
    if (this.activeRun && this.activeRun.status === "running") {
      this.cancel();
    }

    const runId = generateRunId();
    const run = createWorkflowRun(runId, workflowType, stepDefinitions);
    this.activeRun = run;
    run.status = "running";

    this.providerTracker?.resetAll();

    this.logEvent(runId, 0, "workflow_started", {
      workflowType,
      stepCount: stepDefinitions.length,
    });

    // Execute steps
    await this.executeSteps(run, executor);

    return run;
  }

  /** Cancel the active run. */
  cancel(): void {
    const run = this.activeRun;
    if (!run || run.status !== "running") return;

    for (let i = run.currentStepIndex; i < run.steps.length; i++) {
      const step = run.steps[i];
      if (step.status === "pending" || step.status === "running") {
        step.status = transitionStepStatus(step.status, "skipped");
        this.logEvent(run.runId, i, "step_skipped", {
          stepType: step.stepType,
          reason: "cancelled",
        });
      }
    }

    run.status = "cancelled";
    this.logEvent(run.runId, run.currentStepIndex, "workflow_cancelled", {
      cancelledAtStep: run.currentStepIndex,
    });
  }

  private async executeSteps(
    run: WorkflowRun,
    executor: StepExecutor,
  ): Promise<void> {
    for (let i = 0; i < run.steps.length; i++) {
      // Check if run was cancelled externally
      if (run.status !== "running") return;

      const step = run.steps[i];
      run.currentStepIndex = i;

      // Collect all prior evidence
      const priorEvidence: EvidenceRecord[] = [];
      for (const [, output] of run.stepOutputs) {
        priorEvidence.push(...output.evidence);
      }

      // Transition to running
      step.status = transitionStepStatus(step.status, "running");
      this.logEvent(run.runId, i, "step_started", { stepType: step.stepType });

      try {
        const context: StepExecutionContext = {
          runId: run.runId,
          providerTracker: this.providerTracker!,
        };

        const output = await executor(step, i, priorEvidence, context);

        // If run was cancelled during execution, stop without further transitions
        if (run.status !== "running") return;

        step.status = transitionStepStatus(step.status, "completed");
        run.stepOutputs.set(i, output);

        this.logEvent(run.runId, i, "step_completed", {
          stepType: step.stepType,
          evidenceCount: output.evidence.length,
        });
      } catch (error) {
        // If run was cancelled during execution, stop without further transitions
        if (run.status !== "running") return;

        const message = error instanceof Error ? error.message : "unknown_error";

        if (step.skippable) {
          step.status = transitionStepStatus(step.status, "skipped");
          this.logEvent(run.runId, i, "step_skipped", {
            stepType: step.stepType,
            reason: message,
          });
        } else {
          step.status = transitionStepStatus(step.status, "failed");
          this.logEvent(run.runId, i, "step_failed", {
            stepType: step.stepType,
            error: message,
          });
          run.status = "failed";
          return;
        }
      }
    }

    if (run.status === "running") {
      run.status = "completed";
      this.logEvent(run.runId, run.steps.length - 1, "workflow_completed", {
        workflowType: run.workflowType,
      });
    }
  }

  private logEvent(
    runId: string,
    stepIndex: number,
    eventType: string,
    payload: Record<string, unknown>,
  ): void {
    this.eventLogger?.log(runId, stepIndex, eventType as any, payload);
  }
}
