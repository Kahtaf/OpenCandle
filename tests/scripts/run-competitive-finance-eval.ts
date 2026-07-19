#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Api,
  completeSimple,
  getEnvApiKey,
  getModel,
  type Model,
  registerBuiltInApiProviders,
} from "@earendil-works/pi-ai/compat";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { loadEnv } from "../../src/config.js";
import { getOpenCandleHomeDir } from "../../src/infra/opencandle-paths.js";
import {
  analyzeCompetitiveReport,
  buildComparisonJudgePrompt,
  buildComparisonJudgeRetryPrompt,
  buildGenericAgentPrompt,
  buildPortableAgentPath,
  buildPromptGenerationPrompt,
  buildSavedStateSummary,
  COMPETITIVE_STATE_FIXTURE,
  type ComparisonJudgment,
  type CompetitorAnswer,
  competitiveBenchmarkExitCode,
  competitivePreflightTimeoutMs,
  competitiveReportAnalysisPath,
  extractUsableAnswerFromCliFailure,
  findCachedCompetitorAnswer,
  findCachedPromptMetadata,
  fixedPromptFromEnv,
  formatCompetitiveReportAnalysisMarkdown,
  frozenCompetitivePanelFromEnv,
  type GeneratedFinancePrompt,
  parseComparisonJudgment,
  parseGeneratedPrompts,
  resolveRequestAuthWithEnvApiKeyFallback,
  selectCliFailureMessage,
  selectCompetitiveCodexModel,
  selectCompetitiveGeminiBaseline,
  selectDefaultCompetitiveModel,
  shouldRetryCompetitiveModelCall,
} from "../evals/competitive-finance.js";
import {
  evaluateFinalAnswerAssertion,
  type FinalAnswerAssertionResult,
} from "../evals/prompt-policy-assertions.js";
import type { EvalTrace } from "../evals/types.js";
import { runOpenCandleSession } from "../harness/opencandle-runner.js";

interface CompetitiveRunResult {
  prompt: GeneratedFinancePrompt;
  openCandleTrace: EvalTrace;
  competitorAnswers: CompetitorAnswer[];
  judgment: ComparisonJudgment;
  hardAssertionResults?: FinalAnswerAssertionResult[];
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
  run(prompt: string, options?: CompetitorRunOptions): Promise<CompetitorRunResult>;
}

interface CompetitorRunResult {
  answer: string;
  provider: string;
  model: string;
}

interface CompetitorRunOptions {
  timeout?: number;
}

type AcpxAgent = "claude" | "codex" | "gemini";

loadEnv();

const DEFAULT_ACPX_COMMAND = join(process.cwd(), "node_modules", ".bin", "acpx");
const DEFAULT_COMPETITOR_CWD = join(tmpdir(), "oc-competitive-agents");
const DEFAULT_CLAUDE_AGENT_COMMAND = join(
  process.cwd(),
  "node_modules",
  ".bin",
  "claude-agent-acp",
);
const DEFAULT_GEMINI_AGENT_COMMAND = "gemini --acp --skip-trust";

const asOfDate = new Date().toISOString().slice(0, 10);
const promptCount = numberFromEnv("COMPETITIVE_PROMPT_COUNT", 5);
const seed = process.env.COMPETITIVE_PROMPT_SEED ?? new Date().toISOString().slice(0, 10);
const requestedProvider = process.env.OPENCANDLE_COMPETITIVE_PROVIDER;
const requestedModelId = process.env.OPENCANDLE_COMPETITIVE_MODEL;
const settleGraceMs = process.env.OPENCANDLE_MANUAL_RUN_SETTLE_GRACE_MS ?? "90000";
const competitorCwd = process.env.OPENCANDLE_COMPETITIVE_AGENT_CWD ?? DEFAULT_COMPETITOR_CWD;
const sourceOpenCandleHome = getOpenCandleHomeDir();
const openCandleHome = createSeededEvalHome(sourceOpenCandleHome);
const seedState = process.env.OPENCANDLE_COMPETITIVE_SEED_STATE === "1";
const savedStateSummary = seedState ? buildSavedStateSummary(COMPETITIVE_STATE_FIXTURE) : undefined;
if (seedState) await seedEvalMarketState(openCandleHome);
process.on("exit", () => {
  rmSync(openCandleHome, { recursive: true, force: true });
});
mkdirSync(competitorCwd, { recursive: true });

