import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { FreshnessStamp } from "../infra/freshness.js";
import type { EvidenceRecord } from "./evidence.js";
import type { StepOutput, WorkflowStep } from "./workflow-types.js";

/**
 * A workflow step definition that carries its prompt text.
 * In Pi's model, each step is a prompt sent to the LLM.
 */
export interface PromptStep extends Omit<WorkflowStep, "status"> {
  prompt: string;
  outputValidation?: PromptOutputValidation;
}

export interface PromptOutputValidation {
  validate(rawText: string): string[];
  repairPrompt(errors: string[]): string;
}

/**
 * A complete workflow definition: typed step metadata + prompt text for each step.
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
    outputValidation?: PromptOutputValidation;
  } = {},
): PromptStep {
  return {
    stepType,
    description,
    prompt,
    skippable: options.skippable ?? false,
    requiredInputs: options.requiredInputs ?? [],
    expectedOutputs: options.expectedOutputs ?? [],
    ...(options.outputValidation ? { outputValidation: options.outputValidation } : {}),
  };
}

/**
 * Create a StepOutput for a prompt-based step (no structured evidence yet).
 * Evidence will be captured separately via tool call hooks.
 */
export function promptStepOutput(
  stepIndex: number,
  stepType: string,
  options: { evidence?: EvidenceRecord[]; rawText?: string } = {},
): StepOutput {
  return {
    stepIndex,
    stepType,
    evidence: options.evidence ?? [],
    ...(options.rawText ? { rawText: options.rawText } : {}),
  };
}

/** Capture compact evidence records from session entries produced by one step. */
export function captureToolEvidence(entries: SessionEntry[]): EvidenceRecord[] {
  const calls = new Map<string, { tool: string; args: unknown; startedAt: string }>();
  const evidence: EvidenceRecord[] = [];

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message as unknown as Record<string, unknown>;

    if (message.role === "assistant") {
      for (const part of Array.isArray(message.content) ? message.content : []) {
        const record = asRecord(part);
        if (record.type !== "toolCall") continue;
        const id = stringValue(record.id);
        const tool = stringValue(record.name);
        if (!id || !tool) continue;
        calls.set(id, {
          tool,
          args: record.arguments ?? record.args ?? {},
          startedAt: entry.timestamp,
        });
      }
      continue;
    }

    if (message.role !== "toolResult") continue;
    const toolCallId = stringValue(message.toolCallId);
    const pending = toolCallId ? calls.get(toolCallId) : undefined;
    const tool = pending?.tool ?? stringValue(message.toolName);
    if (!tool) continue;
    const resultValue = message.details ?? message.content ?? "";
    const freshness = extractFreshness(resultValue);
    const serializedResult = serialize(resultValue);
    evidence.push({
      label: `tool:${tool}`,
      value: {
        tool,
        args: truncate(serialize(pending?.args ?? {}), 500),
        ...(freshness ? { freshness } : {}),
        resultDigest: {
          preview: truncate(serializedResult, 500),
          totalLength: serializedResult.length,
        },
        startedAt: pending?.startedAt ?? entry.timestamp,
        completedAt: entry.timestamp,
      },
      provenance: {
        source: "computed",
        timestamp: freshness?.providerDataAt ?? freshness?.fetchedAt ?? entry.timestamp,
        provider: tool,
        confidence: message.isError === true ? 0.5 : undefined,
      },
    });
  }

  return evidence;
}

/** Extract assistant text emitted during a step, preserving final response order. */
export function extractAssistantText(entries: SessionEntry[]): string {
  return entries
    .filter((entry) => entry.type === "message")
    .flatMap((entry) => {
      const message = (entry as Extract<SessionEntry, { type: "message" }>)
        .message as unknown as Record<string, unknown>;
      if (message.role !== "assistant") return [];
      const content = message.content;
      if (typeof content === "string") return [content];
      if (!Array.isArray(content)) return [];
      return content
        .map((part) => asRecord(part))
        .filter((part) => part.type === "text")
        .map((part) => stringValue(part.text) ?? "")
        .filter(Boolean);
    })
    .join("\n")
    .trim();
}

/**
 * Extract just the WorkflowStep metadata from PromptStep definitions
 * (dropping the prompt field) for passing to WorkflowRunner.
 */
export function toStepDefinitions(steps: PromptStep[]): Omit<WorkflowStep, "status">[] {
  return steps.map(({ prompt: _prompt, outputValidation: _outputValidation, ...step }) => step);
}

function serialize(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function extractFreshness(value: unknown): FreshnessStamp | undefined {
  const record = asRecord(value);
  return isFreshnessStamp(record.freshness) ? record.freshness : undefined;
}

function isFreshnessStamp(value: unknown): value is FreshnessStamp {
  const record = asRecord(value);
  return (
    typeof record.fetchedAt === "string" &&
    typeof record.cacheStatus === "string" &&
    typeof record.marketSession === "string" &&
    typeof record.isStaleForSession === "boolean"
  );
}
