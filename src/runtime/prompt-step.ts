import type { WorkflowStep, StepOutput } from "./workflow-types.js";

/**
 * A workflow step definition that carries its prompt text.
 * In Pi's model, each step is a prompt sent to the LLM.
 */
export interface PromptStep extends Omit<WorkflowStep, "status"> {
  prompt: string;
}

/**
 * A complete workflow definition: typed step metadata + prompt text for each step.
 * Replaces the old WorkflowPlan { initialPrompt, followUps }.
 */
export interface WorkflowDefinition {
  workflowType: string;
  steps: PromptStep[];
}

/**
 * Create a prompt-based step definition.
 */
export function promptStep(
  stepType: string,
  description: string,
  prompt: string,
  options: {
    skippable?: boolean;
    requiredInputs?: string[];
    expectedOutputs?: string[];
  } = {},
): PromptStep {
  return {
    stepType,
    description,
    prompt,
    skippable: options.skippable ?? false,
    requiredInputs: options.requiredInputs ?? [],
    expectedOutputs: options.expectedOutputs ?? [],
  };
}

/**
 * Create a StepOutput for a prompt-based step (no structured evidence yet).
 * Evidence will be captured separately via tool call hooks.
 */
export function promptStepOutput(stepIndex: number, stepType: string): StepOutput {
  return {
    stepIndex,
    stepType,
    evidence: [],
  };
}

/**
 * Extract just the WorkflowStep metadata from PromptStep definitions
 * (dropping the prompt field) for passing to WorkflowRunner.
 */
export function toStepDefinitions(steps: PromptStep[]): Omit<WorkflowStep, "status">[] {
  return steps.map(({ prompt: _prompt, ...step }) => step);
}

/**
 * Convert a WorkflowDefinition to the old WorkflowPlan format for backward compatibility.
 */
export function toWorkflowPlan(definition: WorkflowDefinition): {
  initialPrompt: string;
  followUps: string[];
} {
  const [first, ...rest] = definition.steps;
  return {
    initialPrompt: first?.prompt ?? "",
    followUps: rest.map((s) => s.prompt),
  };
}
