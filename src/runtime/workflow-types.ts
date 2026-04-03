import type { EvidenceRecord } from "./evidence.js";

/** Status of a single workflow step. */
export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/** Overall status of a workflow run. */
export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/** Valid step status transitions. */
const VALID_STEP_TRANSITIONS: Record<StepStatus, StepStatus[]> = {
  pending: ["running", "skipped"],
  running: ["completed", "failed", "skipped"],
  completed: [],
  failed: [],
  skipped: [],
};

/** Check whether a step status transition is valid. */
export function isValidStepTransition(from: StepStatus, to: StepStatus): boolean {
  return VALID_STEP_TRANSITIONS[from].includes(to);
}

/** Transition a step status, throwing on invalid transitions. */
export function transitionStepStatus(from: StepStatus, to: StepStatus): StepStatus {
  if (!isValidStepTransition(from, to)) {
    throw new Error(`Invalid step transition: ${from} → ${to}`);
  }
  return to;
}

/** Definition of a single workflow step. */
export interface WorkflowStep {
  stepType: string;
  description: string;
  requiredInputs: string[];
  expectedOutputs: string[];
  skippable: boolean;
  status: StepStatus;
}

/** Output produced by a completed workflow step. */
export interface StepOutput {
  stepIndex: number;
  stepType: string;
  evidence: EvidenceRecord[];
  rawText?: string;
}

/** Analyst signal direction. */
export type AnalystSignal = "BUY" | "HOLD" | "SELL";

/** Structured output from a single analyst role. */
export interface AnalystOutput {
  role: string;
  signal: AnalystSignal;
  conviction: number;
  thesis: string;
  evidence: EvidenceRecord[];
  rawText?: string;
}

/** A complete workflow run definition and state. */
export interface WorkflowRun {
  runId: string;
  workflowType: string;
  steps: WorkflowStep[];
  currentStepIndex: number;
  status: RunStatus;
  stepOutputs: Map<number, StepOutput>;
  createdAt: string;
}

/** Create a new workflow run with all steps in pending state. */
export function createWorkflowRun(
  runId: string,
  workflowType: string,
  stepDefinitions: Omit<WorkflowStep, "status">[],
): WorkflowRun {
  return {
    runId,
    workflowType,
    steps: stepDefinitions.map((def) => ({ ...def, status: "pending" as const })),
    currentStepIndex: 0,
    status: "pending",
    stepOutputs: new Map(),
    createdAt: new Date().toISOString(),
  };
}