registerBuiltInApiProviders();
const modelRuntime = await ModelRuntime.create();
const modelRegistry = new ModelRegistry(modelRuntime);
const competitorAnswerCache = loadCompetitiveReportCache();
const judgeModel = await resolveModelWithAuth(
  requestedProvider,
  requestedModelId,
  "Set OPENCANDLE_COMPETITIVE_PROVIDER and OPENCANDLE_COMPETITIVE_MODEL, plus the matching API key, or configure a model through the OpenCandle/Pi setup flow.",
);
const frozenPanel = frozenCompetitivePanelFromEnv(process.env);
// The frozen panel's loss-class contracts live in the prompt-policy
// manifest; the frozen run must evaluate them itself instead of assuming a
// separate prompt-policy run happens (a generous LLM judge must not be the
// only gate on a loss-class regression).
const policyManifestAssertions = new Map<string, string[]>();
if (frozenPanel) {
  const manifestPath =
    process.env.PROMPT_POLICY_MANIFEST ?? "docs/internal/prompt-to-policy-migration-manifest.json";
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
    prompts: Array<{ id: string; expected?: { finalAnswerHardAssertions?: string[] } }>;
  };
  for (const entry of manifest.prompts) {
    if (entry.expected?.finalAnswerHardAssertions?.length) {
      policyManifestAssertions.set(entry.id, entry.expected.finalAnswerHardAssertions);
    }
  }
}
const fixedPrompt = fixedPromptFromEnv(process.env);
const rawPrompts = frozenPanel
  ? frozenPanel
  : fixedPrompt
    ? [fixedPrompt]
    : parseGeneratedPrompts(
        await completeText(
          judgeModel,
          buildPromptGenerationPrompt({ count: promptCount, seed, asOfDate, savedStateSummary }),
          { temperature: 0.8, maxTokens: 3000 },
        ),
      );
const prompts = rawPrompts.map((prompt) => {
  const cached = findCachedPromptMetadata(competitorAnswerCache, prompt.prompt);
  return cached
    ? {
        ...prompt,
        topic: cached.topic,
        complexity: cached.complexity,
        evaluationFocus: cached.evaluationFocus,
      }
    : prompt;
});
if (prompts.length === 0) throw new Error("Prompt generator returned no prompts");

const allCompetitors = resolveCompetitors();
const competitorsNeedingLiveRun = allCompetitors.filter((competitor) =>
  prompts
    .slice(0, promptCount)
    .some(
      (prompt) => !findCachedCompetitorAnswer(competitorAnswerCache, prompt.prompt, competitor.id),
    ),
);
const preflight = await preflightCompetitors(competitorsNeedingLiveRun);
const activeLiveCompetitors = new Map(
  preflight.active.map((competitor) => [competitor.id, competitor]),
);
if (
  allCompetitors.every((competitor) =>
    prompts
      .slice(0, promptCount)
      .every(
        (prompt) =>
          !findCachedCompetitorAnswer(competitorAnswerCache, prompt.prompt, competitor.id) &&
          !activeLiveCompetitors.has(competitor.id),
      ),
  )
) {
  throw new Error("No cached or live competitive baseline agents are available");
}

