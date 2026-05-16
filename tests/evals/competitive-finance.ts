import type { EvalTrace } from "./types.js";

export interface GeneratedFinancePrompt {
  id: string;
  prompt: string;
  topic: string;
  complexity: "simple" | "moderate" | "complex";
  evaluationFocus: string;
}

export interface PromptGenerationOptions {
  count: number;
  seed?: string;
}

export interface ComparisonJudgeInput {
  prompt: GeneratedFinancePrompt;
  openCandleTrace: EvalTrace;
  genericAnswer: string;
}

export interface ComparisonJudgment {
  winner: "opencandle" | "generic" | "tie";
  openCandleScore: number;
  genericScore: number;
  reason: string;
  openCandleDidBetter: string[];
  genericDidBetter: string[];
  openCandleImprovementIdeas: string[];
}

export function buildPromptGenerationPrompt(options: PromptGenerationOptions): string {
  const seedLine = options.seed ? `Use this run seed to vary the prompt set: ${options.seed}` : "Invent a fresh prompt set.";
  return `Generate ${options.count} realistic finance prompts for comparing OpenCandle against a generic no-tool finance agent.

${seedLine}

The set must cover general finance, investing, portfolio construction, market structure, risk, macro, company research, options, sentiment, and educational questions when useful.

Do not bias toward prompts where OpenCandle obviously has a tool advantage. Include prompts where:
- OpenCandle may be better because it can gather evidence or run tools.
- A generic agent may be better because the prompt mainly needs synthesis, explanation, or judgment.
- The winner is ambiguous and the comparison should reveal what OpenCandle needs to improve.

Return JSON only:
{
  "prompts": [
    {
      "id": "short-kebab-id",
      "prompt": "user-facing prompt",
      "topic": "short topic",
      "complexity": "simple|moderate|complex",
      "evaluationFocus": "what the comparison should inspect"
    }
  ]
}`;
}

export function buildGenericAgentPrompt(prompt: string): string {
  return `You are a general finance assistant without live tools, browsing, private data, or market-data APIs.

Answer the user's prompt as well as you can. Be explicit when current data would be needed and you cannot verify it. Do not pretend to have live prices, filings, options chains, sentiment, or macro probabilities.

User prompt:
${prompt}`;
}

export function buildComparisonJudgePrompt(input: ComparisonJudgeInput): string {
  const toolCalls = input.openCandleTrace.toolCalls.map((call) => ({
    name: call.name,
    args: call.args,
  }));
  return `Compare OpenCandle against a generic no-tool finance agent for the same user prompt.

User prompt:
${input.prompt.prompt}

Evaluation focus:
${input.prompt.evaluationFocus}

OpenCandle classification:
${JSON.stringify(input.openCandleTrace.classification)}

OpenCandle tool calls:
${JSON.stringify(toolCalls, null, 2)}

OpenCandle answer:
${input.openCandleTrace.text}

Generic no-tool answer:
${input.genericAnswer}

Judge the answers on usefulness, correctness, evidence, clarity, and honesty about uncertainty. It is acceptable for the generic agent to win. When it does, explain why and what OpenCandle should improve.

Return JSON only:
{
  "winner": "opencandle|generic|tie",
  "openCandleScore": 0,
  "genericScore": 0,
  "reason": "short explanation",
  "openCandleDidBetter": ["..."],
  "genericDidBetter": ["..."],
  "openCandleImprovementIdeas": ["..."]
}`;
}

export function parseGeneratedPrompts(raw: string): GeneratedFinancePrompt[] {
  const value = parseJsonPayload(raw);
  const prompts = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.prompts)
      ? value.prompts
      : [];

  return prompts.map((item, index) => normalizeGeneratedPrompt(item, index));
}

export function parseComparisonJudgment(raw: string): ComparisonJudgment {
  const value = parseJsonPayload(raw);
  if (!isRecord(value)) throw new Error("Comparison judgment must be a JSON object");

  const winner = stringValue(value.winner);
  if (winner !== "opencandle" && winner !== "generic" && winner !== "tie") {
    throw new Error(`Invalid comparison winner: ${winner}`);
  }

  return {
    winner,
    openCandleScore: numberValue(value.openCandleScore),
    genericScore: numberValue(value.genericScore),
    reason: stringValue(value.reason),
    openCandleDidBetter: stringArray(value.openCandleDidBetter),
    genericDidBetter: stringArray(value.genericDidBetter),
    openCandleImprovementIdeas: stringArray(value.openCandleImprovementIdeas),
  };
}

function normalizeGeneratedPrompt(item: unknown, index: number): GeneratedFinancePrompt {
  if (!isRecord(item)) throw new Error(`Generated prompt ${index + 1} must be an object`);
  const complexity = stringValue(item.complexity);
  if (complexity !== "simple" && complexity !== "moderate" && complexity !== "complex") {
    throw new Error(`Generated prompt ${index + 1} has invalid complexity: ${complexity}`);
  }
  return {
    id: stringValue(item.id) || `prompt-${index + 1}`,
    prompt: stringValue(item.prompt),
    topic: stringValue(item.topic),
    complexity,
    evaluationFocus: stringValue(item.evaluationFocus),
  };
}

function parseJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = Math.min(...["{", "["].map((char) => {
      const index = trimmed.indexOf(char);
      return index === -1 ? Number.POSITIVE_INFINITY : index;
    }));
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (!Number.isFinite(start) || end <= start) throw new Error("No JSON payload found");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
