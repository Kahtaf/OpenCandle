#!/usr/bin/env tsx
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import {
  completeSimple,
  getModel,
  registerBuiltInApiProviders,
  type Api,
  type Model,
} from "@earendil-works/pi-ai";
import { loadEnv } from "../../src/config.js";
import {
  buildComparisonJudgePrompt,
  buildGenericAgentPrompt,
  buildPromptGenerationPrompt,
  parseComparisonJudgment,
  parseGeneratedPrompts,
  type ComparisonJudgment,
  type CompetitorAnswer,
  type GeneratedFinancePrompt,
} from "../evals/competitive-finance.js";
import type { EvalTrace } from "../evals/types.js";

interface CompetitiveRunResult {
  prompt: GeneratedFinancePrompt;
  openCandleTrace: EvalTrace;
  competitorAnswers: CompetitorAnswer[];
  judgment: ComparisonJudgment;
}

interface ResolvedModel {
  model: Model<Api>;
  apiKey?: string;
  headers?: Record<string, string>;
}

interface CompetitorRunner {
  id: string;
  label: string;
  provider: string;
  model: string;
  run(prompt: string): CompetitorRunResult;
}

interface CompetitorRunResult {
  answer: string;
  provider: string;
  model: string;
}

loadEnv();

const DEFAULT_ACPX_COMMAND = join(process.cwd(), "node_modules", ".bin", "acpx");

const asOfDate = new Date().toISOString().slice(0, 10);
const promptCount = numberFromEnv("COMPETITIVE_PROMPT_COUNT", 5);
const seed = process.env.COMPETITIVE_PROMPT_SEED ?? new Date().toISOString().slice(0, 10);
const requestedProvider = process.env.OPENCANDLE_COMPETITIVE_PROVIDER;
const requestedModelId = process.env.OPENCANDLE_COMPETITIVE_MODEL;
const settleGraceMs = process.env.OPENCANDLE_MANUAL_RUN_SETTLE_GRACE_MS ?? "30000";

registerBuiltInApiProviders();
const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
const judgeModel = await resolveModelWithAuth(
  requestedProvider,
  requestedModelId,
  "Set OPENCANDLE_COMPETITIVE_PROVIDER and OPENCANDLE_COMPETITIVE_MODEL, plus the matching API key, or configure a model through the OpenCandle/Pi setup flow.",
);
const competitors = resolveCompetitors();
preflightCompetitors(competitors);

const generatedPromptText = await completeText(
  judgeModel,
  buildPromptGenerationPrompt({ count: promptCount, seed, asOfDate }),
  { temperature: 0.8, maxTokens: 3000 },
);
const prompts = parseGeneratedPrompts(generatedPromptText);
if (prompts.length === 0) throw new Error("Prompt generator returned no prompts");

const results: CompetitiveRunResult[] = [];
for (const prompt of prompts.slice(0, promptCount)) {
  console.log(`\n=== ${prompt.id}: ${prompt.prompt}`);
  const openCandleTrace = runOpenCandle(prompt.prompt);
  const competitorAnswers = [];
  for (const competitor of competitors) {
    console.log(`--- ${competitor.label} baseline (${competitor.provider}/${competitor.model})`);
    const result = competitor.run(
      buildGenericAgentPrompt(prompt.prompt, { agentName: competitor.label, asOfDate }),
    );
    competitorAnswers.push({
      id: competitor.id,
      label: competitor.label,
      provider: result.provider,
      model: result.model,
      answer: result.answer,
    });
  }
  const judgmentText = await completeText(
    judgeModel,
    buildComparisonJudgePrompt({ prompt, asOfDate, openCandleTrace, competitorAnswers }),
    { temperature: 0, maxTokens: 3000 },
  );
  const judgment = parseComparisonJudgment(judgmentText);
  results.push({ prompt, openCandleTrace, competitorAnswers, judgment });
  const competitorScoreText = Object.entries(judgment.competitorScores)
    .map(([id, score]) => `${id}=${score}`)
    .join(" ");
  console.log(`winner=${judgment.winner} oc=${judgment.openCandleScore} ${competitorScoreText}`);
  console.log(judgment.reason);
  if (judgment.openCandleImprovementIdeas.length > 0) {
    console.log(`OC improvements: ${judgment.openCandleImprovementIdeas.join("; ")}`);
  }
}