const results: CompetitiveRunResult[] = [];
for (const prompt of prompts.slice(0, promptCount)) {
  console.log(`\n=== ${prompt.id}: ${prompt.prompt}`);
  const openCandleTrace = await runOpenCandle(prompt.prompt);
  const competitorAnswers = [];
  for (const competitor of allCompetitors) {
    const cached = findCachedCompetitorAnswer(competitorAnswerCache, prompt.prompt, competitor.id);
    if (cached) {
      console.log(
        `--- ${competitor.label} baseline (${competitor.provider}/${competitor.model}) [cached from ${cached.cachedFromReport}]`,
      );
      competitorAnswers.push(cached);
      continue;
    }
    if (!activeLiveCompetitors.has(competitor.id)) continue;
    console.log(`--- ${competitor.label} baseline (${competitor.provider}/${competitor.model})`);
    try {
      const result = await competitor.run(
        buildGenericAgentPrompt(prompt.prompt, {
          agentName: competitor.label,
          asOfDate,
          savedStateSummary,
        }),
      );
      competitorAnswers.push({
        id: competitor.id,
        label: competitor.label,
        provider: result.provider,
        model: result.model,
        answer: result.answer,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (process.env.OPENCANDLE_COMPETITIVE_REQUIRE_ALL === "1") {
        throw new Error(`${competitor.label} baseline failed: ${reason}`);
      }
      console.warn(`${competitor.label} baseline failed for prompt ${prompt.id}: ${reason}`);
      const usableAnswer = extractUsableAnswerFromCliFailure(reason);
      competitorAnswers.push({
        id: competitor.id,
        label: competitor.label,
        provider: competitor.provider,
        model: competitor.model,
        answer: usableAnswer ?? `${competitor.label} baseline failed before answering: ${reason}`,
        error: reason,
      });
    }
  }
  if (competitorAnswers.length === 0) {
    throw new Error(
      `No cached or live competitive baseline answers are available for prompt ${prompt.id}`,
    );
  }
  const manifestId = (prompt as { promptPolicyManifestId?: string }).promptPolicyManifestId;
  const hardAssertions = manifestId ? (policyManifestAssertions.get(manifestId) ?? []) : [];
  const hardAssertionResults = hardAssertions.map((assertion) =>
    evaluateFinalAnswerAssertion(assertion, openCandleTrace),
  );
  for (const result of hardAssertionResults) {
    console.log(
      `hard-assertion ${result.passed ? "PASS" : "FAIL"}${result.deterministic ? "" : " (non-deterministic)"}: ${result.assertion} — ${result.reason}`,
    );
  }
  const judgment = await completeComparisonJudgment(
    buildComparisonJudgePrompt({
      prompt,
      asOfDate,
      openCandleTrace,
      competitorAnswers,
      savedStateSummary,
    }),
    ["opencandle", ...competitorAnswers.map((answer) => answer.id), "tie"],
  );
  results.push({ prompt, openCandleTrace, competitorAnswers, judgment, hardAssertionResults });
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
  openCandleHome,
  sourceOpenCandleHome,
  judge: {
    provider: judgeModel.model.provider,
    model: judgeModel.model.id,
  },
  competitors: allCompetitors.map((competitor) => ({
    id: competitor.id,
    label: competitor.label,
    provider: competitor.provider,
    model: competitor.model,
  })),
  skippedCompetitors: preflight.skipped,
  promptCount: results.length,
  promptMode: frozenPanel ? "frozen" : fixedPrompt ? "fixed" : "generated",
  seededState: seedState,
  frozenPanel: Boolean(frozenPanel),
  summary,
  results,
};
const outputPath = writeReport(report);
const analysisPath = writeReportAnalysis(report, outputPath);

console.log("\n--- Competitive Finance Summary ---");
console.log(`OpenCandle wins: ${summary.openCandleWins}`);
for (const competitor of allCompetitors) {
  console.log(`${competitor.label} wins: ${summary.competitorWins[competitor.id] ?? 0}`);
}
console.log(`Ties: ${summary.ties}`);
console.log(`Report: ${outputPath}`);
console.log(`Analysis: ${analysisPath}`);
const deterministicHardFailures = results.flatMap((result) =>
  (result.hardAssertionResults ?? []).filter(
    (assertion) => assertion.deterministic && !assertion.passed,
  ),
);
if (frozenPanel && deterministicHardFailures.length > 0) {
  console.error(
    `\nFrozen panel FAILED ${deterministicHardFailures.length} deterministic hard assertion(s):`,
  );
  for (const failure of deterministicHardFailures) {
    console.error(`- ${failure.assertion}: ${failure.reason}`);
  }
  // A generous LLM judge must not be the only gate on a loss-class
  // regression; the frozen run fails on its own manifest contracts.
  process.exit(1);
}
process.exit(competitiveBenchmarkExitCode());

async function completeText(
  resolvedModel: ResolvedModel,
  prompt: string,
  options: { temperature: number; maxTokens: number },
): Promise<string> {
  const maxAttempts = numberFromEnv("OPENCANDLE_COMPETITIVE_MODEL_ATTEMPTS", 3);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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
    if (response.stopReason !== "error" && response.stopReason !== "aborted") {
      return response.content
        .filter((content): content is { type: "text"; text: string } => content.type === "text")
        .map((content) => content.text)
        .join("")
        .trim();
    }
    const message = response.errorMessage ?? `model call failed: ${response.stopReason}`;
    if (!shouldRetryCompetitiveModelCall(message, attempt, maxAttempts)) {
      throw new Error(message);
    }
    console.warn(`Model call failed on attempt ${attempt}/${maxAttempts}: ${message}. Retrying...`);
    await sleep(1000 * attempt);
  }
  throw new Error("model call failed after retries");
}

async function completeComparisonJudgment(
  prompt: string,
  allowedWinners: string[],
): Promise<ComparisonJudgment> {
  const maxAttempts = numberFromEnv("OPENCANDLE_COMPETITIVE_JUDGE_PARSE_ATTEMPTS", 3);
  let lastText = "";
  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidatePrompt =
      attempt === 1
        ? prompt
        : buildComparisonJudgeRetryPrompt({
            originalPrompt: prompt,
            invalidResponse: lastText,
            errorMessage: lastError,
          });
    lastText = await completeText(judgeModel, candidatePrompt, { temperature: 0, maxTokens: 3000 });
    try {
      return parseComparisonJudgment(lastText, { allowedWinners });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt >= maxAttempts) throw error;
      console.warn(
        `Comparison judgment parse failed on attempt ${attempt}/${maxAttempts}: ${lastError}. Retrying...`,
      );
    }
  }
  throw new Error("comparison judgment failed to parse after retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOpenCandle(prompt: string): Promise<EvalTrace> {
  const parsedSettleGraceMs = Number(settleGraceMs);
  const result = await runOpenCandleSession({
    prompt,
    modelRuntime,
    defaultProvider: judgeModel.model.provider,
    defaultModel: judgeModel.model.id,
    openCandleHome,
    settleGraceMs: Number.isFinite(parsedSettleGraceMs) ? parsedSettleGraceMs : undefined,
    timeoutMs: 900_000,
  });
  return result.evalTrace;
}

