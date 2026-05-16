#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
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
  type GeneratedFinancePrompt,
} from "../evals/competitive-finance.js";
import type { EvalTrace } from "../evals/types.js";

interface CompetitiveRunResult {
  prompt: GeneratedFinancePrompt;
  openCandleTrace: EvalTrace;
  genericAnswer: string;
  judgment: ComparisonJudgment;
}

loadEnv();

const promptCount = numberFromEnv("COMPETITIVE_PROMPT_COUNT", 5);
const seed = process.env.COMPETITIVE_PROMPT_SEED ?? new Date().toISOString().slice(0, 10);
const requestedProvider = process.env.OPENCANDLE_COMPETITIVE_PROVIDER;
const requestedModelId = process.env.OPENCANDLE_COMPETITIVE_MODEL;
const settleGraceMs = process.env.OPENCANDLE_MANUAL_RUN_SETTLE_GRACE_MS ?? "30000";

registerBuiltInApiProviders();
const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
const model = resolveModel();
const requestAuth = await modelRegistry.getApiKeyAndHeaders(model);
if (!requestAuth.ok) throw new Error(requestAuth.error);

const generatedPromptText = await completeText(
  buildPromptGenerationPrompt({ count: promptCount, seed }),
  { temperature: 0.8, maxTokens: 3000 },
);
const prompts = parseGeneratedPrompts(generatedPromptText);
if (prompts.length === 0) throw new Error("Prompt generator returned no prompts");

const results: CompetitiveRunResult[] = [];
for (const prompt of prompts.slice(0, promptCount)) {
  console.log(`\n=== ${prompt.id}: ${prompt.prompt}`);
  const openCandleTrace = runOpenCandle(prompt.prompt);
  const genericAnswer = await completeText(buildGenericAgentPrompt(prompt.prompt), {
    temperature: 0.2,
    maxTokens: 4000,
  });
  const judgmentText = await completeText(
    buildComparisonJudgePrompt({ prompt, openCandleTrace, genericAnswer }),
    { temperature: 0, maxTokens: 3000 },
  );
  const judgment = parseComparisonJudgment(judgmentText);
  results.push({ prompt, openCandleTrace, genericAnswer, judgment });
  console.log(`winner=${judgment.winner} oc=${judgment.openCandleScore} generic=${judgment.genericScore}`);
  console.log(judgment.reason);
  if (judgment.openCandleImprovementIdeas.length > 0) {
    console.log(`OC improvements: ${judgment.openCandleImprovementIdeas.join("; ")}`);
  }
}

const summary = summarize(results);
const report = {
  generatedAt: new Date().toISOString(),
  seed,
  provider: model.provider,
  model: model.id,
  promptCount: results.length,
  summary,
  results,
};
const outputPath = writeReport(report);

console.log("\n--- Competitive Finance Summary ---");
console.log(`OpenCandle wins: ${summary.openCandleWins}`);
console.log(`Generic wins: ${summary.genericWins}`);
console.log(`Ties: ${summary.ties}`);
console.log(`Report: ${outputPath}`);

async function completeText(
  prompt: string,
  options: { temperature: number; maxTokens: number },
): Promise<string> {
  const response = await completeSimple(
    model,
    {
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
      tools: [],
    },
    {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      reasoning: "minimal",
      apiKey: requestAuth.apiKey,
      headers: requestAuth.headers,
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

function summarize(results: CompetitiveRunResult[]): {
  openCandleWins: number;
  genericWins: number;
  ties: number;
} {
  return {
    openCandleWins: results.filter((result) => result.judgment.winner === "opencandle").length,
    genericWins: results.filter((result) => result.judgment.winner === "generic").length,
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

function resolveModel(): Model<Api> {
  if (requestedProvider && requestedModelId) {
    const configured = modelRegistry.find(requestedProvider, requestedModelId);
    if (configured) return configured;
    return getModel(requestedProvider as never, requestedModelId as never) as Model<Api>;
  }

  if (!requestedProvider && authStorage.hasAuth("google")) {
    return getModel("google", "gemini-2.5-flash") as Model<Api>;
  }

  const available = modelRegistry.getAvailable();
  if (available.length > 0) return available[0]!;

  throw new Error(
    "No configured model found. Set OPENCANDLE_COMPETITIVE_PROVIDER and OPENCANDLE_COMPETITIVE_MODEL, plus the matching API key, or configure a model through the OpenCandle/Pi setup flow.",
  );
}