const summary = summarize(results);
const report = {
  generatedAt: new Date().toISOString(),
  asOfDate,
  seed,
  judge: {
    provider: judgeModel.model.provider,
    model: judgeModel.model.id,
  },
  competitors: competitors.map((competitor) => ({
    id: competitor.id,
    label: competitor.label,
    provider: competitor.provider,
    model: competitor.model,
  })),
  promptCount: results.length,
  summary,
  results,
};
const outputPath = writeReport(report);

console.log("\n--- Competitive Finance Summary ---");
console.log(`OpenCandle wins: ${summary.openCandleWins}`);
for (const competitor of competitors) {
  console.log(`${competitor.label} wins: ${summary.competitorWins[competitor.id] ?? 0}`);
}
console.log(`Ties: ${summary.ties}`);
console.log(`Report: ${outputPath}`);

async function completeText(
  resolvedModel: ResolvedModel,
  prompt: string,
  options: { temperature: number; maxTokens: number },
): Promise<string> {
  const response = await completeSimple(
    resolvedModel.model,
    {
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
      tools: [],
    },
    {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      reasoning: "minimal",
      apiKey: resolvedModel.apiKey,
      headers: resolvedModel.headers,
    },
  );
  if (response.stopReason === "error" || response.stopReason === "aborted") {
    throw new Error(response.errorMessage ?? `model call failed: ${response.stopReason}`);
  }
  return response.content
    .filter((content): content is { type: "text"; text: string } => content.type === "text")
    .map((content) => content.text)
    .join("")
    .trim();
}

function runOpenCandle(prompt: string): EvalTrace {
  const ipcDir = mkdtempSync(join(tmpdir(), "oc-competitive-"));
  try {
    execFileSync("npx", ["tsx", "tests/harness/manual-run.ts", ipcDir, prompt], {
      cwd: process.cwd(),
      timeout: 900_000,
      stdio: "pipe",
      env: {
        ...process.env,
        OPENCANDLE_MANUAL_RUN_SETTLE_GRACE_MS: settleGraceMs,
      },
    });
    return JSON.parse(readFileSync(join(ipcDir, "trace.json"), "utf-8")) as EvalTrace;
  } finally {
    rmSync(ipcDir, { recursive: true, force: true });
  }
}

function preflightCompetitors(competitors: CompetitorRunner[]): void {
  if (process.env.OPENCANDLE_COMPETITIVE_PREFLIGHT === "0") return;
  for (const competitor of competitors) {
    console.log(`Preflight ${competitor.label} baseline (${competitor.provider}/${competitor.model})`);
    const result = competitor.run("Reply exactly: OK");
    if (!result.answer.trim()) {
      throw new Error(`${competitor.label} baseline returned an empty preflight response`);
    }
  }
}

function runClaudeOrGeminiAcp(prompt: string): CompetitorRunResult {
  try {
    const answer = runAcpx("claude", prompt);
    return { answer, provider: "acpx/claude", model: "subscription" };
  } catch (error) {
    console.warn(`Claude baseline failed, falling back to Gemini: ${error instanceof Error ? error.message : String(error)}`);
    const answer = runAcpx("gemini", prompt, {
      env: { GEMINI_CLI_TRUST_WORKSPACE: "true", TERM: "xterm-256color" },
    });
    return { answer, provider: "acpx/gemini", model: "subscription" };
  }
}

function runCodexAcp(prompt: string): CompetitorRunResult {
  const model = process.env.OPENCANDLE_COMPETITIVE_CODEX_MODEL ?? "gpt-5.3-codex-spark/medium";
  const answer = runAcpx("codex", prompt, { model });
  return { answer, provider: "acpx/codex", model };
}

