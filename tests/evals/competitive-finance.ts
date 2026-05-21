import { dirname } from "node:path";
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
  asOfDate: string;
}

export interface CompetitorAnswer {
  id: string;
  label: string;
  provider: string;
  model: string;
  answer: string;
  error?: string;
}

export interface ComparisonJudgeInput {
  prompt: GeneratedFinancePrompt;
  asOfDate: string;
  openCandleTrace: EvalTrace;
  competitorAnswers: CompetitorAnswer[];
}

export interface ComparisonJudgment {
  winner: string;
  openCandleScore: number;
  competitorScores: Record<string, number>;
  reason: string;
  openCandleDidBetter: string[];
  competitorsDidBetter: Record<string, string[]>;
  openCandleImprovementIdeas: string[];
}

export interface CompetitiveModelCandidate {
  provider: string;
  id: string;
  contextWindow?: number;
}

const PREFERRED_CONTEXT_WINDOW = 128_000;

export function buildPromptGenerationPrompt(options: PromptGenerationOptions): string {
  const seedLine = options.seed ? `Use this run seed to vary the prompt set: ${options.seed}` : "Invent a fresh prompt set.";
  return `Generate ${options.count} realistic finance prompts for comparing OpenCandle against generic no-tool finance agents such as Claude, Codex, and Gemini.

Current date for this benchmark run: ${options.asOfDate}

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

export function buildGenericAgentPrompt(
  prompt: string,
  options: { agentName: string; asOfDate: string },
): string {
  return `You are ${options.agentName}, acting as a general finance assistant without live tools, browsing, private data, or market-data APIs.

Current date: ${options.asOfDate}

Answer the user's prompt as well as you can. Be explicit when current data would be needed and you cannot verify it. Do not pretend to have live prices, filings, options chains, sentiment, or macro probabilities.

User prompt:
${prompt}`;
}

export function buildComparisonJudgePrompt(input: ComparisonJudgeInput): string {
  const toolCalls = input.openCandleTrace.toolCalls.map((call) => ({
    name: call.name,
    args: call.args,
  }));
  const competitorAnswers = input.competitorAnswers
    .map((competitor) => `Agent: ${competitor.label} (${competitor.id}, ${competitor.provider}/${competitor.model})
Answer:
${competitor.answer}`)
    .join("\n\n---\n\n");
  const winnerOptions = ["opencandle", ...input.competitorAnswers.map((competitor) => competitor.id), "tie"].join("|");
  const scoreShape = Object.fromEntries(input.competitorAnswers.map((competitor) => [competitor.id, 0]));
  const didBetterShape = Object.fromEntries(input.competitorAnswers.map((competitor) => [competitor.id, ["..."]]));
  return `Compare OpenCandle against generic no-tool finance agents for the same user prompt.

Current date: ${input.asOfDate}

User prompt:
${input.prompt.prompt}

Evaluation focus:
${input.prompt.evaluationFocus}

OpenCandle classification:
${JSON.stringify(input.openCandleTrace.classification)}

OpenCandle router telemetry:
${JSON.stringify(input.openCandleTrace.router ?? {}, null, 2)}

OpenCandle tool calls:
${JSON.stringify(toolCalls, null, 2)}

OpenCandle answer:
${input.openCandleTrace.text}

Generic no-tool agent answers:
${competitorAnswers}

Judge the answers on usefulness, correctness, evidence, clarity, and honesty about uncertainty. It is acceptable for any generic agent to win. When one does, explain why and what OpenCandle should improve. Treat dates on or before the current date as current or historical, not future-dated.

Return JSON only:
{
  "winner": "${winnerOptions}",
  "openCandleScore": 0,
  "competitorScores": ${JSON.stringify(scoreShape)},
  "reason": "short explanation",
  "openCandleDidBetter": ["..."],
  "competitorsDidBetter": ${JSON.stringify(didBetterShape)},
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
  if (!winner) throw new Error("Comparison judgment winner is required");

  return {
    winner,
    openCandleScore: numberValue(value.openCandleScore),
    competitorScores: numberRecord(value.competitorScores),
    reason: stringValue(value.reason),
    openCandleDidBetter: stringArray(value.openCandleDidBetter),
    competitorsDidBetter: stringArrayRecord(value.competitorsDidBetter),
    openCandleImprovementIdeas: stringArray(value.openCandleImprovementIdeas),
  };
}

export function fixedPromptFromEnv(env: Record<string, string | undefined>): GeneratedFinancePrompt | null {
  const prompt = env.OPENCANDLE_COMPETITIVE_PROMPT?.trim();
  if (!prompt) return null;

  const complexity = env.OPENCANDLE_COMPETITIVE_PROMPT_COMPLEXITY?.trim();
  return {
    id: env.OPENCANDLE_COMPETITIVE_PROMPT_ID?.trim() || "fixed-prompt",
    prompt,
    topic: env.OPENCANDLE_COMPETITIVE_PROMPT_TOPIC?.trim() || "fixed prompt",
    complexity: complexity === "simple" || complexity === "complex" ? complexity : "moderate",
    evaluationFocus: env.OPENCANDLE_COMPETITIVE_PROMPT_FOCUS?.trim() ||
      "Compare OpenCandle against generic agents on the same fixed prompt and identify concrete OpenCandle improvements.",
  };
}

export function extractUsableAnswerFromCliFailure(message: string): string | null {
  const match = /\bfailed:\s*/i.exec(message);
  const candidate = (match ? message.slice(match.index + match[0].length) : message).trim();
  if (!candidate) return null;
  if (/^(Internal error|Error handling request|Gemini CLI ACP startup timed out|exit status)\b/i.test(candidate)) {
    return null;
  }
  if (/Failed to authenticate|Invalid authentication credentials|Permission denied/i.test(candidate)) {
    return null;
  }
  return candidate;
}

export function selectCliFailureMessage(options: {
  stdout: string;
  stderr: string;
  status?: number | null;
  ignoreStderr?: boolean;
}): string {
  const stdout = options.stdout.trim();
  const stderr = options.stderr.trim();
  if (stdout) return stdout;
  if (!options.ignoreStderr && stderr) return stderr;
  return `exit status ${options.status ?? "unknown"}`;
}

export function buildPortableAgentPath(env: {
  PATH?: string;
  HOME?: string;
  execPath?: string;
  cwd?: string;
}): string {
  const parts = [
    `${env.cwd ?? process.cwd()}/node_modules/.bin`,
    env.HOME ? `${env.HOME}/.local/bin` : "",
    env.execPath ? dirname(env.execPath) : "",
    "/opt/homebrew/bin",
    env.PATH ?? "",
  ];
  return parts.filter(Boolean).join(":");
}

export function selectDefaultCompetitiveModel<T extends CompetitiveModelCandidate>(options: {
  googleAuthConfigured: boolean;
  googleModel: T;
  available: T[];
}): T | undefined {
  if (options.googleAuthConfigured) return options.googleModel;
  return options.available.find((model) => (model.contextWindow ?? 0) >= PREFERRED_CONTEXT_WINDOW) ??
    options.available[0];
}

export function competitiveBenchmarkExitCode(): number {
  return 0;
}

export function shouldRetryCompetitiveModelCall(message: string, attempt: number, maxAttempts: number): boolean {
  if (attempt >= maxAttempts) return false;
  return /\b(fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|rate limit|429|500|502|503|504)\b/i.test(message);
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

function numberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])),
  );
}

function stringArrayRecord(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, arrayValue]) => [key, stringArray(arrayValue)]),
  );
}