async function preflightCompetitors(competitors: CompetitorRunner[]): Promise<{
  active: CompetitorRunner[];
  skipped: Array<{ id: string; label: string; reason: string }>;
}> {
  if (process.env.OPENCANDLE_COMPETITIVE_PREFLIGHT === "0") {
    return { active: competitors, skipped: [] };
  }
  const active: CompetitorRunner[] = [];
  const skipped: Array<{ id: string; label: string; reason: string }> = [];
  for (const competitor of competitors) {
    console.log(
      `Preflight ${competitor.label} baseline (${competitor.provider}/${competitor.model})`,
    );
    try {
      const result = await competitor.run("Reply exactly: OK", {
        timeout: competitivePreflightTimeoutMs(process.env),
      });
      if (!result.answer.trim()) {
        throw new Error(`${competitor.label} baseline returned an empty preflight response`);
      }
      active.push(competitor);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (process.env.OPENCANDLE_COMPETITIVE_REQUIRE_ALL === "1") {
        throw new Error(`${competitor.label} baseline failed preflight: ${reason}`);
      }
      console.warn(`Skipping ${competitor.label} baseline after preflight failure: ${reason}`);
      skipped.push({ id: competitor.id, label: competitor.label, reason });
    }
  }
  return { active, skipped };
}

async function runClaudeAcp(
  prompt: string,
  options: CompetitorRunOptions = {},
): Promise<CompetitorRunResult> {
  const answer = runAcpx("claude", prompt, options);
  return { answer, provider: "acpx/claude", model: "subscription" };
}

async function runCodexAcp(
  prompt: string,
  options: CompetitorRunOptions = {},
): Promise<CompetitorRunResult> {
  const model = selectCompetitiveCodexModel(process.env);
  const answer = runAcpx("codex", prompt, { ...options, model });
  return { answer, provider: "acpx/codex", model };
}