function runAcpx(
  agent: "claude" | "codex" | "gemini",
  prompt: string,
  options: { env?: Record<string, string>; model?: string } = {},
): string {
  const command = process.env.OPENCANDLE_COMPETITIVE_ACPX_COMMAND ?? DEFAULT_ACPX_COMMAND;
  const args = [
    "--format",
    "quiet",
    "--deny-all",
    "--non-interactive-permissions",
    "fail",
    "--allowed-tools",
    "",
    "--timeout",
    String(numberFromEnv("OPENCANDLE_COMPETITIVE_AGENT_TIMEOUT_SECONDS", 900)),
  ];
  if (options.model) args.push("--model", options.model);
  args.push(agent, "exec");
  return runCli(command, args, {
    input: prompt,
    timeout: numberFromEnv("OPENCANDLE_COMPETITIVE_AGENT_TIMEOUT_MS", 900_000),
    env: options.env,
  });
}

function runCli(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    input?: string;
    timeout: number;
    ignoreStderr?: boolean;
  },
): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    input: options.input,
    timeout: options.timeout,
    encoding: "utf-8",
    env: {
      ...process.env,
      PATH: [
        join(process.cwd(), "node_modules", ".bin"),
        join(process.env.HOME ?? "", ".local", "bin"),
        "/Users/kahtaf/.nvm/versions/node/v22.22.0/bin",
        "/opt/homebrew/bin",
        process.env.PATH ?? "",
      ].join(":"),
      ...options.env,
    },
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`${command} ${args.slice(0, 2).join(" ")} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const message = (options.ignoreStderr ? "" : result.stderr.trim()) ||
      result.stdout.trim() ||
      `exit status ${result.status ?? "unknown"}`;
    throw new Error(`${command} ${args.slice(0, 2).join(" ")} failed: ${message}`);
  }
  return result.stdout.trim();
}

function summarize(results: CompetitiveRunResult[]): {
  openCandleWins: number;
  competitorWins: Record<string, number>;
  ties: number;
} {
  const competitorWins: Record<string, number> = {};
  for (const result of results) {
    if (result.judgment.winner !== "opencandle" && result.judgment.winner !== "tie") {
      competitorWins[result.judgment.winner] = (competitorWins[result.judgment.winner] ?? 0) + 1;
    }
  }
  return {
    openCandleWins: results.filter((result) => result.judgment.winner === "opencandle").length,
    competitorWins,
    ties: results.filter((result) => result.judgment.winner === "tie").length,
  };
}

function writeReport(report: unknown): string {
  const dir = join(process.cwd(), "tests", "evals", "runs");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `${stamp}_competitive-finance.json`);
  writeFileSync(path, JSON.stringify(report, null, 2), "utf-8");
  return path;
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveCompetitors(): CompetitorRunner[] {
  return [
    {
      id: "claude",
      label: "Claude/Gemini",
      provider: "acpx/claude|acpx/gemini",
      model: "subscription",
      run: runClaudeOrGeminiAcp,
    },
    {
      id: "codex",
      label: "Codex",
      provider: "acpx/codex",
      model: process.env.OPENCANDLE_COMPETITIVE_CODEX_MODEL ?? "gpt-5.3-codex-spark/medium",
      run: runCodexAcp,
    },
  ];
}

async function resolveModelWithAuth(
  provider: string | undefined,
  modelId: string | undefined,
  missingAuthMessage: string,
): Promise<ResolvedModel> {
  const model = resolveModel(provider, modelId);
  const requestAuth = await modelRegistry.getApiKeyAndHeaders(model);
  if (!requestAuth.ok) {
    throw new Error(`${requestAuth.error}\n${missingAuthMessage}`);
  }
  if (!requestAuth.apiKey) {
    throw new Error(
      `No API key available for ${model.provider}/${model.id}.\n${missingAuthMessage}`,
    );
  }
  return {
    model,
    apiKey: requestAuth.apiKey,
    headers: requestAuth.headers,
  };
}

function resolveModel(provider: string | undefined, modelId: string | undefined): Model<Api> {
  if (provider && modelId) {
    const configured = modelRegistry.find(provider, modelId);
    if (configured) return configured;
    return getModel(provider as never, modelId as never) as Model<Api>;
  }

  if (!provider && authStorage.hasAuth("google")) {
    return getModel("google", "gemini-2.5-flash") as Model<Api>;
  }

  const available = modelRegistry.getAvailable();
  if (available.length > 0) return available[0]!;

  throw new Error(
    "No configured model found.",
  );
}