async function runGeminiBaseline(
  prompt: string,
  options: CompetitorRunOptions = {},
): Promise<CompetitorRunResult> {
  const baseline = selectCompetitiveGeminiBaseline(process.env);
  if (baseline.mode === "api") {
    const resolvedModel = await resolveModelWithAuth(
      "google",
      baseline.model,
      "Set GEMINI_API_KEY or GOOGLE_API_KEY for the Gemini competitive baseline, or set OPENCANDLE_COMPETITIVE_GEMINI_AGENT=acpx to force the legacy Gemini CLI ACP path.",
    );
    const answer = await completeText(resolvedModel, prompt, { temperature: 0.2, maxTokens: 3000 });
    return { answer, provider: baseline.provider, model: resolvedModel.model.id };
  }
  const answer = runAcpx("gemini", prompt, {
    ...options,
    env: { GEMINI_CLI_TRUST_WORKSPACE: "true", TERM: "xterm-256color" },
  });
  return { answer, provider: "acpx/gemini", model: "subscription" };
}

function runAcpx(
  agent: AcpxAgent,
  prompt: string,
  options: { env?: Record<string, string>; model?: string; timeout?: number } = {},
): string {
  const command = process.env.OPENCANDLE_COMPETITIVE_ACPX_COMMAND ?? DEFAULT_ACPX_COMMAND;
  const agentCommand = resolveAgentCommand(agent);
  const args = [
    "--cwd",
    competitorCwd,
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
  if (agentCommand) {
    args.push("--agent", agentCommand, "exec");
  } else {
    args.push(agent, "exec");
  }
  return runCli(command, args, {
    cwd: competitorCwd,
    input: prompt,
    timeout: options.timeout ?? numberFromEnv("OPENCANDLE_COMPETITIVE_AGENT_TIMEOUT_MS", 900_000),
    env: {
      ...defaultAgentEnv(agent),
      ...options.env,
    },
  });
}

function resolveAgentCommand(agent: AcpxAgent): string | undefined {
  const specific = process.env[`OPENCANDLE_COMPETITIVE_${agent.toUpperCase()}_AGENT_COMMAND`];
  if (specific) return specific;
  if (agent === "claude") return DEFAULT_CLAUDE_AGENT_COMMAND;
  if (agent === "gemini") return DEFAULT_GEMINI_AGENT_COMMAND;
  return undefined;
}

function defaultAgentEnv(agent: AcpxAgent): Record<string, string> {
  if (agent === "claude" && !process.env.CLAUDE_CODE_EXECUTABLE) {
    const claudeExecutable = findExecutable("claude");
    return claudeExecutable ? { CLAUDE_CODE_EXECUTABLE: claudeExecutable } : {};
  }
  return {};
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
      PATH: buildPortableAgentPath({
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        execPath: process.execPath,
      }),
      ...options.env,
    },
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`${command} ${args.slice(0, 2).join(" ")} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const message = selectCliFailureMessage({
      stdout: result.stdout,
      stderr: result.stderr,
      status: result.status,
      ignoreStderr: options.ignoreStderr,
    });
    throw new Error(`${command} ${args.slice(0, 2).join(" ")} failed: ${message}`);
  }
  return result.stdout.trim();
}

function findExecutable(name: string): string | undefined {
  const result = spawnSync("which", [name], {
    encoding: "utf-8",
    env: {
      ...process.env,
      PATH: buildPortableAgentPath({
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        execPath: process.execPath,
      }),
    },
  });
  if (result.status !== 0) return undefined;
  return result.stdout.trim() || undefined;
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

function writeReportAnalysis(report: unknown, reportPath: string): string {
  const analysis = analyzeCompetitiveReport(report, { reportPath });
  const path = competitiveReportAnalysisPath(reportPath);
  writeFileSync(path, formatCompetitiveReportAnalysisMarkdown(analysis), "utf-8");
  return path;
}

async function seedEvalMarketState(home: string): Promise<void> {
  const { initDatabase } = await import("../../src/memory/sqlite.js");
  const { MarketStateService } = await import("../../src/market-state/service.js");
  const db = initDatabase(join(home, "state.db"));
  const service = new MarketStateService(db);
  const instrument = (symbol: string, name: string, assetType: string) => ({
    symbol,
    name,
    assetType,
    exchange: "NMS",
    currency: "USD",
    provider: "yahoo",
  });
  for (const lot of COMPETITIVE_STATE_FIXTURE.lots) {
    service.addPortfolioLot({
      instrument: instrument(lot.symbol, lot.name, lot.assetType),
      quantity: lot.quantity,
      avgCost: lot.avgCost,
      currency: "USD",
    });
  }
  for (const item of COMPETITIVE_STATE_FIXTURE.watchlist) {
    service.addWatchlistItem({
      instrument: instrument(item.symbol, item.name, "equity"),
    });
  }
  db.close();
  console.log(
    `Seeded eval market state into ${home} (${COMPETITIVE_STATE_FIXTURE.lots.length} lots, ${COMPETITIVE_STATE_FIXTURE.watchlist.length} watchlist)`,
  );
}

function createSeededEvalHome(sourceHome: string): string {
  const targetHome = mkdtempSync(join(tmpdir(), "oc-competitive-home-"));
  copyIfExists(join(sourceHome, "config.json"), join(targetHome, "config.json"));
  copyIfExists(join(sourceHome, "onboarding.json"), join(targetHome, "onboarding.json"));
  copyDirIfExists(join(sourceHome, "browser-profile"), join(targetHome, "browser-profile"));
  return targetHome;
}

function copyIfExists(source: string, target: string): void {
  if (!existsSync(source)) return;
  copyFileSync(source, target);
}

function copyDirIfExists(source: string, target: string): void {
  if (!existsSync(source)) return;
  cpSync(source, target, { recursive: true, force: true });
}

function loadCompetitiveReportCache(): Array<{ path: string; report: unknown }> {
  const dir = join(process.cwd(), "tests", "evals", "runs");
  try {
    return readdirSync(dir)
      .filter((file) => file.endsWith("_competitive-finance.json"))
      .sort()
      .flatMap((file) => {
        const path = join(dir, file);
        try {
          return [{ path, report: JSON.parse(readFileSync(path, "utf-8")) }];
        } catch (error) {
          console.warn(
            `Skipping unreadable competitive cache report ${path}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [];
        }
      });
  } catch {
    return [];
  }
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveCompetitors(): CompetitorRunner[] {
  const geminiBaseline = selectCompetitiveGeminiBaseline(process.env);
  return [
    {
      id: "claude",
      label: "Claude",
      provider: "acpx/claude",
      model: "subscription",
      run: runClaudeAcp,
    },
    {
      id: "codex",
      label: "Codex",
      provider: "acpx/codex",
      model: selectCompetitiveCodexModel(process.env),
      run: runCodexAcp,
    },
    {
      id: "gemini",
      label: "Gemini",
      provider: geminiBaseline.provider,
      model: geminiBaseline.model,
      run: runGeminiBaseline,
    },
  ];
}

async function resolveModelWithAuth(
  provider: string | undefined,
  modelId: string | undefined,
  missingAuthMessage: string,
): Promise<ResolvedModel> {
  const model = resolveModel(provider, modelId);
  // ModelRegistry.getApiKeyAndHeaders skips env-key fallback, so seed
  // provider env keys (e.g. GEMINI_API_KEY) as runtime AuthStorage
  // overrides when the registry has no stored credential. The override
  // also reaches the OpenCandle session runner sharing this AuthStorage.
  const requestAuth = await resolveRequestAuthWithEnvApiKeyFallback({
    provider: model.provider,
    resolveRequestAuth: () => modelRegistry.getApiKeyAndHeaders(model),
    getEnvApiKey: (modelProvider) => getEnvApiKey(modelProvider),
    setRuntimeApiKey: (modelProvider, apiKey) =>
      modelRuntime.setRuntimeApiKey(modelProvider, apiKey),
  });
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

  if (!provider && modelRuntime.getProviderAuthStatus("google").configured) {
    return getModel("google", "gemini-2.5-flash") as Model<Api>;
  }

  const available = modelRegistry.getAvailable();
  const selected = selectDefaultCompetitiveModel({
    googleAuthConfigured: false,
    googleModel: getModel("google", "gemini-2.5-flash") as Model<Api>,
    available,
  });
  if (selected) return selected;

  throw new Error("No configured model found.");
}
